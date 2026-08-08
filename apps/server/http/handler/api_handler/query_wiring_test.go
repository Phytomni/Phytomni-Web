package api_handler

import (
	"bytes"
	"encoding/json"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"
	"unicode/utf8"

	"phytomni-server/common/i18n"
	rxBot "phytomni-server/external/bot"
	"phytomni-server/model"
	api_service "phytomni-server/service/api_service"

	"github.com/gin-gonic/gin"
	"github.com/spf13/viper"
)

// newQueryRequest builds a /query multipart POST carrying just a query field,
// mirroring what the Web app sends, on a gin test context.
func newQueryRequest(t *testing.T, query string) (*gin.Context, *httptest.ResponseRecorder) {
	t.Helper()
	var buf bytes.Buffer
	mw := multipart.NewWriter(&buf)
	if err := mw.WriteField("query", query); err != nil {
		t.Fatalf("write field: %v", err)
	}
	if err := mw.Close(); err != nil {
		t.Fatalf("close writer: %v", err)
	}
	gin.SetMode(gin.TestMode)
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Request = httptest.NewRequest(http.MethodPost, "/api/v1/conversations/0/messages", &buf)
	c.Request.Header.Set("Content-Type", mw.FormDataContentType())
	c.Params = gin.Params{{Key: "id", Value: "0"}}
	i18n.Localize()(c)
	return c, w
}

