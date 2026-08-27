package api_handler

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"regexp"
	"strconv"
	"strings"

	"phytomni-server/common"
	"phytomni-server/common/i18n"
	rxBot "phytomni-server/external/bot"
	rxLog "phytomni-server/log"
	"phytomni-server/service/api_service"
	"phytomni-server/utils/errs"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

const (
	explicitResearchIntentHeader = "X-Phyto-Research-Intent"
	explicitResearchIntentValue  = "expert-research-v1"
	clientTurnIDHeader           = "X-Phyto-Client-Turn-Id"
)

// queryErrorStatus maps a /query service error to the HTTP status and message
// the Web app and ops should see, so a disabled gateway (503) and an unknown tool
// (400) are distinguishable from a client-correctable Bot 4xx (its surfaced
// message) and from an opaque server failure (500, generic message).
func queryErrorStatus(err error) (int, string) {
	switch {
	case errors.Is(err, api_service.ErrGatewayDisabled):
		return http.StatusServiceUnavailable, "service temporarily unavailable"
	case errors.Is(err, api_service.ErrQueryLimitExceeded):
		return http.StatusRequestEntityTooLarge, "query exceeds the accepted limit"
	case errors.Is(err, api_service.ErrInvalidChatRouting):
		return http.StatusBadRequest, "invalid chat routing"
	case errors.Is(err, api_service.ErrInvalidClientTurnID):
		return http.StatusBadRequest, "invalid client turn id"
	case errors.Is(err, api_service.ErrInvalidQueryAttachments):
		return http.StatusBadRequest, "invalid query attachments"
	case errors.Is(err, api_service.ErrInvalidAgentResolver):
		return http.StatusBadRequest, "invalid agent resolver"
	case errors.Is(err, api_service.ErrConversationModeConflict):
		return http.StatusBadRequest, "conversation mode cannot be changed"
	case errors.Is(err, api_service.ErrConversationLedgerNotFound):
		return http.StatusNotFound, "conversation not found"
	case errors.Is(err, gorm.ErrRecordNotFound):
		return http.StatusNotFound, "conversation not found"
	case errors.Is(err, api_service.ErrDuplicateClientTurn):
		return http.StatusConflict, "client turn id conflicts with an existing turn"
	case errors.Is(err, api_service.ErrClientTurnSubmissionPending):
		return http.StatusConflict, "client turn submission is pending"
	case errors.Is(err, api_service.ErrAgentToolForbidden):
		return http.StatusNotFound, "agent tool not found"
	case errors.Is(err, api_service.ErrNoExecutableAgentTools):
		return http.StatusNotFound, "no executable agent tools"
	case errors.Is(err, api_service.ErrAgentToolsUnavailable):
		return http.StatusServiceUnavailable, "agent tools temporarily unavailable"
	case errors.Is(err, api_service.ErrExpertRouteContract):
		return http.StatusBadGateway, "upstream routing contract failed"
	case errors.Is(err, api_service.ErrUnknownTool):
		return http.StatusBadRequest, "unknown tool type"
	case errors.Is(err, api_service.ErrExpertDisabled):
		return http.StatusServiceUnavailable, "expert mode not available"
	case errors.Is(err, api_service.ErrRemoteProductDisabled):
		return http.StatusServiceUnavailable, "remote product temporarily unavailable"
	case errors.Is(err, api_service.ErrRemoteProductForbidden):
		return http.StatusNotFound, "remote product not found"
	case errors.Is(err, api_service.ErrResearchInputIncompatible):
		return http.StatusServiceUnavailable, "Research input compatibility is temporarily unavailable"
	case errors.Is(err, api_service.ErrMissingBotRunID):
		return http.StatusConflict, "task is not syncable through bot run state"
	case errors.Is(err, api_service.ErrInteropRequired):
		return http.StatusFailedDependency, "required interop evidence unavailable"
	case errors.Is(err, api_service.ErrInteropTargetForbidden):
		return http.StatusBadRequest, "interop target is not allowlisted"
	case errors.Is(err, api_service.ErrInvalidA2uiSurface):
		return http.StatusBadRequest, "invalid input-required surface"
	case errors.Is(err, rxBot.ErrBotTimeout):
		return http.StatusGatewayTimeout, "request timed out, please narrow your query or try again later"
	case errors.Is(err, api_service.ErrStreamUnsupported):
		return http.StatusBadRequest, "streaming not supported for this request"
	}
	var botAPIError *rxBot.APIError
	if errors.As(err, &botAPIError) {
		switch {
		case botAPIError.Status == http.StatusGatewayTimeout:
			return http.StatusGatewayTimeout, "request timed out, please narrow your query or try again later"
		case botAPIError.Status >= http.StatusInternalServerError && botAPIError.Status <= 599:
			return http.StatusBadGateway, "upstream service failed"
		}
	}
	if msg, ok := rxBot.SurfaceableMessage(err); ok {
		return http.StatusBadRequest, msg
	}
	return http.StatusInternalServerError, "request failed"
}

