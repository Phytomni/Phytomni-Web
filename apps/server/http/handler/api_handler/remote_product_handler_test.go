package api_handler

import (
	"bytes"
	"encoding/json"
	"io"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"testing"

	"phytomni-server/common/i18n"
	"phytomni-server/db"
	rxBot "phytomni-server/external/bot"
	"phytomni-server/model"
	"phytomni-server/service/api_service"

	"github.com/gin-gonic/gin"
	"github.com/glebarez/sqlite"
	"github.com/spf13/viper"
	"gorm.io/gorm"
)

type trackingReadCloser struct {
	reader io.Reader
	reads  int
	bytes  int
}

func (r *trackingReadCloser) Read(p []byte) (int, error) {
	r.reads++
	n, err := r.reader.Read(p)
	r.bytes += n
	return n, err
}

func (r *trackingReadCloser) Close() error { return nil }

func setupRemoteProductHandlerDB(t *testing.T) *gorm.DB {
	t.Helper()
	gdb, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatalf("open sqlite: %v", err)
	}
	if sqlDB, err := gdb.DB(); err == nil {
		sqlDB.SetMaxOpenConns(1)
	}
	if err := gdb.Exec(`CREATE TABLE users (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		email TEXT,
		code TEXT,
		chat_limit INTEGER DEFAULT 0
	)`).Error; err != nil {
		t.Fatalf("create users: %v", err)
	}
	if err := gdb.Exec(`CREATE TABLE tool_names (
		id INTEGER PRIMARY KEY,
		tool_name TEXT NOT NULL
	)`).Error; err != nil {
		t.Fatalf("create tool_names: %v", err)
	}
	if err := gdb.Exec(`CREATE TABLE user_tool_names (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		code TEXT NOT NULL,
		tool_id TEXT NOT NULL
	)`).Error; err != nil {
		t.Fatalf("create user_tool_names: %v", err)
	}
	if err := gdb.Exec(`CREATE TABLE question_agent_logs (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		dialogue_id TEXT, f_id INTEGER DEFAULT 0, server_id TEXT, bot_run_id TEXT, bot_projection_json TEXT, bot_report_revision INTEGER NOT NULL DEFAULT -1,
		user_name TEXT, query TEXT, title_query TEXT, answer TEXT,
		follow_up_questions TEXT, task_id TEXT, task_log TEXT, file_name TEXT,
		upload_path TEXT, download_path TEXT, image_paths TEXT, compute_resource TEXT,
		server_file_path TEXT, tool_name TEXT, status TEXT, log_status TEXT, mode TEXT,
		reaction_type TEXT, collect_type TEXT, created_at DATETIME, updated_at DATETIME, delete_at DATETIME
	)`).Error; err != nil {
		t.Fatalf("create question_agent_logs: %v", err)
	}
	db.Set("phytomni-server", gdb)
	return gdb
}

func newRemoteProductHandlerRequest(t *testing.T, tool string, fields map[string]string) (*gin.Context, *httptest.ResponseRecorder) {
	t.Helper()
	var body bytes.Buffer
	mw := multipart.NewWriter(&body)
	if err := mw.WriteField("query", "remote query"); err != nil {
		t.Fatalf("write query: %v", err)
	}
	if err := mw.WriteField("tool", "ChatAgent"); err != nil {
		t.Fatalf("write tool: %v", err)
	}
	if err := mw.WriteField("mode", "expert"); err != nil {
		t.Fatalf("write mode: %v", err)
	}
	if err := mw.WriteField("attachments", `[{"asset_id":"file_route"}]`); err != nil {
		t.Fatalf("write attachments: %v", err)
	}
	if tool == "InSilicoResearchAgent" {
		if _, supplied := fields["client_turn_id"]; !supplied {
			if err := mw.WriteField("client_turn_id", "remote-product-research-turn"); err != nil {
				t.Fatalf("write client turn id: %v", err)
			}
		}
	}
	for name, value := range fields {
		if err := mw.WriteField(name, value); err != nil {
			t.Fatalf("write %s: %v", name, err)
		}
	}
	if err := mw.Close(); err != nil {
		t.Fatalf("close form: %v", err)
	}
	gin.SetMode(gin.TestMode)
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Request = httptest.NewRequest(http.MethodPost, "/api/v1/agent-products/"+tool+"/runs", &body)
	c.Request.Header.Set("Content-Type", mw.FormDataContentType())
	c.Params = gin.Params{{Key: "tool", Value: tool}}
	i18n.Localize()(c)
	return c, w
}

