package api_service

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	rxBot "phytomni-server/external/bot"
	rxLog "phytomni-server/log"
	"phytomni-server/model"

	"github.com/google/uuid"
)

// ErrGatewayDisabled is returned when the Bot proxy is turned off in config.
// The handler maps it to 503 (service unavailable) rather than a generic 500,
// so ops can tell a deliberate-off gateway from a real server failure.
var ErrGatewayDisabled = errors.New("bot gateway is disabled")

// ErrUnknownTool is returned when the requested tool resolves to no Bot slug.
// The handler maps it to 400 (client error) rather than a generic 500, since a
// bad tool name is a caller mistake, not a server fault.
var ErrUnknownTool = errors.New("unknown tool")

// ErrExpertDisabled is returned when mode=expert is requested while the Expert
// routing gateway is dark (BotConfig.ExpertEnabled=false). The handler maps it
// to 503 so a deliberately-dark Expert mode is distinguishable from a fault.
var ErrExpertDisabled = errors.New("expert mode not available")

// ErrMissingBotRunID is returned when a Web row exists but cannot be synced
// through Bot run state because it has no bot_run_id.
var ErrMissingBotRunID = errors.New("row has no bot_run_id to sync")

// ErrInvalidA2uiSurface marks a malformed native input-required pause. The
// blocking path returns it before persistence so no row can be stranded with
// a run that the browser cannot safely resume.
var ErrInvalidA2uiSurface = errors.New("invalid a2ui input-required surface")

// ErrStreamUnsupported marks a /query streaming request the SSE branch cannot
// serve (non-chat slug, or mode=expert which routes via /v1/query/route). The
// handler maps it to 400; expert traffic normally never reaches it because the
// handler's stream gate already excludes mode=expert (defense in depth).
var ErrStreamUnsupported = errors.New("streaming not supported for this request")

// ErrInteropRequired means an explicit required delegation could not be
// proven from the authenticated, sanitized discovery snapshot. It is returned
// before any local or Bot agent submission so missing external evidence cannot
// look like a successful local run.
var ErrInteropRequired = errors.New("required interop evidence unavailable")

// ErrInteropTargetForbidden means the requested target id was not present as an
// available, allowlisted target in the Web-owned discovery snapshot.
var ErrInteropTargetForbidden = errors.New("interop target is not allowlisted")

// QueryFile is one uploaded attachment, read into memory by the handler.
type QueryFile struct {
	Filename string
	Data     []byte
}

// QueryInput is the parsed /query multipart form.
type QueryInput struct {
	Query          string
	Id             int64 // the Web app's threading id: 0 = new conversation, else parent row id
	Tool           string
	RefreshId      int64 // !=0 = re-answer an existing turn (UPDATE that row)
	History        string
	Mode           string // "instant" (default) | "expert"
	Files          []QueryFile
	InteropMode    string
	InteropTargets []string
}

// QueryData is the response payload the Web app reads off response.data. The
// content fields are relayed from Bot; id/reaction are Web-owned.
type QueryData struct {
	Id                int64              `json:"id"`
	ToolName          string             `json:"tool_name"`
	Answer            string             `json:"answer"`
	FollowUpQuestions string             `json:"follow_up_questions"`
	Status            string             `json:"status"`
	UploadPath        string             `json:"upload_path"`
	DownloadPath      string             `json:"download_path"`
	ServerFilePath    string             `json:"server_file_path"`
	ComputeResource   string             `json:"compute_resource"`
	ReactionType      string             `json:"reaction_type"`
	DialogueId        string             `json:"dialogue_id"`
	BotRunID          string             `json:"bot_run_id,omitempty"`
	TaskId            string             `json:"task_id,omitempty"`
	TrackingDegraded  bool               `json:"tracking_degraded,omitempty"`
	ReportRevision    int64              `json:"report_revision,omitempty"`
	RequestID         string             `json:"request_id,omitempty"`
	A2UI              *A2uiSurfaceDTO    `json:"a2ui,omitempty"`
	DegradedInterop   bool               `json:"degraded_interop,omitempty"`
	InterOp           *InteropProvenance `json:"interop,omitempty"`
}

// StreamIdentity is the Web-owned identity of a streamed assistant message.
// QueryStream publishes it only after the RUNNING row is durable, before any
// Bot frame can reach the browser. The handler exposes these values as response
// headers so the frontend never has to infer an A2UI route from a parent row.
type StreamIdentity struct {
	DialogueID string
	MessageID  int64
}

// slugToToolName maps a Bot slug back to the tool_name the Web app renders by.
var slugToToolName = map[string]string{
	"chat":        "ChatAgent",
	"knowledge":   "KnowledgeAgent",
	"data":        "DataAgent",
	"analyst":     "AnalystAgent",
	"review":      "ReviewAgent",
	"deep_genome": "DeepGenomeAgent",
	"brief_gene":  "BriefGeneAgent",
	"research":    "InSilicoResearchAgent",
	"design":      "DigitalDesignAgent",
	"network":     "GeneNetworkAgent",
}

// ExpertModeEnabled reports whether Expert routing is live. It is the single
// source of truth shared by the /query gateway gate and the UI pill flag.
func (ps *Service) ExpertModeEnabled() bool {
	return rxBot.BotConfig != nil && rxBot.BotConfig.ExpertEnabled
}

func requestIDFromContext(ctx context.Context) string {
	if ctx == nil {
		return ""
	}
	if id, ok := ctx.Value("x-request-id").(string); ok {
		return strings.TrimSpace(id)
	}
	return ""
}

type interopDecision struct {
	Mode       string
	Targets    []string
	Provenance InteropProvenance
	Degraded   bool
}

func interopAgent(slug string) bool {
	return slug == "research" || slug == "design"
}

func interopErrorCode(err error) string {
	switch {
	case errors.Is(err, ErrInteropDisabled):
		return "disabled"
	case errors.Is(err, ErrInteropForbidden):
		return "forbidden"
	case errors.Is(err, ErrInteropUnavailable):
		return "unavailable"
	default:
		return "discovery_failed"
	}
}

func localInteropDecision(mode string) interopDecision {
	return interopDecision{
		Mode: mode,
		Provenance: InteropProvenance{
			Mode:   mode,
			Status: "local",
		},
	}
}

func degradedInteropDecision(mode, targetID, code string) interopDecision {
	return interopDecision{
		Mode:     "off",
		Degraded: true,
		Provenance: InteropProvenance{
			Mode:     mode,
			Status:   "degraded",
			TargetID: targetID,
			Code:     code,
		},
	}
}