// TestApiQuery_DisabledGatewayWiring exercises queryErrorStatus through the real
// Query handler glue (not just the pure helper): a disabled gateway must come
// back as a 503 whose body `code` matches the HTTP status. This pins the wiring
// the helper unit test cannot reach — that the helper is actually invoked and
// the status is not mis-mapped onto the response code. With the gateway off the
// service returns ErrGatewayDisabled before any DB access, so no DB is needed.
func TestApiQuery_DisabledGatewayWiring(t *testing.T) {
	rxBot.BotConfig = nil // gateway disabled
	ph := NewHandler()
	c, w := newQueryRequest(t, "hi")
	c.Set("username", "alice")

	ph.Query(c)

	if w.Code != http.StatusServiceUnavailable {
		t.Fatalf("expected 503, got %d (body=%s)", w.Code, w.Body.String())
	}
	var parsed struct {
		Code    int    `json:"code"`
		Message string `json:"message"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &parsed); err != nil {
		t.Fatalf("decode body %s: %v", w.Body.String(), err)
	}
	if parsed.Code != http.StatusServiceUnavailable {
		t.Errorf("body code should match HTTP status 503, got %d", parsed.Code)
	}
	if parsed.Message == "" {
		t.Errorf("expected a non-empty user message, got empty")
	}
}

func TestQueryRejectsOversizedUnicode(t *testing.T) {
	previousConfig := rxBot.BotConfig
	botCalls := 0
	server := httptest.NewServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {
		botCalls++
	}))
	t.Cleanup(server.Close)
	rxBot.BotConfig = &rxBot.Config{
		BaseURL:       server.URL,
		ProxyEnabled:  true,
		MaxQueryChars: rxBot.DefaultMaxUserQueryChars,
	}
	t.Cleanup(func() { rxBot.BotConfig = previousConfig })

	c, w := newQueryRequest(t, strings.Repeat("\u7A3B", rxBot.DefaultMaxUserQueryChars+1))
	c.Set("username", "alice")

	NewHandler().Query(c)

	if w.Code != http.StatusRequestEntityTooLarge {
		t.Fatalf("status=%d body=%s, want 413", w.Code, w.Body.String())
	}
	if botCalls != 0 {
		t.Fatalf("oversized query reached Bot %d time(s), want 0", botCalls)
	}
}

func TestQueryRejectsControlBodyOverDerivedLimitBeforeBot(t *testing.T) {
	previousConfig := rxBot.BotConfig
	botCalls := 0
	server := httptest.NewServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {
		botCalls++
	}))
	t.Cleanup(server.Close)
	rxBot.BotConfig = &rxBot.Config{
		BaseURL:       server.URL,
		ProxyEnabled:  true,
		MaxQueryChars: rxBot.DefaultMaxUserQueryChars,
	}
	t.Cleanup(func() { rxBot.BotConfig = previousConfig })

	var body bytes.Buffer
	writer := multipart.NewWriter(&body)
	if err := writer.WriteField("query", "bounded query"); err != nil {
		t.Fatal(err)
	}
	if err := writer.WriteField("history", strings.Repeat("x", 5<<20)); err != nil {
		t.Fatal(err)
	}
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Request = httptest.NewRequest(http.MethodPost, "/api/v1/conversations/0/messages", &body)
	c.Request.Header.Set("Content-Type", writer.FormDataContentType())
	c.Params = gin.Params{{Key: "id", Value: "0"}}
	c.Set("username", "alice")
	i18n.Localize()(c)

	NewHandler().Query(c)

	if w.Code != http.StatusRequestEntityTooLarge {
		t.Fatalf("status=%d body=%s, want 413", w.Code, w.Body.String())
	}
	if botCalls != 0 {
		t.Fatalf("over-limit control body reached Bot %d time(s), want 0", botCalls)
	}
}

func TestLongResearchQueryAcceptsMaximumUnicode(t *testing.T) {
	previousConfig := rxBot.BotConfig
	rxBot.BotConfig = nil
	t.Cleanup(func() { rxBot.BotConfig = previousConfig })

	const (
		paperMarker = "Synthetic paper abstract: rice root development evidence."
		pathMarker  = "scrubbed-bucket/synthetic-study/late/reads.fastq.gz"
	)
	prefix := paperMarker + "\n"
	suffix := "\n" + pathMarker
	fillerCount := rxBot.DefaultMaxUserQueryChars - utf8.RuneCountInString(prefix) - utf8.RuneCountInString(suffix)
	query := prefix + strings.Repeat("\u7A3B", fillerCount) + suffix
	if got := utf8.RuneCountInString(query); got != rxBot.DefaultMaxUserQueryChars {
		t.Fatalf("synthetic query code points = %d, want %d", got, rxBot.DefaultMaxUserQueryChars)
	}

	c, w := newQueryRequest(t, query)
	c.Set("username", "alice")

	NewHandler().Query(c)

	if w.Code != http.StatusServiceUnavailable {
		t.Fatalf("status=%d, want service dispatch to return 503 after accepting the boundary", w.Code)
	}
}

func TestQueryUsesDefaultLimitForUnnormalizedConfig(t *testing.T) {
	previousConfig := rxBot.BotConfig
	rxBot.BotConfig = &rxBot.Config{}
	t.Cleanup(func() { rxBot.BotConfig = previousConfig })

	c, w := newQueryRequest(t, "valid query")
	c.Set("username", "alice")

	NewHandler().Query(c)

	if w.Code != http.StatusServiceUnavailable {
		t.Fatalf("status=%d body=%s, want service dispatch to return 503", w.Code, w.Body.String())
	}
}

func TestParseAssetAttachmentsStrictContract(t *testing.T) {
	validTen := make([]string, rxBot.MaxAssetAttachmentRefs)
	for i := range validTen {
		validTen[i] = `{"asset_id":"file_` + strconv.Itoa(i) + `"}`
	}
	tests := []struct {
		name string
		raw  string
		ok   bool
		want int
	}{
		{name: "missing field", raw: "", ok: true, want: 0},
		{name: "empty array", raw: "[]", ok: true, want: 0},
		{name: "one", raw: `[{"asset_id":"file_one"}]`, ok: true, want: 1},
		{name: "ten", raw: "[" + strings.Join(validTen, ",") + "]", ok: true, want: rxBot.MaxAssetAttachmentRefs},
		{name: "eleven", raw: "[" + strings.Join(append(validTen, `{"asset_id":"file_extra"}`), ",") + "]", ok: false},
		{name: "duplicate", raw: `[{"asset_id":"file_one"},{"asset_id":"file_one"}]`, ok: false},
		{name: "malformed json", raw: `[{"asset_id":"file_one"}`, ok: false},
		{name: "unknown field", raw: `[{"asset_id":"file_one","name":"reads.fastq"}]`, ok: false},
		{name: "invalid prefix", raw: `[{"asset_id":"asset_one"}]`, ok: false},
		{name: "overlong id", raw: `[{"asset_id":"file_` + strings.Repeat("a", 124) + `"}]`, ok: false},
		{name: "trailing value", raw: `[{"asset_id":"file_one"}] {}`, ok: false},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, ok := parseAssetAttachments(tt.raw)
			if ok != tt.ok || len(got) != tt.want {
				t.Fatalf("parseAssetAttachments(%q)=(%#v,%v), want len=%d ok=%v", tt.raw, got, ok, tt.want, tt.ok)
			}
		})
	}
}

func TestParseAssetAttachmentsRejectsRawJSONOver64KiB(t *testing.T) {
	raw := strings.Repeat(" ", 64<<10) + "[]"
	if refs, ok := parseAssetAttachments(raw); ok {
		t.Fatalf("accepted %d-byte padded attachment JSON: %#v", len(raw), refs)
	}
}

func TestApiQueryRejectsAnyMultipartFilePartBeforeDispatch(t *testing.T) {
	previousConfig := rxBot.BotConfig
	previousQuota := viper.Get("chatlimit.enforce")
	t.Cleanup(func() {
		rxBot.BotConfig = previousConfig
		viper.Set("chatlimit.enforce", previousQuota)
	})
	viper.Set("chatlimit.enforce", false)
	rxBot.BotConfig = &rxBot.Config{ProxyEnabled: true}

	var body bytes.Buffer
	mw := multipart.NewWriter(&body)
	if err := mw.WriteField("query", "valid query"); err != nil {
		t.Fatal(err)
	}
	part, err := mw.CreateFormFile("payload", "reads.fastq")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := part.Write([]byte("not a relay")); err != nil {
		t.Fatal(err)
	}
	if err := mw.Close(); err != nil {
		t.Fatal(err)
	}
	gin.SetMode(gin.TestMode)
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Request = httptest.NewRequest(http.MethodPost, "/api/v1/conversations/0/messages", &body)
	c.Request.Header.Set("Content-Type", mw.FormDataContentType())
	c.Params = gin.Params{{Key: "id", Value: "0"}}
	c.Set("username", "alice@example.com")
	i18n.Localize()(c)

	NewHandler().Query(c)
	if w.Code != http.StatusUnsupportedMediaType {
		t.Fatalf("status=%d body=%s, want 415", w.Code, w.Body.String())
	}
}

func TestApiQueryRejectsOverlongInteropModeBeforeServiceDispatch(t *testing.T) {
	previousConfig := rxBot.BotConfig
	rxBot.BotConfig = nil
	t.Cleanup(func() { rxBot.BotConfig = previousConfig })

	var body bytes.Buffer
	mw := multipart.NewWriter(&body)
	if err := mw.WriteField("query", "research query"); err != nil {
		t.Fatal(err)
	}
	if err := mw.WriteField("tool", "InSilicoResearchAgent"); err != nil {
		t.Fatal(err)
	}
	if err := mw.WriteField("interop_mode", strings.Repeat("x", rxBot.MaxInteropModeLength+1)); err != nil {
		t.Fatal(err)
	}
	if err := mw.Close(); err != nil {
		t.Fatal(err)
	}
	gin.SetMode(gin.TestMode)
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Request = httptest.NewRequest(http.MethodPost, "/api/v1/conversations/0/messages", &body)
	c.Request.Header.Set("Content-Type", mw.FormDataContentType())
	c.Params = gin.Params{{Key: "id", Value: "0"}}
	c.Set("username", "alice")
	i18n.Localize()(c)

	NewHandler().Query(c)
	if w.Code != http.StatusBadRequest {
		t.Fatalf("overlong interop_mode status=%d body=%s, want 400", w.Code, w.Body.String())
	}
	if strings.Contains(w.Body.String(), strings.Repeat("x", rxBot.MaxInteropModeLength)) {
		t.Fatalf("overlong mode echoed in response: %s", w.Body.String())
	}
}

// unreadablePreparsedMultipartForm leaves a real disk-backed FileHeader in an
// already-parsed form, then removes its backing file. The handler must reject
// invalid routing before it can open or read this attachment.
func unreadablePreparsedMultipartForm(t *testing.T, mode, tool string) *multipart.Form {
	t.Helper()
	var body bytes.Buffer
	writer := multipart.NewWriter(&body)
	for key, value := range map[string]string{
		"query": "route safely",
		"mode":  mode,
		"tool":  tool,
	} {
		if err := writer.WriteField(key, value); err != nil {
			t.Fatalf("write %s: %v", key, err)
		}
	}
	file, err := writer.CreateFormFile("files", "must-not-open.txt")
	if err != nil {
		t.Fatalf("create attachment: %v", err)
	}
	if _, err := file.Write([]byte("attachment content must remain unread")); err != nil {
		t.Fatalf("write attachment: %v", err)
	}
	if err := writer.Close(); err != nil {
		t.Fatalf("close multipart writer: %v", err)
	}
	form, err := multipart.NewReader(bytes.NewReader(body.Bytes()), writer.Boundary()).ReadForm(0)
	if err != nil {
		t.Fatalf("pre-parse multipart form: %v", err)
	}
	files := form.File["files"]
	if len(files) != 1 || files[0].Size == 0 {
		t.Fatalf("pre-parsed attachment = %#v, want one non-empty file", files)
	}
	if err := form.RemoveAll(); err != nil {
		t.Fatalf("remove attachment backing file: %v", err)
	}
	opened, err := files[0].Open()
	if err == nil {
		_ = opened.Close()
		t.Fatal("removed attachment backing file remained readable")
	}
	return form
}

// TestQueryRejectsInvalidChatRouting proves malformed Chat routing fails before
// the handler opens attachment data, dispatches to Bot, or persists a row.
func TestQueryRejectsInvalidChatRouting(t *testing.T) {
	invalid := []struct {
		name string
		mode string
		tool string
	}{
		{name: "instant direct tool", mode: "instant", tool: "DataAgent"},
		{name: "unknown mode", mode: "fast", tool: ""},
		{name: "unknown expert tool", mode: "expert", tool: "MissingAgent"},
		{name: "padded expert tool", mode: "expert", tool: " DataAgent"},
		{name: "joined expert tools", mode: "expert", tool: "DataAgent,AnalystAgent"},
	}
	for _, tc := range invalid {
		t.Run(tc.name, func(t *testing.T) {
			gdb := setupRemoteProductHandlerDB(t)
			previousConfig := rxBot.BotConfig
			hits := 0
			srv := httptest.NewServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {
				hits++
			}))
			t.Cleanup(srv.Close)
			rxBot.BotConfig = &rxBot.Config{BaseURL: srv.URL, ProxyEnabled: true}
			t.Cleanup(func() { rxBot.BotConfig = previousConfig })
			previousQuota := viper.Get("chatlimit.enforce")
			viper.Set("chatlimit.enforce", false)
			t.Cleanup(func() { viper.Set("chatlimit.enforce", previousQuota) })

			gin.SetMode(gin.TestMode)
			w := httptest.NewRecorder()
			c, _ := gin.CreateTestContext(w)
			tracked := &trackingReadCloser{reader: strings.NewReader("must not be read")}
			form := unreadablePreparsedMultipartForm(t, tc.mode, tc.tool)
			c.Request = httptest.NewRequest(http.MethodPost, "/api/v1/conversations/0/messages", nil)
			c.Request.Body = tracked
			c.Request.Header.Set("Content-Type", "multipart/form-data; boundary=already-parsed")
			c.Request.PostForm = form.Value
			c.Request.MultipartForm = form
			c.Params = gin.Params{{Key: "id", Value: "0"}}
			c.Set("username", "alice@example.com")
			i18n.Localize()(c)

			NewHandler().Query(c)

			if w.Code != http.StatusBadRequest {
				t.Fatalf("status = %d, body=%s; want 400", w.Code, w.Body.String())
			}
			var body struct {
				Code    int    `json:"code"`
				Message string `json:"message"`
			}
			if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil {
				t.Fatalf("decode response: %v", err)
			}
			if body.Code != http.StatusBadRequest || body.Message != "invalid chat routing" {
				t.Fatalf("response = %#v, want 400 invalid chat routing", body)
			}
			if tracked.reads != 0 || tracked.bytes != 0 {
				t.Fatalf("invalid Chat routing read attachment body %d time(s), %d byte(s)", tracked.reads, tracked.bytes)
			}
			if hits != 0 {
				t.Fatalf("invalid Chat routing reached Bot %d time(s)", hits)
			}
			var rows int64
			if err := gdb.Table("question_agent_logs").Count(&rows).Error; err != nil {
				t.Fatalf("count rows: %v", err)
			}
			if rows != 0 {
				t.Fatalf("invalid Chat routing persisted %d row(s)", rows)
			}
		})
	}
}

func seedResearchHandlerPermission(t *testing.T) {
	t.Helper()
	gdb := setupRemoteProductHandlerDB(t)
	if err := gdb.Exec(
		`INSERT INTO users (email, code, chat_limit) VALUES (?, ?, ?)`,
		"research@example.com", "research-role", 5,
	).Error; err != nil {
		t.Fatalf("seed Research user: %v", err)
	}
	if err := gdb.Exec(
		`INSERT INTO tool_names (id, tool_name) VALUES (?, ?)`,
		1, "InSilicoResearchAgent",
	).Error; err != nil {
		t.Fatalf("seed Research tool: %v", err)
	}
	if err := gdb.Exec(
		`INSERT INTO user_tool_names (code, tool_id) VALUES (?, ?)`,
		"research-role", 1,
	).Error; err != nil {
		t.Fatalf("seed Research permission: %v", err)
	}
}

func handlerResearchCatalogWithQueryLimit(t *testing.T, maxQueryChars int) string {
	t.Helper()
	var response rxBot.AgentsListResponse
	if err := json.Unmarshal([]byte(handlerCapabilityBody(t)), &response); err != nil {
		t.Fatalf("decode handler Research catalog: %v", err)
	}
	response.ResearchInputResolution.MaxUserQueryChars = maxQueryChars
	body, err := json.Marshal(response)
	if err != nil {
		t.Fatalf("encode handler Research catalog: %v", err)
	}
	return string(body)
}

func newNegotiatedResearchRequest(
	t *testing.T,
	surface api_service.QuerySurface,
	query string,
) (*gin.Context, *httptest.ResponseRecorder) {
	return newNegotiatedResearchRequestWithClientTurn(
		t,
		surface,
		query,
		"negotiated-research-turn",
	)
}

func newNegotiatedResearchRequestWithClientTurn(
	t *testing.T,
	surface api_service.QuerySurface,
	query string,
	clientTurnID string,
) (*gin.Context, *httptest.ResponseRecorder) {
	t.Helper()
	var body bytes.Buffer
	writer := multipart.NewWriter(&body)
	if err := writer.WriteField("query", query); err != nil {
		t.Fatalf("write query: %v", err)
	}
	if err := writer.WriteField("client_turn_id", clientTurnID); err != nil {
		t.Fatalf("write client turn id: %v", err)
	}
	path := "/api/v1/agent-products/InSilicoResearchAgent/runs"
	if surface == api_service.QuerySurfaceChat {
		path = "/api/v1/conversations/0/messages"
		if err := writer.WriteField("mode", "expert"); err != nil {
			t.Fatalf("write mode: %v", err)
		}
		if err := writer.WriteField("tool", "InSilicoResearchAgent"); err != nil {
			t.Fatalf("write tool: %v", err)
		}
	}
	if err := writer.Close(); err != nil {
		t.Fatalf("close Research request: %v", err)
	}

	gin.SetMode(gin.TestMode)
	w := httptest.NewRecorder()
	ctx, _ := gin.CreateTestContext(w)
	ctx.Request = httptest.NewRequest(http.MethodPost, path, &body)
	ctx.Request.Header.Set("Content-Type", writer.FormDataContentType())
	ctx.Request.Header.Set("X-Phyto-Client-Turn-Id", clientTurnID)
	if surface == api_service.QuerySurfaceChat {
		ctx.Request.Header.Set("X-Phyto-Research-Intent", "expert-research-v1")
		ctx.Params = gin.Params{{Key: "id", Value: "0"}}
	} else {
		ctx.Params = gin.Params{{Key: "tool", Value: "InSilicoResearchAgent"}}
	}
	ctx.Set("username", "research@example.com")
	i18n.Localize()(ctx)
	return ctx, w
}

func TestResearchHandlerUsesMinimumNegotiatedQueryLimit(t *testing.T) {
	surfaces := []struct {
		name    string
		surface api_service.QuerySurface
	}{
		{name: "dedicated Research", surface: api_service.QuerySurfaceAgentProduct},
		{name: "explicit Expert Research", surface: api_service.QuerySurfaceChat},
	}
	limits := []struct {
		name       string
		local      int
		advertised int
	}{
		{name: "Bot lower", local: 8, advertised: 4},
		{name: "Web lower", local: 4, advertised: 8},
	}

	for _, surface := range surfaces {
		for _, limit := range limits {
			t.Run(surface.name+"/"+limit.name, func(t *testing.T) {
				seedResearchHandlerPermission(t)
				catalogCalls := 0
				runCalls := 0
				server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
					if r.Method == http.MethodGet && r.URL.Path == "/v1/agents" {
						catalogCalls++
						w.Header().Set("Content-Type", "application/json")
						_, _ = w.Write([]byte(handlerResearchCatalogWithQueryLimit(t, limit.advertised)))
						return
					}
					runCalls++
					http.Error(w, "must not dispatch", http.StatusInternalServerError)
				}))
				t.Cleanup(server.Close)
				previousConfig := rxBot.BotConfig
				rxBot.BotConfig = &rxBot.Config{
					BaseURL: server.URL, ProxyEnabled: true, ExpertEnabled: true,
					ResearchEnabled: true, MaxQueryChars: limit.local,
				}
				t.Cleanup(func() { rxBot.BotConfig = previousConfig })
				previousQuota := viper.Get("chatlimit.enforce")
				viper.Set("chatlimit.enforce", false)
				t.Cleanup(func() { viper.Set("chatlimit.enforce", previousQuota) })

				ctx, recorder := newNegotiatedResearchRequest(t, surface.surface, "12345")
				if surface.surface == api_service.QuerySurfaceChat {
					NewHandler().Query(ctx)
				} else {
					NewHandler().AgentProductRun(ctx)
				}

				if recorder.Code != http.StatusRequestEntityTooLarge {
					t.Fatalf("status=%d body=%s, want 413", recorder.Code, recorder.Body.String())
				}
				if catalogCalls != 1 {
					t.Fatalf("catalog calls=%d, want exactly 1", catalogCalls)
				}
				if runCalls != 0 {
					t.Fatalf("Research runs=%d, want 0", runCalls)
				}
			})
		}
	}
}

func TestDedicatedResearchHandlerRetryBypassesLiveCapabilityDrift(t *testing.T) {
	seedResearchHandlerPermission(t)
	var (
		catalogCalls int
		runCalls     int
		capabilityOK = true
	)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch {
		case r.Method == http.MethodGet && r.URL.Path == "/v1/agents":
			catalogCalls++
			if !capabilityOK {
				_, _ = w.Write([]byte(`{}`))
				return
			}
			serveHandlerResearchCatalog(t, w, r)
		case r.Method == http.MethodPost && r.URL.Path == "/v1/agents/research/runs":
			runCalls++
			w.WriteHeader(http.StatusAccepted)
			_, _ = w.Write([]byte(`{"id":"run-handler-research-retry","object":"agent.run","agent":"research","status":"running","task_ids":[],"result":{}}`))
		default:
			http.NotFound(w, r)
		}
	}))
	t.Cleanup(server.Close)
	previousConfig := rxBot.BotConfig
	rxBot.BotConfig = &rxBot.Config{
		BaseURL: server.URL, ProxyEnabled: true, ExpertEnabled: true,
		ResearchEnabled: true, MultiturnV1Enabled: false,
	}
	t.Cleanup(func() { rxBot.BotConfig = previousConfig })
	previousQuota := viper.Get("chatlimit.enforce")
	viper.Set("chatlimit.enforce", false)
	t.Cleanup(func() { viper.Set("chatlimit.enforce", previousQuota) })
	handler := NewHandler()

	firstCtx, firstRecorder := newNegotiatedResearchRequest(
		t, api_service.QuerySurfaceAgentProduct, "stable handler Research query",
	)
	handler.AgentProductRun(firstCtx)
	if firstRecorder.Code != http.StatusOK {
		t.Fatalf("first status=%d body=%s, want 200", firstRecorder.Code, firstRecorder.Body.String())
	}
	var first struct {
		Code int                   `json:"code"`
		Data api_service.QueryData `json:"data"`
	}
	if err := json.Unmarshal(firstRecorder.Body.Bytes(), &first); err != nil {
		t.Fatalf("decode first response: %v", err)
	}
	if first.Data.BotRunID != "run-handler-research-retry" || first.Data.Id == 0 {
		t.Fatalf("first identity=%+v", first.Data)
	}
	if catalogCalls != 1 || runCalls != 1 {
		t.Fatalf("first catalog/run calls=%d/%d, want 1/1", catalogCalls, runCalls)
	}

	capabilityOK = false
	retryCtx, retryRecorder := newNegotiatedResearchRequest(
		t, api_service.QuerySurfaceAgentProduct, "stable handler Research query",
	)
	handler.AgentProductRun(retryCtx)
	if retryRecorder.Code != http.StatusOK {
		t.Fatalf("retry status=%d body=%s, want 200", retryRecorder.Code, retryRecorder.Body.String())
	}
	var retry struct {
		Code int                   `json:"code"`
		Data api_service.QueryData `json:"data"`
	}
	if err := json.Unmarshal(retryRecorder.Body.Bytes(), &retry); err != nil {
		t.Fatalf("decode retry response: %v", err)
	}
	if retry.Data.Id != first.Data.Id || retry.Data.BotRunID != first.Data.BotRunID {
		t.Fatalf("retry identity changed: first=%+v retry=%+v", first.Data, retry.Data)
	}
	if catalogCalls != 1 || runCalls != 1 {
		t.Fatalf("retry catalog/run calls=%d/%d, want 1/1", catalogCalls, runCalls)
	}
}

func TestResearchClientTurnHeaderMustMatchParsedBody(t *testing.T) {
	seedResearchHandlerPermission(t)
	var catalogCalls, runCalls int
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch {
		case r.Method == http.MethodGet && r.URL.Path == "/v1/agents":
			catalogCalls++
			serveHandlerResearchCatalog(t, w, r)
		case r.Method == http.MethodPost && r.URL.Path == "/v1/agents/research/runs":
			runCalls++
			w.WriteHeader(http.StatusAccepted)
			_, _ = w.Write([]byte(`{"id":"run-header-match","object":"agent.run","agent":"research","status":"running","task_ids":[],"result":{}}`))
		default:
			http.NotFound(w, r)
		}
	}))
	t.Cleanup(server.Close)
	previousConfig := rxBot.BotConfig
	rxBot.BotConfig = &rxBot.Config{
		BaseURL: server.URL, ProxyEnabled: true, ResearchEnabled: true,
	}
	t.Cleanup(func() { rxBot.BotConfig = previousConfig })
	previousQuota := viper.Get("chatlimit.enforce")
	viper.Set("chatlimit.enforce", false)
	t.Cleanup(func() { viper.Set("chatlimit.enforce", previousQuota) })
	handler := NewHandler()

	firstCtx, firstRecorder := newNegotiatedResearchRequest(
		t, api_service.QuerySurfaceAgentProduct, "accepted header identity",
	)
	handler.AgentProductRun(firstCtx)
	if firstRecorder.Code != http.StatusOK {
		t.Fatalf("first status=%d body=%s", firstRecorder.Code, firstRecorder.Body.String())
	}
	mismatchCtx, mismatchRecorder := newNegotiatedResearchRequestWithClientTurn(
		t,
		api_service.QuerySurfaceAgentProduct,
		"mismatched header identity",
		"different-body-turn",
	)
	mismatchCtx.Request.Header.Set("X-Phyto-Client-Turn-Id", "negotiated-research-turn")
	handler.AgentProductRun(mismatchCtx)

	if mismatchRecorder.Code != http.StatusBadRequest {
		t.Fatalf("mismatch status=%d body=%s, want 400", mismatchRecorder.Code, mismatchRecorder.Body.String())
	}
	if catalogCalls != 1 || runCalls != 1 {
		t.Fatalf("mismatch catalog/run calls=%d/%d, want no calls after accepted turn", catalogCalls, runCalls)
	}
}

func TestResearchClientTurnHeaderLookupIsOwnerScoped(t *testing.T) {
	seedResearchHandlerPermission(t)
	if err := model.Default().Exec(
		`INSERT INTO users (email, code, chat_limit) VALUES (?, ?, ?)`,
		"other-research@example.com", "research-role", 5,
	).Error; err != nil {
		t.Fatalf("seed second Research owner: %v", err)
	}
	var (
		catalogCalls int
		runCalls     int
		capabilityOK = true
	)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch {
		case r.Method == http.MethodGet && r.URL.Path == "/v1/agents":
			catalogCalls++
			if capabilityOK {
				serveHandlerResearchCatalog(t, w, r)
			} else {
				_, _ = w.Write([]byte(`{}`))
			}
		case r.Method == http.MethodPost && r.URL.Path == "/v1/agents/research/runs":
			runCalls++
			w.WriteHeader(http.StatusAccepted)
			_, _ = w.Write([]byte(`{"id":"run-owner-header","object":"agent.run","agent":"research","status":"running","task_ids":[],"result":{}}`))
		default:
			http.NotFound(w, r)
		}
	}))
	t.Cleanup(server.Close)
	previousConfig := rxBot.BotConfig
	rxBot.BotConfig = &rxBot.Config{
		BaseURL: server.URL, ProxyEnabled: true, ResearchEnabled: true,
	}
	t.Cleanup(func() { rxBot.BotConfig = previousConfig })
	previousQuota := viper.Get("chatlimit.enforce")
	viper.Set("chatlimit.enforce", false)
	t.Cleanup(func() { viper.Set("chatlimit.enforce", previousQuota) })
	handler := NewHandler()

	firstCtx, firstRecorder := newNegotiatedResearchRequest(
		t, api_service.QuerySurfaceAgentProduct, "owner-scoped accepted turn",
	)
	handler.AgentProductRun(firstCtx)
	if firstRecorder.Code != http.StatusOK {
		t.Fatalf("first status=%d body=%s", firstRecorder.Code, firstRecorder.Body.String())
	}
	capabilityOK = false
	foreignCtx, foreignRecorder := newNegotiatedResearchRequest(
		t, api_service.QuerySurfaceAgentProduct, "owner-scoped accepted turn",
	)
	foreignCtx.Set("username", "other-research@example.com")
	tracked := &trackingReadCloser{reader: foreignCtx.Request.Body}
	foreignCtx.Request.Body = tracked
	handler.AgentProductRun(foreignCtx)

	if foreignRecorder.Code != http.StatusServiceUnavailable {
		t.Fatalf("foreign status=%d body=%s, want 503", foreignRecorder.Code, foreignRecorder.Body.String())
	}
	if tracked.reads != 0 || tracked.bytes != 0 || catalogCalls != 2 || runCalls != 1 {
		t.Fatalf("foreign key bypassed owner gate: reads=%d bytes=%d catalog/run=%d/%d", tracked.reads, tracked.bytes, catalogCalls, runCalls)
	}
}

func TestResearchClientTurnHeaderDoesNotReuseUnrelatedChatIdentity(t *testing.T) {
	seedResearchHandlerPermission(t)
	raw, err := json.Marshal(map[string]interface{}{
		"report_revision": -1,
		"conversation_context": map[string]interface{}{
			"client_turn_id":      "unrelated-chat-turn",
			"request_fingerprint": strings.Repeat("a", 64),
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	if err := model.Default().Create(&model.QuestionAgentLog{
		DialogueId:        "unrelated-chat-dialogue",
		UserName:          "research@example.com",
		Query:             "ordinary chat turn",
		Answer:            "ordinary chat answer",
		ToolName:          "ChatAgent",
		Mode:              "instant",
		Status:            "SUCCEEDED",
		BotProjectionJSON: string(raw),
		BotReportRevision: -1,
	}).Error; err != nil {
		t.Fatalf("seed unrelated Chat identity: %v", err)
	}

	var catalogCalls, runCalls int
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodGet && r.URL.Path == "/v1/agents" {
			catalogCalls++
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{}`))
			return
		}
		runCalls++
		http.Error(w, "must not dispatch", http.StatusInternalServerError)
	}))
	t.Cleanup(server.Close)
	previousConfig := rxBot.BotConfig
	rxBot.BotConfig = &rxBot.Config{
		BaseURL: server.URL, ProxyEnabled: true, ExpertEnabled: true,
		ResearchEnabled: true,
	}
	t.Cleanup(func() { rxBot.BotConfig = previousConfig })
	previousQuota := viper.Get("chatlimit.enforce")
	viper.Set("chatlimit.enforce", false)
	t.Cleanup(func() { viper.Set("chatlimit.enforce", previousQuota) })

	ctx, recorder := newNegotiatedResearchRequestWithClientTurn(
		t,
		api_service.QuerySurfaceAgentProduct,
		"new Research request must pass live admission",
		"unrelated-chat-turn",
	)
	tracked := &trackingReadCloser{reader: ctx.Request.Body}
	ctx.Request.Body = tracked
	NewHandler().AgentProductRun(ctx)

	if recorder.Code != http.StatusServiceUnavailable {
		t.Fatalf("status=%d body=%s, want incompatible Research 503", recorder.Code, recorder.Body.String())
	}
	if tracked.reads != 0 || tracked.bytes != 0 || catalogCalls != 1 || runCalls != 0 {
		t.Fatalf(
			"unrelated Chat identity bypassed Research admission: reads=%d bytes=%d catalog/run=%d/%d",
			tracked.reads,
			tracked.bytes,
			catalogCalls,
			runCalls,
		)
	}
}