func newAttachmentTrackingRequest(t *testing.T, tool string) (*gin.Context, *httptest.ResponseRecorder, *trackingReadCloser) {
	t.Helper()
	var body bytes.Buffer
	mw := multipart.NewWriter(&body)
	if err := mw.WriteField("query", "remote query"); err != nil {
		t.Fatalf("write query: %v", err)
	}
	if tool == "InSilicoResearchAgent" {
		if err := mw.WriteField("client_turn_id", "file-part-research-turn"); err != nil {
			t.Fatalf("write client turn id: %v", err)
		}
	}
	file, err := mw.CreateFormFile("files", "attachment.txt")
	if err != nil {
		t.Fatalf("create attachment: %v", err)
	}
	if _, err := file.Write([]byte("must not be parsed")); err != nil {
		t.Fatalf("write attachment: %v", err)
	}
	if err := mw.Close(); err != nil {
		t.Fatalf("close form: %v", err)
	}

	gin.SetMode(gin.TestMode)
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	tracked := &trackingReadCloser{reader: bytes.NewReader(body.Bytes())}
	c.Request = httptest.NewRequest(http.MethodPost, "/api/v1/agent-products/"+tool+"/runs", nil)
	c.Request.Body = tracked
	c.Request.ContentLength = int64(body.Len())
	c.Request.Header.Set("Content-Type", mw.FormDataContentType())
	c.Params = gin.Params{{Key: "tool", Value: tool}}
	i18n.Localize()(c)
	return c, w, tracked
}

func TestAgentProductRunRejectsBeforeReadingAttachmentOrBot(t *testing.T) {
	productTools := []struct {
		tool string
		name string
	}{
		{tool: "AnalystAgent", name: "analyst"},
		{tool: "DigitalDesignAgent", name: "design"},
		{tool: "GeneNetworkAgent", name: "network"},
	}
	for _, product := range productTools {
		t.Run(product.name, func(t *testing.T) {
			for _, tc := range []struct {
				name     string
				email    string
				code     string
				config   *rxBot.Config
				wantCode int
			}{
				{
					name:     "permission denied",
					email:    "denied@example.com",
					code:     "ordinary",
					config:   &rxBot.Config{ProxyEnabled: true},
					wantCode: http.StatusNotFound,
				},
			} {
				t.Run(tc.name, func(t *testing.T) {
					gdb := setupRemoteProductHandlerDB(t)
					if err := gdb.Exec(`INSERT INTO users (email, code, chat_limit) VALUES (?, ?, ?)`, tc.email, tc.code, 5).Error; err != nil {
						t.Fatalf("seed user: %v", err)
					}
					previousConfig := rxBot.BotConfig
					hits := 0
					srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { hits++ }))
					t.Cleanup(srv.Close)
					tc.config.BaseURL = srv.URL
					rxBot.BotConfig = tc.config
					t.Cleanup(func() { rxBot.BotConfig = previousConfig })
					previousQuota := viper.Get("chatlimit.enforce")
					viper.Set("chatlimit.enforce", false)
					t.Cleanup(func() { viper.Set("chatlimit.enforce", previousQuota) })

					c, w, tracked := newAttachmentTrackingRequest(t, product.tool)
					c.Set("username", tc.email)
					NewHandler().AgentProductRun(c)

					if w.Code != tc.wantCode {
						t.Fatalf("status = %d, body = %s; want %d", w.Code, w.Body.String(), tc.wantCode)
					}
					if tracked.reads != 0 || tracked.bytes != 0 {
						t.Fatalf("rejected request read %d time(s), %d byte(s); want zero", tracked.reads, tracked.bytes)
					}
					if hits != 0 {
						t.Fatalf("rejected request reached Bot %d time(s)", hits)
					}
				})
			}
		})
	}
}