func failedInteropDecision(mode, targetID, code string) interopDecision {
	return interopDecision{
		Mode: "off",
		Provenance: InteropProvenance{
			Mode:     mode,
			Status:   "failed",
			TargetID: targetID,
			Code:     code,
		},
	}
}

func queryInteropProvenancePtr(slug string, decision interopDecision) *InteropProvenance {
	if !interopAgent(slug) {
		return nil
	}
	return interopProvenancePtr(decision.Provenance)
}

// prepareInterop applies the Web-owned delegation policy before any upload,
// dialogue write, or Bot agent submission. Discovery is advisory evidence only;
// endpoint/credential/peer payloads never enter this decision.
func (ps *Service) prepareInterop(ctx context.Context, username, slug, mode string, targets []string) (interopDecision, error) {
	if !interopAgent(slug) {
		return localInteropDecision("off"), nil
	}
	normalizedMode, normalizedTargets, err := rxBot.ValidateInteropControls(mode, targets)
	if err != nil {
		decision := failedInteropDecision(mode, "", "invalid_request")
		return decision, fmt.Errorf("%w: invalid interop controls", ErrInteropTargetForbidden)
	}
	if normalizedMode == "off" {
		return localInteropDecision("off"), nil
	}
	if len(normalizedTargets) == 0 {
		if normalizedMode == "required" {
			return failedInteropDecision(normalizedMode, "", "no_evidence"), ErrInteropRequired
		}
		return degradedInteropDecision(normalizedMode, "", "no_evidence"), nil
	}

	caps, discoveryErr := ps.InteropCapabilities(ctx, username)
	if discoveryErr != nil {
		if normalizedMode == "required" {
			return failedInteropDecision(normalizedMode, normalizedTargets[0], interopErrorCode(discoveryErr)), ErrInteropRequired
		}
		return degradedInteropDecision(normalizedMode, normalizedTargets[0], interopErrorCode(discoveryErr)), nil
	}

	available := make(map[string]InteropTarget)
	failed := make(map[string]InteropTarget)
	for _, target := range caps.Targets {
		switch target.Status {
		case "available":
			available[target.TargetID] = target
		case "failed":
			failed[target.TargetID] = target
		}
	}
	var firstAvailable InteropTarget
	for index, targetID := range normalizedTargets {
		if target, ok := available[targetID]; ok {
			if index == 0 {
				firstAvailable = target
			}
			continue
		}
		if target, ok := failed[targetID]; ok {
			code := target.Code
			if code == "" {
				code = "target_unavailable"
			}
			if normalizedMode == "required" {
				return failedInteropDecision(normalizedMode, targetID, code), ErrInteropRequired
			}
			return degradedInteropDecision(normalizedMode, targetID, code), nil
		}
		// A syntactically valid but undiscovered id is outside the runtime
		// allowlist. Do not silently drop it or submit a local pseudo-success.
		return failedInteropDecision(normalizedMode, targetID, "target_unavailable"), ErrInteropTargetForbidden
	}
	if firstAvailable.TargetID == "" {
		return failedInteropDecision(normalizedMode, "", "no_evidence"), ErrInteropRequired
	}
	return interopDecision{
		Mode:    normalizedMode,
		Targets: append([]string(nil), normalizedTargets...),
		Provenance: InteropProvenance{
			Mode:     normalizedMode,
			Status:   "delegated",
			TargetID: firstAvailable.TargetID,
			Kind:     firstAvailable.Kind,
		},
	}, nil
}

func canonicalBotRunID(runID *string) string {
	if runID == nil {
		return ""
	}
	return strings.TrimSpace(*runID)
}

// resolveExpertAgent validates the Bot router's selected slug against both
// Web-owned canonical maps before any tool name, answer shape, or projection
// lifecycle is derived from the response. Expert is a cross-service boundary:
// a missing/unknown/malformed slug must never fall back to ChatAgent.
func resolveExpertAgent(resp *rxBot.RouteQueryResponse) (string, string, error) {
	if resp == nil {
		return "", "", fmt.Errorf("%w: expert response is missing", ErrUnknownTool)
	}
	rawSlug := resp.Agent
	slug := strings.TrimSpace(rawSlug)
	if slug == "" || rawSlug != slug || strings.ContainsAny(rawSlug, "\r\n\t") {
		return "", "", fmt.Errorf("%w: expert response has an invalid agent", ErrUnknownTool)
	}
	canonicalTool, ok := rxBot.CanonicalAgentTool[slug]
	if !ok || slugToToolName[slug] != canonicalTool {
		return "", "", fmt.Errorf("%w: expert response has an unsupported agent", ErrUnknownTool)
	}
	return slug, canonicalTool, nil
}

func responseReportRevision(values ...*int64) int64 {
	for _, value := range values {
		if value != nil && *value >= 0 {
			return *value
		}
	}
	return 0
}

func responseReportRevisionOrDefault(defaultValue int64, values ...*int64) int64 {
	for _, value := range values {
		if value != nil && *value >= 0 {
			return *value
		}
	}
	return defaultValue
}

func metadataReportRevision(raw json.RawMessage) *int64 {
	if len(bytes.TrimSpace(raw)) == 0 || bytes.Equal(bytes.TrimSpace(raw), []byte("null")) {
		return nil
	}
	var metadata struct {
		ReportRevision *int64 `json:"report_revision"`
	}
	if err := json.Unmarshal(raw, &metadata); err != nil || metadata.ReportRevision == nil || *metadata.ReportRevision < 0 {
		return nil
	}
	return metadata.ReportRevision
}

func formattedMetadata(formatted *rxBot.Formatted) json.RawMessage {
	if formatted == nil {
		return nil
	}
	return formatted.Metadata
}

func decodeInputRequiredSurface(interrupt *rxBot.AgentRunInterrupt) (*A2uiSurfaceDTO, error) {
	if interrupt == nil || len(bytes.TrimSpace(interrupt.Draft)) == 0 {
		return nil, ErrInvalidA2uiSurface
	}
	entries, ok := decodeA2uiObjectEntries(interrupt.Draft)
	if !ok {
		return nil, ErrInvalidA2uiSurface
	}
	var rawSurface json.RawMessage
	for _, entry := range entries {
		if entry.key == "a2ui" {
			rawSurface = entry.value
			break
		}
	}
	if len(bytes.TrimSpace(rawSurface)) == 0 {
		return nil, ErrInvalidA2uiSurface
	}
	surface, err := DecodeA2uiSurface(rawSurface)
	if err != nil {
		return nil, ErrInvalidA2uiSurface
	}
	return surface, nil
}