func TestResearchClientTurnHeaderRejectsMalformedValuesBeforeBody(t *testing.T) {
	for _, test := range []struct {
		name   string
		values []string
	}{
		{name: "non ASCII", values: []string{"turn-研究"}},
		{name: "too long", values: []string{"a" + strings.Repeat("b", 128)}},
		{name: "multiple", values: []string{"turn-one", "turn-two"}},
	} {
		t.Run(test.name, func(t *testing.T) {
			seedResearchHandlerPermission(t)
			previousConfig := rxBot.BotConfig
			rxBot.BotConfig = &rxBot.Config{ProxyEnabled: true, ResearchEnabled: true}
			t.Cleanup(func() { rxBot.BotConfig = previousConfig })
			previousQuota := viper.Get("chatlimit.enforce")
			viper.Set("chatlimit.enforce", false)
			t.Cleanup(func() { viper.Set("chatlimit.enforce", previousQuota) })
			ctx, recorder := newNegotiatedResearchRequest(
				t, api_service.QuerySurfaceAgentProduct, "malformed header",
			)
			ctx.Request.Header.Del("X-Phyto-Client-Turn-Id")
			for _, value := range test.values {
				ctx.Request.Header.Add("X-Phyto-Client-Turn-Id", value)
			}
			tracked := &trackingReadCloser{reader: ctx.Request.Body}
			ctx.Request.Body = tracked

			NewHandler().AgentProductRun(ctx)

			if recorder.Code != http.StatusBadRequest || tracked.reads != 0 || tracked.bytes != 0 {
				t.Fatalf("malformed header status=%d reads=%d bytes=%d body=%s", recorder.Code, tracked.reads, tracked.bytes, recorder.Body.String())
			}
		})
	}
}