func localizedQueryErrorStatus(ctx *gin.Context, err error) (int, string) {
	status, message := queryErrorStatus(err)
	if errors.Is(err, api_service.ErrResearchInputIncompatible) {
		message = i18n.T(ctx, "query.research_input_incompatible")
	}
	return status, message
}

func queryFailureLogFields(ctx *gin.Context, user any, err error, extra ...any) []any {
	fields := []any{"user", user, "err", err}
	if requestID := common.A2uiRequestID(ctx); requestID != "" {
		fields = append(fields, "request_id", requestID)
	}
	if dialogueID := strings.TrimSpace(ctx.Param("id")); dialogueID != "" {
		fields = append(fields, "dialogue_id", dialogueID)
	}
	return append(fields, extra...)
}

func writeQueryError(ctx *gin.Context, status int, message string) {
	if status >= 400 && status < 500 && status != http.StatusUnauthorized && status != http.StatusForbidden {
		ctx.Header("X-Phyto-Dispatch-State", "not-started")
		ctx.Header("Cache-Control", "no-store")
	}
	body := gin.H{"code": status, "message": message}
	if status >= 400 && status < 500 && status != http.StatusUnauthorized && status != http.StatusForbidden {
		body["pre_dispatch"] = true
	}
	if requestID := common.A2uiRequestID(ctx); requestID != "" {
		body["request_id"] = requestID
	}
	ctx.JSON(status, body)
}

// wantsStream reports whether the caller opted into SSE via the Accept header.
func wantsStream(ctx *gin.Context) bool {
	return strings.Contains(ctx.GetHeader("Accept"), "text/event-stream")
}

func parseInteropTargets(raw string) ([]string, bool) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return nil, true
	}
	// A valid target id is at most 64 bytes and the service accepts at most
	// MaxInteropTargets. Reject oversized JSON before unmarshalling so a caller
	// cannot use the multipart budget to create a large temporary slice.
	if len(raw) > 4096 {
		return nil, false
	}
	if raw[0] != '[' || raw[len(raw)-1] != ']' {
		return nil, false
	}
	var targets []string
	if err := json.Unmarshal([]byte(raw), &targets); err != nil || targets == nil {
		return nil, false
	}
	if len(targets) > rxBot.MaxInteropTargets {
		return nil, false
	}
	return targets, true
}

func parseArtifactIDs(raw string) ([]string, bool) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return nil, true
	}
	if len(raw) > 8192 || raw[0] != '[' || raw[len(raw)-1] != ']' {
		return nil, false
	}
	var artifactIDs []string
	if err := json.Unmarshal([]byte(raw), &artifactIDs); err != nil ||
		artifactIDs == nil ||
		len(artifactIDs) > 50 {
		return nil, false
	}
	for _, artifactID := range artifactIDs {
		if !artifactIDPattern.MatchString(artifactID) {
			return nil, false
		}
	}
	return artifactIDs, true
}

func parseNonnegativeInt64(raw string) (int64, bool) {
	if raw == "" {
		return 0, false
	}
	for index := range len(raw) {
		if raw[index] < '0' || raw[index] > '9' {
			return 0, false
		}
	}
	value, err := strconv.ParseInt(raw, 10, 64)
	if err != nil || value < 0 {
		return 0, false
	}
	return value, true
}

func parsePositiveInt64(raw string) (int64, bool) {
	value, ok := parseNonnegativeInt64(raw)
	if !ok || value < 1 {
		return 0, false
	}
	return value, true
}