func logBotResponseMeta(ctx context.Context, meta rxBot.ResponseMeta) {
	if strings.TrimSpace(meta.BotRequestID) == "" {
		return
	}
	rxLog.SugarContext(ctx).Debugw("Bot response received", "bot_request_id", meta.BotRequestID)
}

// Query is the gateway orchestration: upload files to Bot, dispatch to the
// resolved agent, persist a Web-side row (Bot owns the content; Web keeps the
// ownership/threading record plus a transitional content fallback), and return
// exactly what the Web app consumes.
//
// Threading model (reconstructed from the surviving read paths QueryList /
// AnswerCheck, not from the deleted Python service):
//   - parent rows have f_id = 0 and carry the conversation title_query;
//   - child rows have f_id = <parent row id> and share the parent dialogue_id.
//
// So Id=0 starts a new conversation (fresh dialogue_id), Id=N appends a child
// to parent N, and RefreshId!=0 re-answers an existing row in place.
func (ps *Service) Query(ctx context.Context, username string, in QueryInput) (*QueryData, error) {
	if rxBot.BotConfig == nil || !rxBot.BotConfig.ProxyEnabled {
		return nil, ErrGatewayDisabled
	}
	// Expert mode is dark-launched: refuse early (no Bot call) when disabled.
	if in.Mode == "expert" && !rxBot.BotConfig.ExpertEnabled {
		return nil, ErrExpertDisabled
	}
	// Expert routes through Bot's semantic router before Web learns which agent
	// was selected. Require the complete remote product capability set before
	// any upload, dialogue resolution, or RouteQueryWithMeta call.
	if in.Mode == "expert" {
		if err := ps.CheckExpertRemoteProductsAllowed(ctx, username); err != nil {
			return nil, err
		}
	}
	// Every explicit remote product tool is gated, including zero-value direct
	// service calls whose Mode is empty. Only the legacy zero-value tool remains
	// unscoped and continues to default to ChatAgent below.
	if isRemoteProductTool(in.Tool) {
		if err := ps.CheckRemoteProductAllowed(ctx, username, in.Tool); err != nil {
			return nil, err
		}
	}
	// 1. Web-owned alias -> Bot slug. Empty tool defaults to the chat agent.
	// Expert deliberately ignores the picker value: the Bot router resolves the
	// canonical slug, and a stale/unknown client-side tool must not steer it.
	var slug string
	if in.Mode != "expert" {
		var ok bool
		slug, ok = rxBot.SlugFor(in.Tool)
		if !ok {
			return nil, fmt.Errorf("%w %q", ErrUnknownTool, in.Tool)
		}
	}
	interop := localInteropDecision("off")
	var err error
	if in.Mode != "expert" {
		interop, err = ps.prepareInterop(ctx, username, slug, in.InteropMode, in.InteropTargets)
		if err != nil {
			failed := &QueryData{
				Status:          "FAILED",
				DegradedInterop: interop.Degraded,
				InterOp:         queryInteropProvenancePtr(slug, interop),
			}
			return failed, err
		}
		in.InteropMode = interop.Mode
		in.InteropTargets = append([]string(nil), interop.Targets...)
	}

	client := rxBot.NewClient()

	// 2. Upload attachments to Bot OBS; keep names/paths for the Web row and
	//    the structured obs_file_list passed to capable chat models. This runs
	//    only after required interop evidence and target authorization succeed.
	var obsPaths, fileNames []string
	for _, f := range in.Files {
		up, err := client.UploadFile(ctx, f.Filename, "", bytes.NewReader(f.Data))
		if err != nil {
			return nil, err
		}
		obsPaths = append(obsPaths, up.Path)
		fileNames = append(fileNames, f.Filename)
	}

	// 3. Resolve dialogue_id + f_id from the threading model above. Ownership
	//    is enforced by user_name so a caller cannot thread onto, or overwrite,
	//    another user's conversation (real-user isolation lives in Web Go).
	dialogueID, fID, err := ps.resolveDialogue(ctx, username, in)
	if err != nil {
		return nil, err
	}

	// 4. Dispatch. Web Go never runs an LLM; it forwards free-form query text
	//    (and structured obs_file_list to capable chat models).
	out := &QueryData{
		ToolName:        "",
		ReactionType:    "0",
		DialogueId:      dialogueID,
		Status:          "SUCCEEDED",
		RequestID:       requestIDFromContext(ctx),
		DegradedInterop: interop.Degraded,
		InterOp:         queryInteropProvenancePtr(slug, interop),
	}
	if slug != "" {
		out.ToolName = slugToToolName[slug]
	}
	var botRunID, serverID, taskID, logStatus string
	var expertProjection *BotRunProjection
	if in.Mode == "expert" {
		resp, meta, err := client.RouteQueryWithMeta(ctx, rxBot.RouteQueryRequest{
			UserQuery:   in.Query,
			History:     parseHistory(in.History),
			OBSFileList: obsPaths,
			DialogueID:  dialogueID,
			ForcedTool:  nil,
		})
		logBotResponseMeta(ctx, meta)
		if err != nil {
			return nil, err
		}
		resolvedSlug, resolvedTool, err := resolveExpertAgent(resp)
		if err != nil {
			return nil, err
		}
		submission, err := DecodeAgentRunSubmission(resp)
		if err != nil {
			var projectionErr *ProjectionDecodeError
			if errors.As(err, &projectionErr) && projectionErr.Field == "run_id" {
				return nil, ErrMissingBotRunID
			}
			// Keep malformed upstream envelopes on the bounded client-error path;
			// never expose decoder details or fabricate a successful tool.
			return nil, fmt.Errorf("%w: invalid expert response", ErrUnknownTool)
		}
		if submission.Agent != resolvedSlug {
			return nil, fmt.Errorf("%w: expert response agent mismatch", ErrUnknownTool)
		}
		routeRevision := metadataReportRevision(formattedMetadata(resp.Result.Formatted))
		submission.ReportRevision = responseReportRevisionOrDefault(-1, resp.ReportRevision, resp.Result.ReportRevision, routeRevision)
		submission.TrackingDegraded = resp.DegradedTracking
		expertProjection = &submission
		slug = resolvedSlug
		out.ToolName = resolvedTool
		botRunID = submission.RunID
		out.BotRunID = botRunID
		out.TrackingDegraded = resp.DegradedTracking
		if submission.InterOp != nil {
			if strings.TrimSpace(submission.InterOp.Mode) == "" {
				submission.InterOp.Mode = "off"
			}
			out.InterOp = interopProvenancePtr(*submission.InterOp)
		}
		out.DegradedInterop = out.DegradedInterop || submission.DegradedInterop
		out.ReportRevision = responseReportRevision(resp.ReportRevision, resp.Result.ReportRevision, routeRevision)
		// Reshape by the slug Bot's router CHOSE (never "expert"), so cited/table
		// formatting survives and SyncBotRuns reconciles async runs by agent slug.
		if submission.Status == "SUCCEEDED" {
			if resp.Result.Formatted != nil {
				out.Answer = rxBot.ShapeAnswer(resolvedSlug, resp.Result.Formatted.Answer, resp.Result.Formatted)
				out.FollowUpQuestions = string(resp.Result.Formatted.FollowUpQuestions)
			}
		} else if submission.Status == "FAILED" {
			// A required interop failure may arrive as status=running with
			// formatted.metadata.status=FAILED and no task ids. The projection
			// decoder has already normalized that nested outcome; keep the row
			// terminal and never invent a pollable task.
			out.Status = "FAILED"
			if resp.Result.Formatted != nil {
				out.Answer = rxBot.ShapeAnswer(resolvedSlug, resp.Result.Formatted.Answer, resp.Result.Formatted)
				out.FollowUpQuestions = string(resp.Result.Formatted.FollowUpQuestions)
			}
		} else {
			out.Status = submission.Status
			logStatus = "sync_running"
			if resp.Result.DedupHit {
				taskID = resp.Result.TaskID
			} else if len(resp.TaskIDs) > 0 {
				taskID = resp.TaskIDs[0]
			}
			out.Answer = "Task created: " + taskID
		}
	} else if chatModel, isChat := rxBot.ChatModelFor(slug); isChat {
		req := rxBot.ChatCompletionRequest{
			Model:      chatModel,
			Messages:   []rxBot.ChatMessage{{Role: "user", Content: in.Query}},
			DialogueID: dialogueID,
		}
		if len(obsPaths) > 0 {
			req.OBSFileList = obsPaths
		}
		resp, meta, err := client.ChatCompletionWithMeta(ctx, req)
		logBotResponseMeta(ctx, meta)
		if err != nil {
			return nil, err
		}
		botRunID = canonicalBotRunID(resp.RunID)
		out.BotRunID = botRunID
		out.TrackingDegraded = resp.DegradedTracking
		out.ReportRevision = responseReportRevision(resp.ReportRevision, metadataReportRevision(resp.Formatted.Metadata), metadataReportRevision(formattedMetadata(resp.Result.Formatted)))
		if strings.EqualFold(strings.TrimSpace(resp.Status), "input_required") {
			// Review's native pause is returned from the chat endpoint as an
			// agent.run envelope. Decode only interrupt.draft.a2ui and never
			// assume choices[0] exists for this shape.
			surface, surfaceErr := decodeInputRequiredSurface(resp.Interrupt)
			if surfaceErr != nil {
				return nil, surfaceErr
			}
			if botRunID == "" {
				return nil, ErrMissingBotRunID
			}
			out.Status = "INPUT_REQUIRED"
			out.A2UI = surface
		} else {
			// Default-mode chat/completions strips formatted.answer into
			// choices[0].message.content; source it there, then reshape per slug
			// (knowledge/review become {content, doc_list}; chat stays plain).
			if strings.EqualFold(strings.TrimSpace(resp.Status), "succeeded") && len(resp.Choices) == 0 && resp.Result.Formatted != nil {
				out.Answer = rxBot.ShapeAnswer(slug, resp.Result.Formatted.Answer, resp.Result.Formatted)
				out.FollowUpQuestions = string(resp.Result.Formatted.FollowUpQuestions)
			} else {
				out.Answer = rxBot.ShapeAnswer(slug, rxBot.ChatAnswerText(resp), &resp.Formatted)
				out.FollowUpQuestions = string(resp.Formatted.FollowUpQuestions)
			}
		}
	} else {
		// /v1/agents/{slug}/runs serves BOTH synchronous agents (data → 200,
		// status="succeeded", answer already in result.formatted) AND remote
		// agents (analyst, deep_genome, research, design, network → 202,
		// status="running", answer polled later via /query/analyst/update_log).
		// Branch on the returned status;
		// never assume remote, or a sync agent's answer is silently dropped.
		args, err := rxBot.BuildAgentArguments(slug, rxBot.AgentArgumentInput{
			UserQuery:      in.Query,
			OBSFileList:    obsPaths,
			InteropMode:    in.InteropMode,
			InteropTargets: in.InteropTargets,
		})
		if err != nil {
			return nil, err
		}
		resp, meta, err := client.InvokeAgentWithMeta(ctx, slug, rxBot.AgentRunRequest{
			Arguments:  args,
			DialogueID: dialogueID,
		})
		logBotResponseMeta(ctx, meta)
		if err != nil {
			return nil, err
		}
		botRunID = canonicalBotRunID(resp.RunID)
		out.BotRunID = botRunID
		out.TrackingDegraded = resp.DegradedTracking
		out.ReportRevision = responseReportRevision(resp.ReportRevision, resp.Result.ReportRevision, metadataReportRevision(formattedMetadata(resp.Result.Formatted)))
		interopMetadata, metadataErr := decodeFormattedInteropMetadata(formattedMetadata(resp.Result.Formatted))
		if metadataErr != nil {
			return nil, metadataErr
		}
		if interopAgent(slug) {
			out.DegradedInterop = out.DegradedInterop || interopMetadata.DegradedInterop
			if interopProjection := interopMetadata.projection(); interopProjection != nil {
				interopProjection.Mode = interop.Provenance.Mode
				out.InterOp = interopProjection
			}
		}
		responseStatus := strings.ToUpper(strings.TrimSpace(resp.Status))
		if interopAgent(slug) && interopMetadata.failed(len(resp.TaskIDs) == 0 && strings.TrimSpace(resp.Result.TaskID) == "") {
			responseStatus = "FAILED"
		}
		if responseStatus == "SUCCEEDED" {
			// Synchronous agent (e.g. data): the answer is already here.
			if resp.Result.Formatted != nil {
				// Reshape the sync agent payload (data -> {headers, rows}).
				out.Answer = rxBot.ShapeAnswer(slug, resp.Result.Formatted.Answer, resp.Result.Formatted)
				out.FollowUpQuestions = string(resp.Result.Formatted.FollowUpQuestions)
			}
			// out.Status stays "SUCCEEDED".
		} else if responseStatus == "FAILED" {
			// Bot's bounded interop metadata is authoritative for a terminal
			// required failure even when the umbrella response still says running.
			out.Status = "FAILED"
			if resp.Result.Formatted != nil {
				out.Answer = rxBot.ShapeAnswer(slug, resp.Result.Formatted.Answer, resp.Result.Formatted)
				out.FollowUpQuestions = string(resp.Result.Formatted.FollowUpQuestions)
			}
		} else {
			// Remote agent: only a task id is back; the answer arrives later.
			out.Status = "RUNNING"
			logStatus = "sync_running"
			if resp.Result.DedupHit {
				taskID = resp.Result.TaskID
			} else if len(resp.TaskIDs) > 0 {
				taskID = resp.TaskIDs[0]
			}
			if slug == "deep_genome" {
				serverID = taskID
				out.Answer = "Server task created: " + serverID
			} else {
				out.Answer = "Task created: " + taskID
			}
		}
	}

	if (out.Status == "RUNNING" || out.Status == "INPUT_REQUIRED") && botRunID == "" {
		// A child task id cannot be used as the Bot run join key. Refuse to
		// persist an unpollable row even when a legacy response has task_ids.
		return nil, ErrMissingBotRunID
	}
	out.TaskId = taskID

	// 5. Persist the Web row (INSERT new, or UPDATE on refresh).
	titleQuery := ""
	if fID == 0 && in.RefreshId == 0 {
		titleQuery = in.Query // first turn of a new conversation is its title
	}
	row := model.QuestionAgentLog{
		DialogueId:        dialogueID,
		FId:               fID,
		ServerId:          serverID,
		BotRunId:          botRunID,
		UserName:          username,
		Query:             in.Query,
		TitleQuery:        titleQuery,
		Answer:            out.Answer,
		FollowUpQuestions: out.FollowUpQuestions,
		TaskId:            taskID,
		TaskLog:           "",
		FileName:          strings.Join(fileNames, ","),
		UploadPath:        strings.Join(obsPaths, ","),
		DownloadPath:      "",
		ComputeResource:   "",
		ServerFilePath:    "", // not the task id; the output file path is filled by update_log once the remote task emits it
		ToolName:          out.ToolName,
		Status:            out.Status,
		LogStatus:         logStatus,
		Mode:              in.Mode,
		ReactionType:      "0",
		CollectType:       "0",
	}

	id, err := ps.persistQuestionLog(ctx, username, in.RefreshId, &row)
	if err != nil {
		return nil, err
	}
	out.Id = id
	out.UploadPath = strings.Join(obsPaths, ",")
	if expertProjection != nil {
		// The row now exists, so the accepted Expert submission can enter the
		// same owner-scoped projection store used by polling/reconciliation.
		if err := SaveBotRunProjection(ctx, username, id, *expertProjection); err != nil {
			return nil, err
		}
	}
	if expertProjection == nil && interopAgent(slug) {
		projection := BotRunProjection{
			RunID:           botRunID,
			Agent:           slug,
			Status:          out.Status,
			ReportRevision:  -1,
			DegradedInterop: out.DegradedInterop,
			InterOp:         out.InterOp,
		}
		if err := SaveBotRunProjection(ctx, username, id, projection); err != nil {
			return nil, err
		}
	}
	return out, nil
}