func TestResearchInputIncompatibleReturnsLocalized503BeforeBodyParsing(t *testing.T) {
	tests := []struct {
		name     string
		language string
		message  string
	}{
		{name: "English", language: "en-US", message: "Research input compatibility is temporarily unavailable"},
		{name: "Chinese", language: "zh-CN", message: "\u7814\u7A76\u8F93\u5165\u517C\u5BB9\u80FD\u529B\u6682\u65F6\u4E0D\u53EF\u7528"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			seedResearchHandlerPermission(t)
			previousConfig := rxBot.BotConfig
			catalogCalls := 0
			srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				catalogCalls++
				w.Header().Set("Content-Type", "application/json")
				_, _ = w.Write([]byte(`{"upstream_diagnostic":"must-not-leak"}`))
			}))
			t.Cleanup(srv.Close)
			rxBot.BotConfig = &rxBot.Config{
				BaseURL: srv.URL, ProxyEnabled: true, ResearchEnabled: true,
			}
			t.Cleanup(func() { rxBot.BotConfig = previousConfig })
			previousQuota := viper.Get("chatlimit.enforce")
			viper.Set("chatlimit.enforce", false)
			t.Cleanup(func() { viper.Set("chatlimit.enforce", previousQuota) })

			c, w := newNegotiatedResearchRequest(
				t, api_service.QuerySurfaceAgentProduct, "bounded Research query",
			)
			if tt.language == "zh-CN" {
				c.Request.Header.Del("X-Phyto-Client-Turn-Id")
			}
			tracked := &trackingReadCloser{reader: c.Request.Body}
			c.Request.Body = tracked
			c.Request.Header.Set("Accept-Language", tt.language)
			i18n.Localize()(c)
			c.Set("username", "research@example.com")

			NewHandler().AgentProductRun(c)

			if w.Code != http.StatusServiceUnavailable {
				t.Fatalf("status=%d body=%s, want 503", w.Code, w.Body.String())
			}
			var body struct {
				Code    int    `json:"code"`
				Message string `json:"message"`
			}
			if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil {
				t.Fatalf("decode response: %v", err)
			}
			if body.Code != http.StatusServiceUnavailable || body.Message != tt.message {
				t.Fatalf("response=%#v, want localized compatibility 503", body)
			}
			if tracked.reads != 0 || tracked.bytes != 0 {
				t.Fatalf("compatibility gate read the request body: reads=%d bytes=%d", tracked.reads, tracked.bytes)
			}
			if catalogCalls != 1 {
				t.Fatalf("catalog calls=%d, want 1", catalogCalls)
			}
			if strings.Contains(w.Body.String(), "must-not-leak") {
				t.Fatalf("upstream diagnostic leaked: %s", w.Body.String())
			}
		})
	}
}