// parseResumeAfterSeq reads Last-Event-ID, or ?after= when the header is
// absent. Missing both yields 0. A present but unparseable value is invalid.
func parseResumeAfterSeq(ctx *gin.Context) (int64, bool) {
	if ctx == nil || ctx.Request == nil {
		return 0, true
	}
	if values := ctx.Request.Header.Values("Last-Event-ID"); len(values) > 0 {
		afterSeq, err := strconv.ParseInt(strings.TrimSpace(values[0]), 10, 64)
		if err != nil {
			return 0, false
		}
		return afterSeq, true
	}
	if raw, ok := ctx.GetQuery("after"); ok {
		afterSeq, err := strconv.ParseInt(strings.TrimSpace(raw), 10, 64)
		if err != nil {
			return 0, false
		}
		return afterSeq, true
	}
	return 0, true
}

// parseAssetAttachments accepts exactly one bounded JSON array of opaque asset
// references. Strict object decoding keeps filenames, paths, MIME hints, and
// future authority fields out of the Chat/Agent request contract.
func parseAssetAttachments(raw string) ([]rxBot.AssetAttachmentRef, bool) {
	if int64(len(raw)) > api_service.MaxQueryAttachmentsJSONBytes {
		return nil, false
	}
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return nil, true
	}
	if raw[0] != '[' || raw[len(raw)-1] != ']' {
		return nil, false
	}
	decoder := json.NewDecoder(strings.NewReader(raw))
	decoder.DisallowUnknownFields()
	var refs []rxBot.AssetAttachmentRef
	if err := decoder.Decode(&refs); err != nil || refs == nil {
		return nil, false
	}
	var trailing interface{}
	if err := decoder.Decode(&trailing); err != io.EOF {
		return nil, false
	}
	validated, err := rxBot.ValidateAssetAttachmentRefs(refs)
	if err != nil {
		return nil, false
	}
	return validated, true
}