// resolveDialogue returns the dialogue_id and f_id for this turn, scoping every
// lookup to the authenticated user_name so a caller can only refresh or thread
// onto their own rows.
func (ps *Service) resolveDialogue(ctx context.Context, username string, in QueryInput) (string, int64, error) {
	if in.RefreshId != 0 {
		var row model.QuestionAgentLog
		if err := model.DB(ctx).Model(&model.QuestionAgentLog{}).
			Where("id = ? AND user_name = ?", in.RefreshId, username).First(&row).Error; err != nil {
			return "", 0, err
		}
		return row.DialogueId, row.FId, nil
	}
	if in.Id == 0 {
		return uuid.NewString(), 0, nil
	}
	var parent model.QuestionAgentLog
	if err := model.DB(ctx).Model(&model.QuestionAgentLog{}).
		Where("id = ? AND user_name = ?", in.Id, username).First(&parent).Error; err != nil {
		return "", 0, err
	}
	return parent.DialogueId, in.Id, nil
}

// parseHistory converts the flat history JSON string the Web app sends into the
// structured [{role, content}] array Bot's router consumes. Best-effort: a
// malformed/empty string yields nil (no history), never an error.
func parseHistory(s string) []rxBot.ChatMessage {
	if s == "" || s == "[]" {
		return nil
	}
	var msgs []rxBot.ChatMessage
	_ = json.Unmarshal([]byte(s), &msgs)
	return msgs
}