func TestQueryResearchInputIncompatibleForExplicitResearch(t *testing.T) {
	seedResearchHandlerPermission(t)
	previousConfig := rxBot.BotConfig
	catalogCalls := 0
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		catalogCalls++
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{}`))
	}))
	t.Cleanup(srv.Close)
	rxBot.BotConfig = &rxBot.Config{
		BaseURL: srv.URL, ProxyEnabled: true, ExpertEnabled: true, ResearchEnabled: true,
	}
	t.Cleanup(func() { rxBot.BotConfig = previousConfig })
	previousQuota := viper.Get("chatlimit.enforce")
	viper.Set("chatlimit.enforce", false)
	t.Cleanup(func() { viper.Set("chatlimit.enforce", previousQuota) })

	c, w := newNegotiatedResearchRequest(
		t, api_service.QuerySurfaceChat, "bounded explicit Research query",
	)
	tracked := &trackingReadCloser{reader: c.Request.Body}
	c.Request.Body = tracked

	NewHandler().Query(c)

	if w.Code != http.StatusServiceUnavailable {
		t.Fatalf("status=%d body=%s, want 503", w.Code, w.Body.String())
	}
	if tracked.reads != 0 || tracked.bytes != 0 {
		t.Fatalf("explicit Research compatibility gate read the request body: reads=%d bytes=%d", tracked.reads, tracked.bytes)
	}
	if catalogCalls != 1 {
		t.Fatalf("explicit Research catalog calls=%d, want 1", catalogCalls)
	}
}

func TestQueryResearchIntentHeaderDoesNotBypassLocalPermission(t *testing.T) {
	gdb := setupRemoteProductHandlerDB(t)
	if err := gdb.Exec(
		`INSERT INTO users (email, code, chat_limit) VALUES (?, ?, ?)`,
		"denied@example.com", "ordinary", 5,
	).Error; err != nil {
		t.Fatalf("seed denied user: %v", err)
	}
	previousConfig := rxBot.BotConfig
	catalogCalls := 0
	srv := httptest.NewServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {
		catalogCalls++
	}))
	t.Cleanup(srv.Close)
	rxBot.BotConfig = &rxBot.Config{
		BaseURL: srv.URL, ProxyEnabled: true, ExpertEnabled: true, ResearchEnabled: true,
	}
	t.Cleanup(func() { rxBot.BotConfig = previousConfig })
	previousQuota := viper.Get("chatlimit.enforce")
	viper.Set("chatlimit.enforce", false)
	t.Cleanup(func() { viper.Set("chatlimit.enforce", previousQuota) })

	gin.SetMode(gin.TestMode)
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	tracked := &trackingReadCloser{reader: strings.NewReader("must not be read")}
	c.Request = httptest.NewRequest(http.MethodPost, "/api/v1/conversations/0/messages", nil)
	c.Request.Body = tracked
	c.Request.Header.Set("Content-Type", "multipart/form-data; boundary=unread")
	c.Request.Header.Set("X-Phyto-Research-Intent", "expert-research-v1")
	c.Params = gin.Params{{Key: "id", Value: "0"}}
	c.Set("username", "denied@example.com")
	i18n.Localize()(c)

	NewHandler().Query(c)

	if w.Code != http.StatusNotFound {
		t.Fatalf("status=%d body=%s, want permission-safe 404", w.Code, w.Body.String())
	}
	if tracked.reads != 0 || tracked.bytes != 0 {
		t.Fatalf("unauthorized Research intent read body %d time(s), %d byte(s)", tracked.reads, tracked.bytes)
	}
	if catalogCalls != 0 {
		t.Fatalf("unauthorized Research intent called catalog %d time(s)", catalogCalls)
	}
}

func TestQueryResearchIntentMismatchFailsClosedBeforeDispatch(t *testing.T) {
	seedResearchHandlerPermission(t)
	previousConfig := rxBot.BotConfig
	catalogCalls := 0
	runCalls := 0
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/v1/agents" {
			catalogCalls++
			serveHandlerResearchCatalog(t, w, r)
			return
		}
		runCalls++
	}))
	t.Cleanup(srv.Close)
	rxBot.BotConfig = &rxBot.Config{
		BaseURL: srv.URL, ProxyEnabled: true, ExpertEnabled: true, ResearchEnabled: true,
	}
	t.Cleanup(func() { rxBot.BotConfig = previousConfig })
	previousQuota := viper.Get("chatlimit.enforce")
	viper.Set("chatlimit.enforce", false)
	t.Cleanup(func() { viper.Set("chatlimit.enforce", previousQuota) })

	for _, tc := range []struct {
		name   string
		mode   string
		tool   string
		header bool
	}{
		{name: "header body mismatch", mode: "expert", tool: "DataAgent", header: true},
		{name: "Research body missing header", mode: "expert", tool: "InSilicoResearchAgent"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			var body bytes.Buffer
			writer := multipart.NewWriter(&body)
			for key, value := range map[string]string{
				"query":          "research question",
				"mode":           tc.mode,
				"tool":           tc.tool,
				"client_turn_id": "research-intent-mismatch-turn",
			} {
				if err := writer.WriteField(key, value); err != nil {
					t.Fatalf("write %s: %v", key, err)
				}
			}
			if err := writer.Close(); err != nil {
				t.Fatalf("close multipart: %v", err)
			}
			gin.SetMode(gin.TestMode)
			w := httptest.NewRecorder()
			c, _ := gin.CreateTestContext(w)
			c.Request = httptest.NewRequest(http.MethodPost, "/api/v1/conversations/0/messages", &body)
			c.Request.Header.Set("Content-Type", writer.FormDataContentType())
			if tc.header {
				c.Request.Header.Set("X-Phyto-Research-Intent", "expert-research-v1")
			}
			c.Params = gin.Params{{Key: "id", Value: "0"}}
			c.Set("username", "research@example.com")
			i18n.Localize()(c)

			NewHandler().Query(c)

			if w.Code != http.StatusBadRequest {
				t.Fatalf("status=%d body=%s, want 400", w.Code, w.Body.String())
			}
			if !strings.Contains(w.Body.String(), "invalid chat routing") {
				t.Fatalf("mismatch response=%s, want finite routing error", w.Body.String())
			}
		})
	}
	if catalogCalls != 1 {
		t.Fatalf("catalog calls=%d, want only the header-signaled admission", catalogCalls)
	}
	if runCalls != 0 {
		t.Fatalf("mismatched Research intent dispatched %d Bot run(s)", runCalls)
	}
}

func newUpdateLogRequest(t *testing.T, fields map[string]string) (*gin.Context, *httptest.ResponseRecorder) {
	t.Helper()
	var buf bytes.Buffer
	mw := multipart.NewWriter(&buf)
	for key, value := range fields {
		if err := mw.WriteField(key, value); err != nil {
			t.Fatalf("write %s: %v", key, err)
		}
	}
	if err := mw.Close(); err != nil {
		t.Fatalf("close writer: %v", err)
	}
	gin.SetMode(gin.TestMode)
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Request = httptest.NewRequest(http.MethodPatch, "/api/v1/async-tasks/analyst-log", &buf)
	c.Request.Header.Set("Content-Type", mw.FormDataContentType())
	c.Set("username", "alice")
	i18n.Localize()(c)
	return c, w
}

func TestApiQueryAnalystUpdateLogRejectsBlankTaskID(t *testing.T) {
	ph := NewHandler()
	c, w := newUpdateLogRequest(t, map[string]string{"task_id": "   ", "compute_resource": "cr-1"})

	ph.QueryAnalystUpdateLog(c)

	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d body=%s", w.Code, w.Body.String())
	}
	var parsed struct {
		Code    int    `json:"code"`
		Message string `json:"message"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &parsed); err != nil {
		t.Fatalf("decode body: %v", err)
	}
	if parsed.Code != http.StatusBadRequest || parsed.Message != "task_id is required" {
		t.Fatalf("unexpected body: %+v", parsed)
	}
}

func TestQueryErrorStatusMissingBotRunID(t *testing.T) {
	status, msg := queryErrorStatus(api_service.ErrMissingBotRunID)
	if status != http.StatusConflict {
		t.Fatalf("status = %d, want 409", status)
	}
	if msg != "task is not syncable through bot run state" {
		t.Fatalf("message = %q", msg)
	}
}