var clientTurnIDPattern = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$`)
var artifactIDPattern = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$`)
var agentResolverGeneIDPattern = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$`)
var agentResolverDesignSpeciesPattern = regexp.MustCompile(`^[a-z][a-z0-9_-]{1,31}$`)
var agentResolverNetworkTraitPattern = regexp.MustCompile(`^TO:[0-9]{7}$`)

var agentResolverNetworkTraits = map[string]struct{}{
	"TO:0000011": {},
	"TO:0000019": {},
	"TO:0000040": {},
	"TO:0000128": {},
	"TO:0000207": {},
	"TO:0000430": {},
}

var agentResolverNetworkSpecies = map[string]struct{}{
	"ath": {},
	"osa": {},
	"zma": {},
	"sbi": {},
	"gma": {},
}

// parseAgentProductResolver accepts resolver controls only on their owning
// dedicated route. It normalizes accepted scalar values before they can reach
// the Bot argument builder and rejects every partial or cross-route payload.
func parseAgentProductResolver(ctx *gin.Context, surface api_service.QuerySurface, routeTool string) (geneID, toID, speciesCode string, err error) {
	rawGeneID, hasGeneID := ctx.GetPostForm("gene_id")
	rawToID, hasToID := ctx.GetPostForm("to_id")
	rawSpeciesCode, hasSpeciesCode := ctx.GetPostForm("species_code")
	if !hasGeneID && !hasToID && !hasSpeciesCode {
		return "", "", "", nil
	}
	if surface != api_service.QuerySurfaceAgentProduct {
		return "", "", "", api_service.ErrInvalidAgentResolver
	}

	geneID = strings.TrimSpace(rawGeneID)
	toID = strings.ToUpper(strings.TrimSpace(rawToID))
	speciesCode = strings.ToLower(strings.TrimSpace(rawSpeciesCode))
	switch routeTool {
	case "DigitalDesignAgent":
		if hasToID || !hasGeneID || !hasSpeciesCode ||
			!agentResolverGeneIDPattern.MatchString(geneID) ||
			!agentResolverDesignSpeciesPattern.MatchString(speciesCode) {
			return "", "", "", api_service.ErrInvalidAgentResolver
		}
		return geneID, "", speciesCode, nil
	case "GeneNetworkAgent":
		if hasGeneID || !hasToID ||
			!agentResolverNetworkTraitPattern.MatchString(toID) {
			return "", "", "", api_service.ErrInvalidAgentResolver
		}
		if speciesCode == "" {
			speciesCode = "osa"
		}
		if _, ok := agentResolverNetworkTraits[toID]; !ok {
			return "", "", "", api_service.ErrInvalidAgentResolver
		}
		if _, ok := agentResolverNetworkSpecies[speciesCode]; !ok {
			return "", "", "", api_service.ErrInvalidAgentResolver
		}
		return "", toID, speciesCode, nil
	default:
		return "", "", "", api_service.ErrInvalidAgentResolver
	}
}

func validateQueryClientTurn(in api_service.QueryInput) error {
	requiresClientTurn := in.Surface == api_service.QuerySurfaceAgentProduct &&
		api_service.IsDedicatedAgentProductTool(in.Tool) &&
		api_service.IsResearchAgentProductTool(in.Tool)
	if in.Surface == api_service.QuerySurfaceChat &&
		in.Mode == "expert" && in.Tool == "InSilicoResearchAgent" {
		requiresClientTurn = true
	}
	if in.Surface == api_service.QuerySurfaceChat &&
		(rxBot.ConversationContextV1Advertised() ||
			strings.TrimSpace(in.ClientTurnID) != "") {
		requiresClientTurn = true
	}
	if !requiresClientTurn {
		return nil
	}
	if !clientTurnIDPattern.MatchString(in.ClientTurnID) {
		return api_service.ErrInvalidClientTurnID
	}
	return nil
}

// streamEnabled reports whether the gateway may take the AG-UI SSE branch.
// Streaming still requires a Bot-advertised stream-capable route downstream.
func streamEnabled() bool {
	return rxBot.BotConfig != nil && rxBot.BotConfig.ProxyEnabled
}

// Query is the gateway entry for chat sends. It parses the bounded multipart
// control form the Web app posts, hands only metadata and asset references to
// the service, and returns the row the Web app renders.
// The Web app consumes this as JSON via axios by default. A caller can opt into
// AG-UI SSE pass-through by sending Accept: text/event-stream; when the
// selected route is stream-capable, the response streams as text/event-stream
// frames instead of the blocking JSON envelope.
func (ph *Handler) Query(ctx *gin.Context) {
	ph.queryForSurface(ctx, api_service.QuerySurfaceChat, "")
}

// AgentProductRun accepts a direct run for a route-owned dedicated product.
func (ph *Handler) AgentProductRun(ctx *gin.Context) {
	tool := ctx.Param("tool")
	if !api_service.IsDedicatedAgentProductTool(tool) {
		writeQueryError(ctx, http.StatusBadRequest, "unknown agent product")
		return
	}
	ph.queryForSurface(ctx, api_service.QuerySurfaceAgentProduct, tool)
}

// queryInputForSurface makes the authenticated route the owner of product tool
// and mode selection. Keeping that rule in one parser makes it independently
// testable without exposing a caller-controlled service surface.
func queryInputForSurface(ctx *gin.Context, surface api_service.QuerySurface, routeTool string) api_service.QueryInput {
	in := api_service.QueryInput{
		Query:        ctx.PostForm("query"),
		Tool:         ctx.PostForm("tool"),
		History:      ctx.DefaultPostForm("history", "[]"),
		Mode:         ctx.DefaultPostForm("mode", "instant"),
		ClientTurnID: strings.TrimSpace(ctx.PostForm("client_turn_id")),
		Surface:      surface,
	}
	if surface == api_service.QuerySurfaceAgentProduct {
		in.Tool = routeTool
		in.Mode = "instant"
	}
	return in
}

func hasForbiddenQueryAttachmentFields(ctx *gin.Context) bool {
	for _, key := range []string{"data_list", "obs_file_list", "obs_path", "object_key", "owner_subject"} {
		if _, supplied := ctx.GetPostForm(key); supplied {
			return true
		}
	}
	return false
}

func explicitResearchIntent(ctx *gin.Context) (bool, error) {
	values := ctx.Request.Header.Values(explicitResearchIntentHeader)
	if len(values) == 0 {
		return false, nil
	}
	if len(values) != 1 || values[0] != explicitResearchIntentValue {
		return false, api_service.ErrInvalidChatRouting
	}
	return true, nil
}

func clientTurnIDFromHeader(ctx *gin.Context) (string, bool, error) {
	values := ctx.Request.Header.Values(clientTurnIDHeader)
	if len(values) == 0 {
		return "", false, nil
	}
	if len(values) != 1 || api_service.ValidateClientTurnID(values[0]) != nil {
		return "", false, api_service.ErrInvalidClientTurnID
	}
	return values[0], true, nil
}

func (ph *Handler) queryForSurface(ctx *gin.Context, surface api_service.QuerySurface, routeTool string) {
	name, _ := ctx.Get("username")
	email, _ := name.(string)
	var serviceCtx context.Context = ctx

	// Reject inert accounts before any body parsing or Bot relay.
	if email != "" {
		if err := ph.service.CheckChatAllowed(ctx, email); err != nil {
			ctx.JSON(http.StatusForbidden, gin.H{
				"code":    http.StatusForbidden,
				"message": i18n.T(ctx, "chat.quota_exhausted"),
			})
			return
		}
	}
	// A dedicated product's canonical tool is validated by AgentProductRun and
	// owned by the route, so reject disabled or ungranted products before any
	// multipart/body operation. Chat uses the finite Research routing intent
	// below to run the same gate before parsing, then cross-checks the form.
	researchAdmission := false
	if surface == api_service.QuerySurfaceAgentProduct {
		var err error
		serviceCtx, err = ph.service.AdmitRemoteProduct(ctx, email, routeTool)
		if err != nil {
			status, message := localizedQueryErrorStatus(ctx, err)
			writeQueryError(ctx, status, message)
			return
		}
		researchAdmission = api_service.IsResearchAgentProductTool(routeTool)
	}
	researchIntent := false
	if surface == api_service.QuerySurfaceChat {
		var err error
		researchIntent, err = explicitResearchIntent(ctx)
		if err != nil {
			status, message := queryErrorStatus(err)
			writeQueryError(ctx, status, message)
			return
		}
		if researchIntent {
			serviceCtx, err = ph.service.AdmitRemoteProduct(
				ctx, email, "InSilicoResearchAgent",
			)
			if err != nil {
				status, message := localizedQueryErrorStatus(ctx, err)
				writeQueryError(ctx, status, message)
				return
			}
			researchAdmission = true
		}
	}
	clientTurnID, hasClientTurnID, err := clientTurnIDFromHeader(ctx)
	if err != nil {
		status, message := queryErrorStatus(err)
		writeQueryError(ctx, status, message)
		return
	}
	productLimits := api_service.RemoteProductInputLimits{}
	if researchAdmission {
		knownCurrentTurn := false
		if hasClientTurnID {
			knownCurrentTurn, err = ph.service.HasCurrentClientTurn(
				serviceCtx,
				email,
				clientTurnID,
			)
			if err != nil {
				status, message := queryErrorStatus(err)
				writeQueryError(ctx, status, message)
				return
			}
		}
		if !knownCurrentTurn {
			serviceCtx, productLimits, err = ph.service.CompleteRemoteProductAdmission(
				serviceCtx,
				email,
				"InSilicoResearchAgent",
			)
			if err != nil {
				status, message := localizedQueryErrorStatus(ctx, err)
				writeQueryError(ctx, status, message)
				return
			}
		}
	}

	maxQueryChars := rxBot.ConfiguredMaxUserQueryChars()
	if maxQueryChars == 0 {
		maxQueryChars = rxBot.DefaultMaxUserQueryChars
	}
	if productLimits.MaxQueryChars > 0 {
		maxQueryChars = productLimits.MaxQueryChars
	}
	ctx.Request.Body = http.MaxBytesReader(
		ctx.Writer,
		ctx.Request.Body,
		api_service.QueryControlBodyLimit(maxQueryChars),
	)

	// Parse the bounded multipart body once: a MaxBytesReader trip surfaces
	// here, so an over-limit upload is reported as too large rather than
	// mislabeled as an empty query. (/query is multipart-only from the Web app; a
	// non-multipart body yields ErrNotMultipart and simply carries no files.)
	form, formErr := ctx.MultipartForm()
	if formErr != nil {
		var maxErr *http.MaxBytesError
		if errors.As(formErr, &maxErr) || strings.Contains(formErr.Error(), "request body too large") {
			ctx.JSON(http.StatusRequestEntityTooLarge, gin.H{"code": http.StatusRequestEntityTooLarge, "message": i18n.T(ctx, "query.upload_too_large")})
			return
		}
	}
	in := queryInputForSurface(ctx, surface, routeTool)
	attachments, ok := parseAssetAttachments(ctx.PostForm("attachments"))
	if !ok {
		status, message := queryErrorStatus(api_service.ErrInvalidQueryAttachments)
		writeQueryError(ctx, status, message)
		return
	}
	in.Attachments = attachments
	if hasClientTurnID && in.ClientTurnID != clientTurnID {
		status, message := queryErrorStatus(api_service.ErrInvalidClientTurnID)
		writeQueryError(ctx, status, message)
		return
	}
	if err := api_service.ValidateCurrentQuery(in.Query, maxQueryChars); err != nil {
		if errors.Is(err, api_service.ErrQueryEmpty) &&
			api_service.AllowsEmptyQueryWithAttachments(in) {
			// Analyst and Research can inspect managed attachments when the user
			// intentionally leaves the query blank.
		} else if errors.Is(err, api_service.ErrQueryLimitExceeded) {
			ctx.JSON(http.StatusRequestEntityTooLarge, gin.H{"code": http.StatusRequestEntityTooLarge, "message": i18n.T(ctx, "query.upload_too_large")})
			return
		}
		ctx.JSON(http.StatusBadRequest, gin.H{"code": http.StatusBadRequest, "message": i18n.T(ctx, "query.query_empty")})
		return
	}
	if hasForbiddenQueryAttachmentFields(ctx) {
		writeQueryError(ctx, http.StatusBadRequest, "invalid query attachments")
		return
	}
	geneID, toID, speciesCode, err := parseAgentProductResolver(ctx, surface, routeTool)
	if err != nil {
		status, message := queryErrorStatus(err)
		writeQueryError(ctx, status, message)
		return
	}
	in.GeneID = geneID
	in.ToID = toID
	in.SpeciesCode = speciesCode
	if err := validateQueryClientTurn(in); err != nil {
		status, message := queryErrorStatus(err)
		writeQueryError(ctx, status, message)
		return
	}
	if surface == api_service.QuerySurfaceChat {
		routingTool := in.Tool
		if rxBot.ConversationContextV1Advertised() &&
			strings.TrimSpace(in.Mode) == "instant" {
			routingTool = ""
		}
		decision, err := api_service.ValidateChatRouting(in.Mode, routingTool)
		if err != nil {
			status, message := queryErrorStatus(err)
			writeQueryError(ctx, status, message)
			return
		}
		in.Mode = decision.Mode
		in.Tool = decision.ForcedTool
		if rxBot.ConversationContextV1Advertised() && in.Mode == "instant" {
			in.Tool = "ChatAgent"
		}
		bodyResearchIntent := in.Mode == "expert" && in.Tool == "InSilicoResearchAgent"
		if bodyResearchIntent != researchIntent {
			status, message := queryErrorStatus(api_service.ErrInvalidChatRouting)
			writeQueryError(ctx, status, message)
			return
		}
	}
	in.InteropMode = strings.TrimSpace(ctx.PostForm("interop_mode"))
	// Bound this caller-controlled label before it can reach service errors or
	// request logs. The only accepted values remain off|auto|required; an
	// overlong value fails closed at the HTTP boundary instead of being echoed
	// by a downstream validation error.
	if len([]rune(in.InteropMode)) > rxBot.MaxInteropModeLength {
		ctx.JSON(http.StatusBadRequest, gin.H{"code": http.StatusBadRequest, "message": i18n.T(ctx, "query.invalid_interop_controls")})
		return
	}
	interopTargets, ok := parseInteropTargets(ctx.PostForm("interop_targets"))
	if !ok {
		ctx.JSON(http.StatusBadRequest, gin.H{"code": http.StatusBadRequest, "message": i18n.T(ctx, "query.invalid_interop_controls")})
		return
	}
	in.InteropTargets = interopTargets
	artifactIDs, ok := parseArtifactIDs(ctx.PostForm("artifact_ids"))
	if !ok {
		ctx.JSON(http.StatusBadRequest, gin.H{
			"code":    http.StatusBadRequest,
			"message": i18n.T(ctx, "query.invalid_artifact_ids"),
		})
		return
	}
	in.ArtifactIDs = artifactIDs
	// RESTful: conversation id from path /conversations/:id/messages (id=0 means a
	// new conversation, preserving the old DefaultPostForm("id","0") semantics).
	// refresh_id still travels in the multipart body.
	pathID := ctx.Param("id")
	if surface == api_service.QuerySurfaceAgentProduct && pathID == "" {
		pathID = "0"
	}
	in.Id, ok = parseNonnegativeInt64(pathID)
	if !ok {
		writeQueryError(ctx, http.StatusBadRequest, "invalid conversation id")
		return
	}
	in.RefreshId, ok = parseNonnegativeInt64(ctx.DefaultPostForm("refresh_id", "0"))
	if !ok {
		writeQueryError(ctx, http.StatusBadRequest, "invalid refresh id")
		return
	}

	if form != nil {
		for _, files := range form.File {
			if len(files) > 0 {
				ctx.JSON(http.StatusUnsupportedMediaType, gin.H{
					"code":    http.StatusUnsupportedMediaType,
					"message": i18n.T(ctx, "query.file_parts_unsupported"),
				})
				return
			}
		}
	}
	// SSE branch. Taken when the caller accepts text/event-stream. The
	// stream-capability restriction is enforced downstream in QueryStream (via
	// StreamModelFor); a non-capable slug reaching here is refused with
	// ErrStreamUnsupported before any frame. Forced stream-capable Expert turns
	// retain the permission checks in QueryStream; autonomous Expert and
	// non-stream-capable tools fail before any SSE header is written.
	// The route middleware (auth, per-user rate limit) and multipart parse above
	// have already run, so the gate order holds.
	if surface == api_service.QuerySurfaceChat && streamEnabled() && wantsStream(ctx) {
		flusher, canFlush := ctx.Writer.(http.Flusher)
		if canFlush {
			// Write the SSE headers lazily — only when the first frame is
			// actually forwarded. If QueryStream fails BEFORE any frame (a
			// pre-first-byte error: ErrGatewayDisabled, the expert/non-chat
			// ErrStreamUnsupported guards, ErrUnknownTool, or an upload /
			// dialogue-resolve / stream-open failure), the headers are still
			// unset, so the error can ship as a normal JSON response with the
			// correct Content-Type. Staging the SSE headers up front would pin
			// Content-Type: text/event-stream onto a JSON error body (Gin's
			// writeContentType only sets it when the header map is empty), and
			// an SSE-aware client would silently fail to
			// parse the error.
			headerSent := false
			onReady := func(identity api_service.StreamIdentity) {
				ctx.Header("X-Phyto-Dialogue-Id", identity.DialogueID)
				ctx.Header("X-Phyto-Message-Id", strconv.FormatInt(identity.MessageID, 10))
			}
			forward := func(frame []byte) error {
				if !headerSent {
					ctx.Header("Content-Type", "text/event-stream")
					ctx.Header("Cache-Control", "no-cache")
					ctx.Header("Connection", "keep-alive")
					ctx.Header("X-Accel-Buffering", "no")
					ctx.Status(http.StatusOK)
					headerSent = true
				}
				if _, werr := ctx.Writer.Write(frame); werr != nil {
					return werr
				}
				flusher.Flush()
				return nil
			}
			_, serr := ph.service.QueryStream(ctx, name.(string), in, onReady, forward)
			if serr != nil {
				rxLog.Sugar().Errorw("ApiQuery stream failed", queryFailureLogFields(ctx, name, serr)...)
				status, msg := queryErrorStatus(serr)
				if headerSent {
					// Frames already flushed: HTTP status is locked, so surface
					// the failure as an in-band SSE error frame. Encode the
					// message with json.Marshal so any character is escaped to
					// valid JSON (fmt's %q is Go-quoting, not JSON-quoting).
					msgJSON, _ := json.Marshal(msg)
					_, _ = fmt.Fprintf(ctx.Writer, "event: RunError\ndata: {\"type\":\"RunError\",\"message\":%s}\n\n", msgJSON)
					flusher.Flush()
				} else {
					// Pre-first-byte failure: no SSE headers were written, so a
					// normal JSON error with the right Content-Type still ships.
					writeQueryError(ctx, status, msg)
				}
			}
			return
		}
		// Writer cannot flush (test double / unusual proxy): fall through to
		// the blocking path rather than panicking.
	}

	data, err := ph.service.Query(serviceCtx, email, in)
	if err != nil {
		if errors.Is(err, api_service.ErrClientTurnSubmissionPending) && data != nil &&
			data.Id > 0 && strings.TrimSpace(data.DialogueId) != "" {
			ctx.Header("X-Phyto-Dialogue-Id", data.DialogueId)
			ctx.Header("X-Phyto-Message-Id", strconv.FormatInt(data.Id, 10))
		}
		status, msg := localizedQueryErrorStatus(ctx, err)
		if status >= http.StatusInternalServerError {
			rxLog.Sugar().Errorw("ApiQuery failed", queryFailureLogFields(ctx, name, err)...)
		} else {
			rxLog.Sugar().Warnw("ApiQuery client error", queryFailureLogFields(ctx, name, err, "status", status)...)
		}
		writeQueryError(ctx, status, msg)
		return
	}
	// QueryData carries the Web request id for client correlation. The service
	// normally derives it from Gin's context; keep the handler as the final
	// boundary so custom service contexts cannot drop the id from the envelope.
	if data.RequestID == "" {
		if requestID, ok := ctx.Get("x-request-id"); ok {
			if id, ok := requestID.(string); ok {
				data.RequestID = strings.TrimSpace(id)
			}
		}
	}
	ctx.JSON(errs.SucResp(data))
}

// ResumeQuestionStream is the owner-only SSE resume for an in-flight chat
// message. It replays unseen hub frames then tails until the run finishes.
func (ph *Handler) ResumeQuestionStream(ctx *gin.Context) {
	name, _ := ctx.Get("username")
	dialogueID := ctx.Param("id")
	messageID, ok := parsePositiveInt64(ctx.Param("message_id"))
	if !ok {
		writeQueryError(ctx, http.StatusBadRequest, "invalid message id")
		return
	}
	afterSeq, ok := parseResumeAfterSeq(ctx)
	if !ok {
		writeQueryError(ctx, http.StatusBadRequest, "invalid after")
		return
	}

	flusher, canFlush := ctx.Writer.(http.Flusher)
	if !canFlush {
		writeQueryError(ctx, http.StatusInternalServerError, "request failed")
		return
	}

	headerSent := false
	ensureSSE := func() {
		if headerSent {
			return
		}
		ctx.Header("Content-Type", "text/event-stream")
		ctx.Header("Cache-Control", "no-cache")
		ctx.Header("Connection", "keep-alive")
		ctx.Header("X-Accel-Buffering", "no")
		ctx.Status(http.StatusOK)
		headerSent = true
	}
	forward := func(frame api_service.StreamFrame) error {
		ensureSSE()
		if _, err := ctx.Writer.Write(frame.Bytes); err != nil {
			return err
		}
		flusher.Flush()
		return nil
	}

	err := ph.service.ResumeQuestionStream(ctx, name.(string), dialogueID, messageID, afterSeq, forward)
	if err == nil {
		ensureSSE()
		return
	}
	if errors.Is(err, gorm.ErrRecordNotFound) || errors.Is(err, api_service.ErrConversationLedgerNotFound) {
		writeQueryError(ctx, http.StatusNotFound, "conversation not found")
		return
	}
	if errors.Is(err, api_service.ErrStreamRunMissing) {
		ensureSSE()
		_, _ = ctx.Writer.Write([]byte("event: RunError\ndata: {\"type\":\"RunError\",\"code\":\"stream_run_missing\"}\n\n"))
		flusher.Flush()
		return
	}
	status, msg := queryErrorStatus(err)
	if headerSent {
		msgJSON, _ := json.Marshal(msg)
		_, _ = fmt.Fprintf(ctx.Writer, "event: RunError\ndata: {\"type\":\"RunError\",\"message\":%s}\n\n", msgJSON)
		flusher.Flush()
		return
	}
	if status >= http.StatusInternalServerError {
		rxLog.Sugar().Errorw("ResumeQuestionStream failed", "user", name, "err", err)
	}
	writeQueryError(ctx, status, msg)
}

// QueryAnalystUpdateLog syncs a finished remote task result back into the
// Web row. The Web app posts task_id plus compute_resource.
func (ph *Handler) QueryAnalystUpdateLog(ctx *gin.Context) {
	name, _ := ctx.Get("username")
	taskID := strings.TrimSpace(ctx.PostForm("task_id"))
	if taskID == "" {
		ctx.JSON(http.StatusBadRequest, gin.H{"code": http.StatusBadRequest, "message": i18n.T(ctx, "query.task_id_required")})
		return
	}
	computeResource := ctx.PostForm("compute_resource")

	result, err := ph.service.QueryAnalystUpdateLog(ctx, name.(string), taskID, computeResource)
	if err != nil {
		status, msg := queryErrorStatus(err)
		if status >= http.StatusInternalServerError {
			rxLog.Sugar().Errorw("ApiQueryAnalystUpdateLog failed", "user", name, "err", err)
		} else {
			rxLog.Sugar().Warnw("ApiQueryAnalystUpdateLog client error", "user", name, "status", status, "err", err)
		}
		writeQueryError(ctx, status, msg)
		return
	}
	ctx.JSON(errs.SucResp(result))
}