const botProjectionApplyAttempts = 3

// applyBotRunProjection is the single Bot-run reconciliation path used by the
// cron poller and the legacy update-log endpoint. It decodes the bounded run
// projection once, merges it through the owner-scoped revision CAS, and only
// writes non-blank compatibility columns so partial/older snapshots cannot
// erase a report or invent an artifact URL.
func (ps *Service) applyBotRunProjection(ctx context.Context, row *model.QuestionAgentLog, rec *rxBot.RunRecord, meta rxBot.ResponseMeta) error {
	if row == nil || rec == nil {
		return errors.New("bot projection requires a row and run record")
	}
	if strings.TrimSpace(row.UserName) == "" {
		return errors.New("bot projection row has no owner")
	}

	statusPresent := strings.TrimSpace(rec.Status) != ""
	decodeRecord := *rec
	if !statusPresent {
		// Update-log is a best-effort compatibility endpoint. Preserve its
		// historical behavior for a response with no status by decoding against
		// the already-persisted state, while deliberately omitting a status write.
		decodeRecord.Status = row.Status
		if strings.TrimSpace(decodeRecord.Status) == "" {
			decodeRecord.Status = "running"
		}
	}
	projection, err := DecodeRunProjection(&decodeRecord)
	if err != nil {
		return err
	}
	if projection.RunID != strings.TrimSpace(row.BotRunId) {
		return fmt.Errorf("bot projection run id %q does not match row", projection.RunID)
	}
	projection.RequestID = strings.TrimSpace(meta.BotRequestID)
	logBotResponseMeta(ctx, meta)

	for attempt := 0; attempt < botProjectionApplyAttempts; attempt++ {
		if err := SaveBotRunProjection(ctx, row.UserName, row.Id, projection); err != nil {
			return err
		}
		// SaveBotRunProjection may have merged an equal/older snapshot into a
		// newer concurrent projection. Read the CAS winner back before touching
		// legacy answer/artifact columns; otherwise a stale poll could overwrite
		// the durable projection's visible report even though the JSON CAS was
		// correctly rejected.
		storedProjection, err := LoadBotRunProjection(ctx, row.UserName, row.Id)
		if err != nil {
			return err
		}
		updates := botProjectionLegacyUpdates(projection, storedProjection, rec, statusPresent)
		if len(updates) == 0 {
			return nil
		}
		result := model.DB(ctx).Model(&model.QuestionAgentLog{}).
			Where("id = ? AND user_name = ? AND bot_report_revision = ?", row.Id, row.UserName, storedProjection.ReportRevision).
			Updates(updates)
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected == 1 {
			return nil
		}
	}
	return ErrBotProjectionConflict
}