func TestAgentProductRunPermissionDeniedReturns404BeforeBot(t *testing.T) {
	gdb := setupRemoteProductHandlerDB(t)
	if err := gdb.Exec(`INSERT INTO users (email, code, chat_limit) VALUES (?, ?, ?)`, "denied@example.com", "ordinary", 5).Error; err != nil {
		t.Fatalf("seed user: %v", err)
	}
	previousConfig := rxBot.BotConfig
	hits := 0
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		hits++
	}))
	t.Cleanup(srv.Close)
	rxBot.BotConfig = &rxBot.Config{BaseURL: srv.URL, ProxyEnabled: true}
	t.Cleanup(func() { rxBot.BotConfig = previousConfig })
	previousQuota := viper.Get("chatlimit.enforce")
	viper.Set("chatlimit.enforce", false)
	t.Cleanup(func() { viper.Set("chatlimit.enforce", previousQuota) })

	c, w := newRemoteProductHandlerRequest(t, "InSilicoResearchAgent", nil)
	c.Set("username", "denied@example.com")
	NewHandler().AgentProductRun(c)

	if w.Code != http.StatusNotFound {
		t.Fatalf("permission-denied status = %d, body = %s; want 404", w.Code, w.Body.String())
	}
	var response struct {
		Code int `json:"code"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &response); err != nil {
		t.Fatalf("decode permission-denied body %s: %v", w.Body.String(), err)
	}
	if response.Code != http.StatusNotFound {
		t.Fatalf("permission-denied body code = %d, want 404", response.Code)
	}
	if hits != 0 {
		t.Fatalf("permission-denied request reached Bot %d time(s)", hits)
	}
}

func TestAgentProductRunUnknownToolReturns400BeforeBodyOrBot(t *testing.T) {
	previousConfig := rxBot.BotConfig
	hits := 0
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { hits++ }))
	t.Cleanup(srv.Close)
	rxBot.BotConfig = &rxBot.Config{BaseURL: srv.URL, ProxyEnabled: true}
	t.Cleanup(func() { rxBot.BotConfig = previousConfig })

	c, w := newRemoteProductHandlerRequest(t, "UnknownAgent", nil)
	c.Set("username", "remote@example.com")
	NewHandler().AgentProductRun(c)

	if w.Code != http.StatusBadRequest {
		t.Fatalf("unknown product status = %d, body = %s; want 400", w.Code, w.Body.String())
	}
	if hits != 0 {
		t.Fatalf("unknown product reached Bot %d time(s)", hits)
	}
}

func TestAgentProductRunRouteOwnsToolAndMode(t *testing.T) {
	for _, tc := range []struct {
		tool          string
		slug          string
		upstreamCode  int
		upstreamState string
		fields        map[string]string
		wantGeneID    string
		wantToID      string
		wantSpecies   string
	}{
		{tool: "InSilicoResearchAgent", slug: "research", upstreamCode: http.StatusOK, upstreamState: "succeeded", fields: map[string]string{"dataset_description": "  direct product dataset context  "}},
		{tool: "InSilicoResearchAgent", slug: "research", upstreamCode: http.StatusAccepted, upstreamState: "running"},
		{tool: "DigitalDesignAgent", slug: "design", upstreamCode: http.StatusOK, upstreamState: "succeeded", fields: map[string]string{"gene_id": " AT1G01010 ", "species_code": " ATH "}, wantGeneID: "AT1G01010", wantSpecies: "ath"},
		{tool: "DigitalDesignAgent", slug: "design", upstreamCode: http.StatusAccepted, upstreamState: "running"},
		{tool: "GeneNetworkAgent", slug: "network", upstreamCode: http.StatusOK, upstreamState: "succeeded", fields: map[string]string{"to_id": " to:0000207 ", "species_code": " OSA "}, wantToID: "TO:0000207", wantSpecies: "osa"},
		{tool: "GeneNetworkAgent", slug: "network", upstreamCode: http.StatusAccepted, upstreamState: "running"},
	} {
		t.Run(tc.slug+"-"+http.StatusText(tc.upstreamCode), func(t *testing.T) {
			gdb := setupRemoteProductHandlerDB(t)
			if err := gdb.Exec(`INSERT INTO users (email, code, chat_limit) VALUES (?, ?, ?)`, "remote@example.com", "admin", 5).Error; err != nil {
				t.Fatalf("seed user: %v", err)
			}
			previousConfig := rxBot.BotConfig
			var gotPath string
			var gotRequest rxBot.AgentRunRequest
			var gotBody map[string]json.RawMessage
			var gotIdempotencyKey string
			catalogCalls := 0
			runID := "run-" + tc.slug
			taskID := "task-" + tc.slug
			srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.URL.Path == "/v1/agents" {
					catalogCalls++
					if catalogCalls == 1 {
						serveHandlerResearchCatalog(t, w, r)
					} else {
						w.Header().Set("Content-Type", "application/json")
						_, _ = w.Write([]byte(`{}`))
					}
					return
				}
				gotPath = r.URL.Path
				gotIdempotencyKey = r.Header.Get("Idempotency-Key")
				body, err := io.ReadAll(r.Body)
				if err != nil {
					t.Errorf("read Bot request: %v", err)
				}
				if err := json.Unmarshal(body, &gotRequest); err != nil {
					t.Errorf("decode Bot request: %v", err)
				}
				if err := json.Unmarshal(body, &gotBody); err != nil {
					t.Errorf("decode raw Bot request: %v", err)
				}
				w.Header().Set("Content-Type", "application/json")
				w.WriteHeader(tc.upstreamCode)
				_, _ = w.Write([]byte(`{"id":"` + runID + `","object":"agent.run","agent":"` + tc.slug + `","status":"` + tc.upstreamState + `","task_ids":["` + taskID + `"],"result":{}}`))
			}))
			t.Cleanup(srv.Close)
			rxBot.BotConfig = &rxBot.Config{BaseURL: srv.URL, ProxyEnabled: true}
			t.Cleanup(func() { rxBot.BotConfig = previousConfig })
			previousQuota := viper.Get("chatlimit.enforce")
			viper.Set("chatlimit.enforce", false)
			t.Cleanup(func() { viper.Set("chatlimit.enforce", previousQuota) })

			c, w := newRemoteProductHandlerRequest(t, tc.tool, tc.fields)
			captured := queryInputForSurface(c, api_service.QuerySurfaceAgentProduct, tc.tool)
			if captured.Surface != api_service.QuerySurfaceAgentProduct || captured.Tool != tc.tool || captured.Mode != "instant" {
				t.Fatalf("route-owned input = %#v; want product surface, %q, instant", captured, tc.tool)
			}
			c.Set("username", "remote@example.com")
			NewHandler().AgentProductRun(c)

			if w.Code != http.StatusOK {
				t.Fatalf("status = %d, body = %s", w.Code, w.Body.String())
			}
			wantCatalogCalls := 0
			if tc.slug == "research" {
				wantCatalogCalls = 1
			}
			if catalogCalls != wantCatalogCalls {
				t.Fatalf("catalog calls=%d, want %d", catalogCalls, wantCatalogCalls)
			}
			if gotPath != "/v1/agents/"+tc.slug+"/runs" {
				t.Fatalf("Bot path = %q, want dedicated %s run", gotPath, tc.slug)
			}
			if _, leaked := gotRequest.Arguments["dataset_description"]; leaked {
				t.Fatal("dataset_description crossed the product boundary inside arguments")
			}
			if tc.slug == "research" {
				if gotIdempotencyKey != "remote-product-research-turn" {
					t.Fatalf("Research Idempotency-Key=%q", gotIdempotencyKey)
				}
				if _, leaked := gotBody["idempotency_key"]; leaked {
					t.Fatalf("Research idempotency key leaked into JSON body: %#v", gotBody)
				}
				dataList, ok := gotRequest.Arguments["data_list"].(map[string]interface{})
				if !ok || len(dataList) != 0 {
					t.Fatalf("research data_list=%#v, want an empty JSON object", gotRequest.Arguments["data_list"])
				}
			}
			if obsFileList, ok := gotRequest.Arguments["obs_file_list"].([]interface{}); !ok || len(obsFileList) != 0 {
				t.Fatalf("%s obs_file_list=%#v, want an empty JSON array", tc.slug, gotRequest.Arguments["obs_file_list"])
			}
			if tc.wantGeneID != "" && gotRequest.Arguments["gene_id"] != tc.wantGeneID {
				t.Fatalf("Bot gene_id = %#v, want %q", gotRequest.Arguments["gene_id"], tc.wantGeneID)
			}
			if tc.wantToID != "" && gotRequest.Arguments["to_id"] != tc.wantToID {
				t.Fatalf("Bot to_id = %#v, want %q", gotRequest.Arguments["to_id"], tc.wantToID)
			}
			if tc.wantSpecies != "" && gotRequest.Arguments["species_code"] != tc.wantSpecies {
				t.Fatalf("Bot species_code = %#v, want %q", gotRequest.Arguments["species_code"], tc.wantSpecies)
			}
			if len(gotRequest.Attachments) != 1 || gotRequest.Attachments[0].AssetID != "file_route" {
				t.Fatalf("opaque attachments=%#v, want file_route", gotRequest.Attachments)
			}
			if _, leaked := gotBody["dataset_description"]; leaked {
				t.Fatalf("dataset_description crossed the product request boundary: %#v", gotBody)
			}
			var response struct {
				Code int                   `json:"code"`
				Data api_service.QueryData `json:"data"`
			}
			if err := json.Unmarshal(w.Body.Bytes(), &response); err != nil {
				t.Fatalf("decode response %s: %v", w.Body.String(), err)
			}
			if response.Code != http.StatusOK || response.Data.DialogueId == "" || response.Data.BotRunID != runID {
				t.Fatalf("response identity = %#v", response)
			}
			var row model.QuestionAgentLog
			if err := gdb.First(&row).Error; err != nil {
				t.Fatalf("load persisted row: %v", err)
			}
			if row.DialogueId != response.Data.DialogueId || row.BotRunId != runID || row.ToolName != tc.tool || row.Mode != "instant" {
				t.Fatalf("persisted row = %#v", row)
			}
			if tc.upstreamCode == http.StatusAccepted && (response.Data.TaskId != taskID || row.TaskId != taskID) {
				t.Fatalf("async task identity = response:%q row:%q; want %q", response.Data.TaskId, row.TaskId, taskID)
			}
		})
	}
}

func TestAgentProductResolverRejectsBeforeBot(t *testing.T) {
	for _, tc := range []struct {
		name   string
		tool   string
		fields map[string]string
	}{
		{name: "design missing species", tool: "DigitalDesignAgent", fields: map[string]string{"gene_id": "AT1G01010"}},
		{name: "network rejects gene", tool: "GeneNetworkAgent", fields: map[string]string{"gene_id": "AT1G01010", "species_code": "ath"}},
		{name: "research rejects resolver", tool: "InSilicoResearchAgent", fields: map[string]string{"gene_id": "AT1G01010"}},
		{name: "invalid values stay generic", tool: "GeneNetworkAgent", fields: map[string]string{"to_id": "TO:9999999", "species_code": "ath"}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			gdb := setupRemoteProductHandlerDB(t)
			if err := gdb.Exec(`INSERT INTO users (email, code, chat_limit) VALUES (?, ?, ?)`, "remote@example.com", "admin", 5).Error; err != nil {
				t.Fatalf("seed user: %v", err)
			}
			previousConfig := rxBot.BotConfig
			hits := 0
			srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if serveHandlerResearchCatalog(t, w, r) {
					return
				}
				hits++
			}))
			t.Cleanup(srv.Close)
			rxBot.BotConfig = &rxBot.Config{BaseURL: srv.URL, ProxyEnabled: true}
			t.Cleanup(func() { rxBot.BotConfig = previousConfig })
			previousQuota := viper.Get("chatlimit.enforce")
			viper.Set("chatlimit.enforce", false)
			t.Cleanup(func() { viper.Set("chatlimit.enforce", previousQuota) })

			c, w := newRemoteProductHandlerRequest(t, tc.tool, tc.fields)
			c.Set("username", "remote@example.com")
			NewHandler().AgentProductRun(c)

			if w.Code != http.StatusBadRequest {
				t.Fatalf("status = %d, body = %s; want 400", w.Code, w.Body.String())
			}
			if w.Body.String() != `{"code":400,"message":"invalid agent resolver"}` {
				t.Fatalf("resolver error body = %s", w.Body.String())
			}
			if hits != 0 {
				t.Fatalf("invalid resolver reached Bot %d time(s)", hits)
			}
		})
	}
}

func TestAgentProductRunRejectsFilePartsBeforeBot(t *testing.T) {
	for _, tool := range []string{"InSilicoResearchAgent", "DigitalDesignAgent", "GeneNetworkAgent"} {
		t.Run(tool, func(t *testing.T) {
			gdb := setupRemoteProductHandlerDB(t)
			if err := gdb.Exec(`INSERT INTO users (email, code, chat_limit) VALUES (?, ?, ?)`, "remote@example.com", "admin", 5).Error; err != nil {
				t.Fatalf("seed user: %v", err)
			}
			previousConfig := rxBot.BotConfig
			hits := 0
			srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if serveHandlerResearchCatalog(t, w, r) {
					return
				}
				hits++
			}))
			t.Cleanup(srv.Close)
			rxBot.BotConfig = &rxBot.Config{
				BaseURL:      srv.URL,
				ProxyEnabled: true,
			}
			t.Cleanup(func() { rxBot.BotConfig = previousConfig })
			previousQuota := viper.Get("chatlimit.enforce")
			viper.Set("chatlimit.enforce", false)
			t.Cleanup(func() { viper.Set("chatlimit.enforce", previousQuota) })

			c, w, _ := newAttachmentTrackingRequest(t, tool)
			c.Set("username", "remote@example.com")
			NewHandler().AgentProductRun(c)

			if w.Code != http.StatusUnsupportedMediaType {
				t.Fatalf("status = %d, body = %s; want 415", w.Code, w.Body.String())
			}
			if hits != 0 {
				t.Fatalf("oversized upload reached Bot %d time(s)", hits)
			}
		})
	}
}

func TestAgentProductRunUpstreamFailuresStayOpaque(t *testing.T) {
	for _, tool := range []string{"InSilicoResearchAgent", "DigitalDesignAgent", "GeneNetworkAgent"} {
		t.Run(tool, func(t *testing.T) {
			gdb := setupRemoteProductHandlerDB(t)
			if err := gdb.Exec(`INSERT INTO users (email, code, chat_limit) VALUES (?, ?, ?)`, "remote@example.com", "admin", 5).Error; err != nil {
				t.Fatalf("seed user: %v", err)
			}
			previousConfig := rxBot.BotConfig
			srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if serveHandlerResearchCatalog(t, w, r) {
					return
				}
				w.WriteHeader(http.StatusServiceUnavailable)
				_, _ = w.Write([]byte("Bot implementation detail"))
			}))
			t.Cleanup(srv.Close)
			rxBot.BotConfig = &rxBot.Config{BaseURL: srv.URL, ProxyEnabled: true}
			t.Cleanup(func() { rxBot.BotConfig = previousConfig })
			previousQuota := viper.Get("chatlimit.enforce")
			viper.Set("chatlimit.enforce", false)
			t.Cleanup(func() { viper.Set("chatlimit.enforce", previousQuota) })

			c, w := newRemoteProductHandlerRequest(t, tool, nil)
			c.Set("username", "remote@example.com")
			NewHandler().AgentProductRun(c)

			if w.Code != http.StatusBadGateway {
				t.Fatalf("status = %d, body = %s; want 502", w.Code, w.Body.String())
			}
			if bytes.Contains(w.Body.Bytes(), []byte("Bot implementation detail")) {
				t.Fatalf("upstream detail leaked: %s", w.Body.String())
			}
		})
	}
}