func botProjectionLegacyUpdates(incoming, stored BotRunProjection, rec *rxBot.RunRecord, statusPresent bool) map[string]interface{} {
	updates := make(map[string]interface{})
	if statusPresent && stored.Status != "" {
		updates["status"] = stored.Status
	}

	visible := strings.TrimSpace(stored.VisibleReport())
	if visible != "" {
		formatted, _, hasFormatted := rxBot.ParseRunFormatted(rec.Result)
		if strings.TrimSpace(incoming.VisibleReport()) != visible {
			hasFormatted = false
		}
		if hasFormatted {
			if shaped := rxBot.ShapeAnswer(stored.Agent, stored.VisibleReport(), formatted); shaped != "" {
				updates["answer"] = shaped
			}
		} else if shaped := rxBot.ShapeAnswer(stored.Agent, stored.VisibleReport(), nil); shaped != "" {
			updates["answer"] = shaped
		}
		if hasFormatted && len(formatted.FollowUpQuestions) > 0 && strings.TrimSpace(string(formatted.FollowUpQuestions)) != "" && strings.TrimSpace(string(formatted.FollowUpQuestions)) != "null" {
			updates["follow_up_questions"] = string(formatted.FollowUpQuestions)
		}
	}

	if len(stored.Artifacts.Directories) > 0 && strings.TrimSpace(stored.Artifacts.Directories[0]) != "" {
		updates["download_path"] = stored.Artifacts.Directories[0]
	}
	if len(stored.Artifacts.Paths) > 0 {
		if encoded, err := json.Marshal(stored.Artifacts.Paths); err == nil {
			updates["image_paths"] = string(encoded)
		}
	}
	return updates
}

func taskLogMatchesID(log map[string]interface{}, taskID string) bool {
	taskID = strings.TrimSpace(taskID)
	if taskID == "" {
		return false
	}
	for _, key := range []string{"task_id", "id"} {
		value, ok := log[key]
		if !ok {
			continue
		}
		switch typed := value.(type) {
		case string:
			if strings.TrimSpace(typed) == taskID {
				return true
			}
		case json.Number:
			if typed.String() == taskID {
				return true
			}
		case float64:
			if fmt.Sprintf("%g", typed) == taskID {
				return true
			}
		}
	}
	return false
}

func taskLogHasExplicitID(log map[string]interface{}) bool {
	for _, key := range []string{"task_id", "id"} {
		if _, ok := log[key]; ok {
			return true
		}
	}
	return false
}

func encodeMatchingTaskLog(logs *rxBot.RunLogsResponse, taskID string) (string, bool) {
	if logs == nil {
		return "", false
	}
	for index, log := range logs.TaskLogs {
		if taskLogMatchesID(log, taskID) {
			encoded, err := json.Marshal(log)
			if err != nil || len(encoded) == 0 {
				return "", false
			}
			return string(encoded), true
		}
		// Prefer an explicit child id over positional inference. If Bot gives a
		// different explicit id, the entry cannot belong to this update-log task
		// even when its array index happens to line up.
		if _, hasTaskID := log["task_id"]; hasTaskID {
			continue
		}
		if _, hasID := log["id"]; hasID {
			continue
		}
		if index >= len(logs.TaskIDs) || strings.TrimSpace(logs.TaskIDs[index]) != strings.TrimSpace(taskID) {
			continue
		}
		encoded, err := json.Marshal(log)
		if err != nil || len(encoded) == 0 {
			return "", false
		}
		return string(encoded), true
	}
	// Bot's reconciled payload is allowed to omit the child id because the
	// sibling `task_ids` array carries the identity. A single returned log is
	// therefore safe to associate with the update-log task; with multiple
	// sparse logs, only the index-aligned branch above is deterministic.
	if len(logs.TaskLogs) == 1 && len(logs.TaskIDs) == 1 && strings.TrimSpace(logs.TaskIDs[0]) == strings.TrimSpace(taskID) && !taskLogHasExplicitID(logs.TaskLogs[0]) {
		encoded, err := json.Marshal(logs.TaskLogs[0])
		if err == nil && len(encoded) > 0 {
			return string(encoded), true
		}
	}
	return "", false
}

// QueryAnalystUpdateLog syncs a finished remote task's result back into the
// Web row. The Web app posts both task_id and compute_resource.
func (ps *Service) QueryAnalystUpdateLog(ctx context.Context, username, taskID, computeResource string) (string, error) {
	if rxBot.BotConfig == nil || !rxBot.BotConfig.ProxyEnabled {
		return "", ErrGatewayDisabled
	}
	var row model.QuestionAgentLog
	if err := model.DB(ctx).Model(&model.QuestionAgentLog{}).
		Where("user_name = ? AND task_id = ?", username, taskID).First(&row).Error; err != nil {
		return "", err
	}
	if row.BotRunId == "" {
		return "", ErrMissingBotRunID
	}
	client := rxBot.NewClient()
	rec, meta, err := client.GetRunWithMeta(ctx, row.BotRunId)
	if err != nil {
		return "", err
	}
	if err := ps.applyBotRunProjection(ctx, &row, rec, meta); err != nil {
		return "", err
	}

	updates := map[string]interface{}{
		"compute_resource": computeResource,
		"log_status":       "sync_succeeded",
	}
	if logs, logsErr := client.GetRunLogs(ctx, row.BotRunId); logsErr == nil {
		if taskLog, ok := encodeMatchingTaskLog(logs, taskID); ok {
			updates["task_log"] = taskLog
		}
	} else {
		// Run logs are a compatibility enrichment. Bot documents a sparse,
		// best-effort logs response; a log-service outage must not discard the
		// already-reconciled run projection.
		rxLog.SugarContext(ctx).Warnw("Bot run logs unavailable", "run_id", row.BotRunId, "err", logsErr)
	}
	if err := model.DB(ctx).Model(&model.QuestionAgentLog{}).
		Where("id = ? AND user_name = ?", row.Id, row.UserName).
		Updates(updates).Error; err != nil {
		return "", err
	}

	projection, projectionErr := LoadBotRunProjection(ctx, username, row.Id)
	if projectionErr != nil {
		return "", projectionErr
	}
	if strings.TrimSpace(projection.VisibleReport()) == "" {
		return "", nil
	}
	formatted, _, hasFormatted := rxBot.ParseRunFormatted(rec.Result)
	if hasFormatted {
		return rxBot.ShapeAnswer(projection.Agent, projection.VisibleReport(), formatted), nil
	}
	return rxBot.ShapeAnswer(projection.Agent, projection.VisibleReport(), nil), nil
}

// persistQuestionLog writes one QuestionAgentLog row, shared by the blocking
// Query and streaming QueryStream paths: a plain INSERT on a fresh turn, or a
// two-step UPDATE on refresh (struct Updates for the row, then an explicit map
// Updates to clear the transitional task columns — server_id/task_id/
// log_status/server_file_path — which struct Updates would skip as zero
// values, stranding a prior agent type's identifiers on a re-answered turn).
// It returns the row id (the refresh id on update, the new autoincrement id on
// insert). Callers build `row` with their own column values; this helper owns
// only the persistence branch so the two paths cannot drift.
func (ps *Service) persistQuestionLog(ctx context.Context, username string, refreshID int64, row *model.QuestionAgentLog) (int64, error) {
	if refreshID != 0 {
		if err := model.DB(ctx).Model(&model.QuestionAgentLog{}).
			Where("id = ? AND user_name = ?", refreshID, username).Updates(row).Error; err != nil {
			return 0, err
		}
		if err := model.DB(ctx).Model(&model.QuestionAgentLog{}).
			Where("id = ? AND user_name = ?", refreshID, username).
			Updates(map[string]interface{}{
				"server_id":        row.ServerId,
				"task_id":          row.TaskId,
				"log_status":       row.LogStatus,
				"server_file_path": "",
			}).Error; err != nil {
			return 0, err
		}
		return refreshID, nil
	}
	if err := model.DB(ctx).Create(row).Error; err != nil {
		return 0, err
	}
	return row.Id, nil
}

// QueryStream is the SSE variant of Query for chat-family slugs. It opens the
// Bot AG-UI stream, persists a RUNNING Web row, publishes that row's canonical
// identity through onReady, then forwards each frame via forward() while teeing
// it into an accumulator. RunStarted is persisted before it is forwarded, so
// the existing A2UI dialogue + user + run authorization boundary is live by the
// time an interactive frame can reach the browser. A forward() error (browser
// disconnect) stops forwarding but never aborts the Bot read or finalization.
func (ps *Service) QueryStream(
	ctx context.Context,
	username string,
	in QueryInput,
	onReady func(StreamIdentity),
	forward func(frame []byte) error,
) (*QueryData, error) {
	if rxBot.BotConfig == nil || !rxBot.BotConfig.ProxyEnabled {
		return nil, ErrGatewayDisabled
	}
	if isRemoteProductTool(in.Tool) {
		if err := ps.CheckRemoteProductAllowed(ctx, username, in.Tool); err != nil {
			return nil, err
		}
	}
	if !rxBot.BotConfig.StreamEnabled {
		return nil, fmt.Errorf("%w: stream gate is off", ErrStreamUnsupported)
	}
	if in.Mode == "expert" {
		// Expert routes via RouteQuery (POST /v1/query/route, no streaming
		// primitive). The handler gate keeps expert out of this branch; this
		// guard is defense in depth so SlugFor("")->"chat" can never collapse
		// an Expert turn into a streamed ChatAgent run (slug-gate invariant,
		// query_expert_test.go).
		return nil, fmt.Errorf("%w: expert mode", ErrStreamUnsupported)
	}
	slug, ok := rxBot.SlugFor(in.Tool)
	if !ok {
		return nil, fmt.Errorf("%w %q", ErrUnknownTool, in.Tool)
	}
	chatModel, streamCapable := rxBot.StreamModelFor(slug)
	if !streamCapable {
		// Slugs without an approved stream model stay on their blocking path.
		return nil, fmt.Errorf("%w: tool %q has no Bot streaming primitive (handoff P1)", ErrStreamUnsupported, in.Tool)
	}

	client := rxBot.NewClient()

	// Upload attachments before opening the stream so upload errors still
	// surface as a normal (non-SSE) error to the handler.
	var obsPaths, fileNames []string
	for _, f := range in.Files {
		up, err := client.UploadFile(ctx, f.Filename, "", bytes.NewReader(f.Data))
		if err != nil {
			return nil, err
		}
		obsPaths = append(obsPaths, up.Path)
		fileNames = append(fileNames, f.Filename)
	}

	dialogueID, fID, err := ps.resolveDialogue(ctx, username, in)
	if err != nil {
		return nil, err
	}

	req := rxBot.ChatCompletionRequest{
		Model:      chatModel,
		Messages:   []rxBot.ChatMessage{{Role: "user", Content: in.Query}},
		DialogueID: dialogueID,
	}
	if len(obsPaths) > 0 {
		req.OBSFileList = obsPaths
	}
	rc, err := client.ChatCompletionStream(ctx, req)
	if err != nil {
		// Pre-first-byte failure (auth / unsupported) surfaces as a normal
		// error so the handler can still return a non-SSE status.
		return nil, err
	}
	defer rc.Close()

	// The row must exist before any Bot frame is forwarded. Besides making the
	// response identity authoritative, this closes the former A2UI window where
	// a widget was visible while its authorization tuple did not exist yet.
	titleQuery := ""
	if fID == 0 && in.RefreshId == 0 {
		titleQuery = in.Query
	}
	row := model.QuestionAgentLog{
		DialogueId:        dialogueID,
		FId:               fID,
		UserName:          username,
		Query:             in.Query,
		TitleQuery:        titleQuery,
		Answer:            "",
		FollowUpQuestions: "",
		FileName:          strings.Join(fileNames, ","),
		UploadPath:        strings.Join(obsPaths, ","),
		ToolName:          slugToToolName[slug],
		Status:            "RUNNING",
		Mode:              in.Mode,
		ReactionType:      "0",
		CollectType:       "0",
	}
	id, err := ps.beginQuestionStream(ctx, username, in.RefreshId, &row)
	if err != nil {
		return nil, err
	}
	identity := StreamIdentity{DialogueID: dialogueID, MessageID: id}
	if onReady != nil {
		onReady(identity)
	}

	// Forward + tee, splitting the SSE body on blank-line frame separators. The
	// split token includes its original separator so the bytes reaching Web are
	// exactly the bytes Bot sent; only the accumulator parses a copy.
	acc := &rxBot.AGUIAccumulator{}
	scanner := bufio.NewScanner(rc)
	scanner.Buffer(make([]byte, 0, 64*1024), 1024*1024)
	scanner.Split(splitSSEFrames)
	forwarding := true
	persistedRunID := ""
	var streamErr error
	for scanner.Scan() {
		frame := scanner.Bytes()
		if ev, ok := rxBot.ParseAGUIFrame(frame); ok {
			acc.Observe(ev)
			if ev.Type == "RunStarted" && acc.RunID() == "" {
				streamErr = errors.New("RunStarted event is missing run_id")
				break
			}
			if ev.Type == "RunStarted" && acc.RunID() != persistedRunID {
				// Persist the cross-service join key before the browser can receive
				// RunStarted (and therefore before any later interactive frame).
				if err := ps.setQuestionStreamRunID(ctx, username, identity, acc.RunID()); err != nil {
					streamErr = err
					break
				}
				persistedRunID = acc.RunID()
			}
		}
		// Forward the raw frame, including Bot's original separator, to the
		// browser. Never re-encode or normalize an AG-UI frame in the gateway.
		out := append([]byte(nil), frame...)
		if forwarding && forward != nil {
			if err := forward(out); err != nil {
				forwarding = false
			}
		}
	}

	// Ground the persisted status in what actually happened on the wire, not a
	// hardcoded optimism: a mid-stream read error (network drop, ctx cancel,
	// frame over the 1MB scanner cap) or a RunError event both mean the answer
	// is partial/failed. A blank status would strand the row out of the GA
	// cron's WHERE status='RUNNING' poll set, so use "FAILED" (a terminal
	// non-RUNNING state) rather than "" for these paths.
	status := "SUCCEEDED"
	if streamErr != nil {
		status = "FAILED"
	} else if err := scanner.Err(); err != nil {
		status = "FAILED"
		streamErr = err
	} else if acc.Err() != nil {
		status = "FAILED"
	}
	// A Bot RunError is already terminal on the wire. Suppress any synthetic
	// handler error even if the transport reports a late read error after that
	// frame; the browser must see exactly one terminal error event.
	if acc.Err() != nil {
		streamErr = nil
	}

	// Finalize the row opened above. WithoutCancel preserves request-scoped DB
	// values while ensuring a browser abort or upstream disconnect cannot leave
	// the durable row stuck in RUNNING merely because the request context ended.
	out := &QueryData{
		Id:           id,
		ToolName:     slugToToolName[slug],
		ReactionType: "0",
		DialogueId:   dialogueID,
		Status:       status,
	}
	out.Answer = rxBot.ShapeAnswer(slug, acc.AnswerText(), nil)
	out.FollowUpQuestions = acc.FollowUpJSON()
	finalizeCtx, cancelFinalize := context.WithTimeout(context.WithoutCancel(ctx), 2*time.Second)
	defer cancelFinalize()
	if err := ps.finalizeQuestionStream(finalizeCtx, username, identity, acc.RunID(), out); err != nil {
		return nil, err
	}
	out.UploadPath = strings.Join(obsPaths, ",")
	if streamErr != nil {
		return out, streamErr
	}
	return out, nil
}

// beginQuestionStream creates a fresh row or moves a refresh target into
// RUNNING before the first frame. Refresh explicitly clears the prior answer
// and bot_run_id because GORM struct updates skip zero values; retaining either
// would expose stale content or authorize actions against the previous run.
func (ps *Service) beginQuestionStream(ctx context.Context, username string, refreshID int64, row *model.QuestionAgentLog) (int64, error) {
	if refreshID == 0 {
		if err := model.DB(ctx).Create(row).Error; err != nil {
			return 0, err
		}
		return row.Id, nil
	}
	result := model.DB(ctx).Model(&model.QuestionAgentLog{}).
		Where("id = ? AND user_name = ? AND dialogue_id = ?", refreshID, username, row.DialogueId).
		Updates(map[string]interface{}{
			"answer":              "",
			"bot_run_id":          "",
			"collect_type":        row.CollectType,
			"f_id":                row.FId,
			"file_name":           row.FileName,
			"follow_up_questions": "",
			"log_status":          "",
			"mode":                row.Mode,
			"query":               row.Query,
			"reaction_type":       row.ReactionType,
			"server_file_path":    "",
			"server_id":           "",
			"status":              row.Status,
			"task_id":             "",
			"title_query":         row.TitleQuery,
			"tool_name":           row.ToolName,
			"upload_path":         row.UploadPath,
		})
	if result.Error != nil {
		return 0, result.Error
	}
	if result.RowsAffected != 1 {
		var count int64
		if err := model.DB(ctx).Model(&model.QuestionAgentLog{}).
			Where("id = ? AND user_name = ? AND dialogue_id = ?", refreshID, username, row.DialogueId).
			Count(&count).Error; err != nil {
			return 0, err
		}
		if count != 1 {
			return 0, fmt.Errorf("stream row %d not found", refreshID)
		}
	}
	return refreshID, nil
}

func (ps *Service) setQuestionStreamRunID(ctx context.Context, username string, identity StreamIdentity, runID string) error {
	result := model.DB(ctx).Model(&model.QuestionAgentLog{}).
		Where("id = ? AND user_name = ? AND dialogue_id = ?", identity.MessageID, username, identity.DialogueID).
		Update("bot_run_id", runID)
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected != 1 {
		return fmt.Errorf("stream row %d not found", identity.MessageID)
	}
	return nil
}

func (ps *Service) finalizeQuestionStream(
	ctx context.Context,
	username string,
	identity StreamIdentity,
	runID string,
	out *QueryData,
) error {
	result := model.DB(ctx).Model(&model.QuestionAgentLog{}).
		Where("id = ? AND user_name = ? AND dialogue_id = ?", identity.MessageID, username, identity.DialogueID).
		Updates(map[string]interface{}{
			"answer":              out.Answer,
			"bot_run_id":          runID,
			"follow_up_questions": out.FollowUpQuestions,
			"status":              out.Status,
		})
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected != 1 {
		return fmt.Errorf("stream row %d not found", identity.MessageID)
	}
	return nil
}

// splitSSEFrames is a bufio.SplitFunc that yields one SSE frame per call,
// splitting on the blank-line (LF or CRLF) separator. The trailing separator is
// included in the token so forwarding can preserve Bot's bytes exactly.
func splitSSEFrames(data []byte, atEOF bool) (advance int, token []byte, err error) {
	if i := bytes.Index(data, []byte("\r\n\r\n")); i >= 0 {
		return i + 4, data[:i+4], nil
	}
	if i := bytes.Index(data, []byte("\n\n")); i >= 0 {
		return i + 2, data[:i+2], nil
	}
	if atEOF && len(data) > 0 {
		return len(data), data, nil
	}
	return 0, nil, nil
}
