package api_handler

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"phytomni-server/common/i18n"
	rxBot "phytomni-server/external/bot"

	"github.com/gin-gonic/gin"
)

type uploadHandlerCreateCapture struct {
	OwnerSubject   string `json:"owner_subject"`
	IdempotencyKey string `json:"idempotency_key"`
	Purpose        string `json:"purpose"`
	Filename       string `json:"filename"`
}

type uploadHandlerErrorResponse struct {
	Code      int     `json:"code"`
	ErrorCode *string `json:"error_code"`
	Message   string  `json:"message"`
}

func uploadHandlerAgentManifest(t *testing.T) string {
	t.Helper()
	descriptors := make([]rxBot.AgentDescriptor, 0, len(rxBot.WebAgentDefinitions))
	for _, definition := range rxBot.WebAgentDefinitions {
		attachments := rxBot.AgentDescriptorAttachments{}
		switch definition.Slug {
		case "data", "brief_gene", "deep_genome":
		default:
			attachments.DocumentContext = &struct{}{}
		}
		descriptors = append(descriptors, rxBot.AgentDescriptor{
			Slug: definition.Slug,
			Tool: definition.Tool,
			Capabilities: rxBot.AgentDescriptorCapabilities{
				Attachments: attachments,
			},
		})
	}
	body, err := json.Marshal(rxBot.AgentsListResponse{
		Object:    "list",
		Data:      descriptors,
		Protocols: map[string][]int{rxBot.ResumableUploadProtocol: {rxBot.ResumableUploadProtocolVersion}},
	})
	if err != nil {
		t.Fatalf("marshal handler agent manifest: %v", err)
	}
	return string(body)
}

func uploadHandlerServer(t *testing.T, captures *[]uploadHandlerCreateCapture, calls *int) *httptest.Server {
	t.Helper()
	var server *httptest.Server
	server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if calls != nil {
			*calls = *calls + 1
		}
		switch {
		case r.Method == http.MethodGet && r.URL.Path == "/v1/agents":
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(uploadHandlerAgentManifest(t)))
		case r.Method == http.MethodPost && r.URL.Path == "/v1/files":
			var request uploadHandlerCreateCapture
			if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
				http.Error(w, "invalid", http.StatusBadRequest)
				return
			}
			if captures != nil {
				*captures = append(*captures, request)
			}
			future := time.Now().Add(time.Hour).UTC().Format(time.RFC3339)
			later := time.Now().Add(2 * time.Hour).UTC().Format(time.RFC3339)
			response := rxBot.UploadCreateResponse{
				Protocol:            rxBot.ResumableUploadProtocol,
				AssetID:             "file_handler",
				Status:              "uploading",
				PartSizeBytes:       128 << 20,
				PartCount:           1,
				MaxParallelParts:    4,
				UploadURL:           server.URL + "/v1/files/file_handler",
				Capability:          "opaque-capability",
				CapabilityExpiresAt: future,
				SessionExpiresAt:    later,
			}
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode(response)
		case r.Method == http.MethodPost && r.URL.Path == "/v1/files/file_handler/capability":
			future := time.Now().Add(time.Hour).UTC().Format(time.RFC3339)
			later := time.Now().Add(2 * time.Hour).UTC().Format(time.RFC3339)
			response := rxBot.UploadCapabilityResponse{
				Protocol:            rxBot.ResumableUploadProtocol,
				AssetID:             "file_handler",
				Status:              "uploading",
				UploadURL:           server.URL + "/v1/files/file_handler",
				Capability:          "renewed-capability",
				CapabilityExpiresAt: future,
				SessionExpiresAt:    later,
			}
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode(response)
		default:
			http.NotFound(w, r)
		}
	}))
	t.Cleanup(server.Close)
	return server
}

func uploadHandlerErrorServer(t *testing.T, status int, body string) *httptest.Server {
	t.Helper()
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodGet && r.URL.Path == "/v1/agents" {
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(uploadHandlerAgentManifest(t)))
			return
		}
		if r.Method == http.MethodPost && (r.URL.Path == "/v1/files" || r.URL.Path == "/v1/files/file_handler/capability") {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(status)
			_, _ = w.Write([]byte(body))
			return
		}
		http.NotFound(w, r)
	}))
	t.Cleanup(server.Close)
	return server
}

func setupUploadHandler(t *testing.T, serverURL string) {
	t.Helper()
	previous := rxBot.BotConfig
	rxBot.BotConfig = &rxBot.Config{
		BaseURL:            serverURL,
		ProxyEnabled:       true,
		UploadPublicOrigin: serverURL,
		TimeoutSeconds:     1,
	}
	t.Cleanup(func() { rxBot.BotConfig = previous })
}

func invokeUploadHandler(t *testing.T, method, path, body, contentType, username, idempotency string, handler gin.HandlerFunc) *httptest.ResponseRecorder {
	return invokeUploadHandlerWithLanguage(t, method, path, body, contentType, username, idempotency, "", handler)
}

func invokeUploadHandlerWithLanguage(t *testing.T, method, path, body, contentType, username, idempotency, language string, handler gin.HandlerFunc) *httptest.ResponseRecorder {
	t.Helper()
	gin.SetMode(gin.TestMode)
	response := httptest.NewRecorder()
	ctx, _ := gin.CreateTestContext(response)
	ctx.Request = httptest.NewRequest(method, path, strings.NewReader(body))
	if strings.Contains(path, "/files/") {
		ctx.Params = gin.Params{{Key: "asset_id", Value: "file_handler"}}
	}
	if contentType != "" {
		ctx.Request.Header.Set("Content-Type", contentType)
	}
	if idempotency != "" {
		ctx.Request.Header.Set("Idempotency-Key", idempotency)
	}
	if language != "" {
		ctx.Request.Header.Set("Accept-Language", language)
	}
	if username != "" {
		ctx.Set("username", username)
	}
	i18n.Localize()(ctx)
	handler(ctx)
	return response
}

func TestCreateUploadHandlerClassificationErrorsAreLocalized(t *testing.T) {
	var calls int
	server := uploadHandlerServer(t, nil, &calls)
	setupUploadHandler(t, server.URL)
	response := invokeUploadHandlerWithLanguage(t, http.MethodPost, "/api/v1/files", `{"filename":"sample.bin","size_bytes":1,"tool":"DataAgent"}`, "application/json", "alice@example.com", "550e8400-e29b-41d4-a716-446655440000", "zh-CN", NewHandler().CreateUpload)
	if response.Code != http.StatusUnprocessableEntity {
		t.Fatalf("status=%d body=%s, want 422", response.Code, response.Body.String())
	}
	var payload struct {
		Code    string `json:"code"`
		Message string `json:"message"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &payload); err != nil {
		t.Fatalf("decode error response: %v", err)
	}
	if payload.Code != "attachment_type_unsupported" || payload.Message != "文件名无法识别为受支持的附件类型" {
		t.Fatalf("localized error response=%#v", payload)
	}
}

func TestCreateUploadHandlerSuccessSetsNoStore(t *testing.T) {
	var captures []uploadHandlerCreateCapture
	server := uploadHandlerServer(t, &captures, nil)
	setupUploadHandler(t, server.URL)
	response := invokeUploadHandler(t, http.MethodPost, "/api/v1/files", `{"filename":"counts.csv","size_bytes":1,"content_type_hint":"application/octet-stream"}`, "application/json; charset=utf-8", "alice@example.com", "550e8400-e29b-41d4-a716-446655440000", NewHandler().CreateUpload)
	if response.Code != http.StatusOK {
		t.Fatalf("status=%d body=%s", response.Code, response.Body.String())
	}
	if response.Header().Get("Cache-Control") != "no-store" {
		t.Fatalf("Cache-Control=%q, want no-store", response.Header().Get("Cache-Control"))
	}
	if len(captures) != 1 || captures[0].OwnerSubject != "alice@example.com" || captures[0].Purpose != "dataset" {
		t.Fatalf("Bot request authority=%#v", captures)
	}
}

func TestCreateUploadHandlerAcceptsNeutralTxtUsingAgentChannels(t *testing.T) {
	tests := []struct {
		name    string
		body    string
		purpose string
	}{
		{name: "txt document", body: `{"filename":"test.txt","size_bytes":8,"content_type_hint":"text/plain"}`, purpose: "document"},
		{name: "knowledge document", body: `{"filename":"test.txt","size_bytes":8,"content_type_hint":"text/plain","tool":"KnowledgeAgent"}`, purpose: "document"},
		{name: "unknown dataset", body: `{"filename":"image.png","size_bytes":8,"content_type_hint":"image/png"}`, purpose: "dataset"},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			var captures []uploadHandlerCreateCapture
			server := uploadHandlerServer(t, &captures, nil)
			setupUploadHandler(t, server.URL)
			response := invokeUploadHandler(t, http.MethodPost, "/api/v1/files", test.body, "application/json", "alice@example.com", "550e8400-e29b-41d4-a716-446655440000", NewHandler().CreateUpload)
			if response.Code != http.StatusOK {
				t.Fatalf("status=%d body=%s", response.Code, response.Body.String())
			}
			if len(captures) != 1 || captures[0].Purpose != test.purpose {
				t.Fatalf("Bot request=%#v, want purpose %q", captures, test.purpose)
			}
		})
	}
}

func TestCreateUploadHandlerRejectsAgentWithoutAttachmentChannels(t *testing.T) {
	var calls int
	server := uploadHandlerServer(t, nil, &calls)
	setupUploadHandler(t, server.URL)
	response := invokeUploadHandler(t, http.MethodPost, "/api/v1/files", `{"filename":"sample.bin","size_bytes":9,"tool":"DataAgent"}`, "application/json", "alice@example.com", "550e8400-e29b-41d4-a716-446655440000", NewHandler().CreateUpload)
	if response.Code != http.StatusUnprocessableEntity {
		t.Fatalf("status=%d body=%s, want 422", response.Code, response.Body.String())
	}
	var payload struct {
		Code    string `json:"code"`
		Message string `json:"message"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &payload); err != nil {
		t.Fatalf("decode error response: %v", err)
	}
	if payload.Code != "attachment_type_unsupported" || payload.Message != "file name does not identify a supported attachment type" {
		t.Fatalf("error response=%#v", payload)
	}
}

func TestCreateUploadHandlerRejectsForbiddenBrowserFields(t *testing.T) {
	for name, body := range map[string]string{
		"obsolete purpose":     `{"filename":"paper.pdf","size_bytes":1,"purpose":"dataset"}`,
		"owner assertion":      `{"filename":"paper.pdf","size_bytes":1,"owner_subject":"bob@example.com"}`,
		"native data list":     `{"filename":"paper.pdf","size_bytes":1,"data_list":["file_1"]}`,
		"native document list": `{"filename":"paper.pdf","size_bytes":1,"obs_file_list":["file_1"]}`,
		"storage field":        `{"filename":"paper.pdf","size_bytes":1,"object_key":"private/object"}`,
	} {
		t.Run(name, func(t *testing.T) {
			var calls int
			server := uploadHandlerServer(t, nil, &calls)
			setupUploadHandler(t, server.URL)
			response := invokeUploadHandler(t, http.MethodPost, "/api/v1/files", body, "application/json", "alice@example.com", "550e8400-e29b-41d4-a716-446655440000", NewHandler().CreateUpload)
			if response.Code != http.StatusBadRequest {
				t.Fatalf("status=%d body=%s, want bad request", response.Code, response.Body.String())
			}
			if calls != 0 {
				t.Fatalf("forbidden browser field reached Bot %d times", calls)
			}
		})
	}
}

func TestCreateUploadHandlerRejectsMultipartAndOversizedMetadata(t *testing.T) {
	var calls int
	server := uploadHandlerServer(t, nil, &calls)
	setupUploadHandler(t, server.URL)
	multipartResponse := invokeUploadHandler(t, http.MethodPost, "/api/v1/files", "file-bytes", "multipart/form-data; boundary=test", "alice@example.com", "550e8400-e29b-41d4-a716-446655440000", NewHandler().CreateUpload)
	if multipartResponse.Code != http.StatusUnsupportedMediaType {
		t.Fatalf("multipart status=%d, want 415", multipartResponse.Code)
	}
	oversizedResponse := invokeUploadHandler(t, http.MethodPost, "/api/v1/files", strings.Repeat("x", int(maxUploadControlBodyBytes+1)), "application/json", "alice@example.com", "550e8400-e29b-41d4-a716-446655440000", NewHandler().CreateUpload)
	if oversizedResponse.Code != http.StatusRequestEntityTooLarge {
		t.Fatalf("oversized status=%d, want 413", oversizedResponse.Code)
	}
	if calls != 0 {
		t.Fatalf("invalid browser bodies reached Bot %d times", calls)
	}
}

func TestUploadHandlersRequireAuthentication(t *testing.T) {
	response := invokeUploadHandler(t, http.MethodPost, "/api/v1/files", `{"filename":"paper.pdf","size_bytes":1}`, "application/json", "", "550e8400-e29b-41d4-a716-446655440000", NewHandler().CreateUpload)
	if response.Code != http.StatusUnauthorized {
		t.Fatalf("create unauthenticated status=%d, want 401", response.Code)
	}
	response = invokeUploadHandler(t, http.MethodPost, "/api/v1/files/file_handler/capability", "", "", "", "", NewHandler().RenewUploadCapability)
	if response.Code != http.StatusUnauthorized {
		t.Fatalf("renew unauthenticated status=%d, want 401", response.Code)
	}
}

func TestRenewUploadHandlerRejectsAnyBodyAndSetsNoStore(t *testing.T) {
	var calls int
	server := uploadHandlerServer(t, nil, &calls)
	setupUploadHandler(t, server.URL)
	withBody := invokeUploadHandler(t, http.MethodPost, "/api/v1/files/file_handler/capability", `{}`, "application/json", "alice@example.com", "", NewHandler().RenewUploadCapability)
	if withBody.Code != http.StatusBadRequest {
		t.Fatalf("body-bearing renewal status=%d, want 400", withBody.Code)
	}
	if calls != 0 {
		t.Fatalf("body-bearing renewal reached Bot %d times", calls)
	}
	response := invokeUploadHandler(t, http.MethodPost, "/api/v1/files/file_handler/capability", "", "", "alice@example.com", "", NewHandler().RenewUploadCapability)
	if response.Code != http.StatusOK {
		t.Fatalf("renew status=%d body=%s", response.Code, response.Body.String())
	}
	if response.Header().Get("Cache-Control") != "no-store" {
		t.Fatalf("renew Cache-Control=%q, want no-store", response.Header().Get("Cache-Control"))
	}
}

func TestCreateUploadHandlerScopesSameIdempotencyKeyPerUser(t *testing.T) {
	var captures []uploadHandlerCreateCapture
	server := uploadHandlerServer(t, &captures, nil)
	setupUploadHandler(t, server.URL)
	for _, user := range []string{"alice@example.com", "bob@example.com"} {
		response := invokeUploadHandler(t, http.MethodPost, "/api/v1/files", `{"filename":"paper.pdf","size_bytes":1}`, "application/json", user, "550e8400-e29b-41d4-a716-446655440000", NewHandler().CreateUpload)
		if response.Code != http.StatusOK {
			t.Fatalf("user %s status=%d body=%s", user, response.Code, response.Body.String())
		}
	}
	if len(captures) != 2 || captures[0].IdempotencyKey != captures[1].IdempotencyKey || captures[0].OwnerSubject == captures[1].OwnerSubject {
		t.Fatalf("idempotency owner scope=%#v", captures)
	}
}

func TestUploadServiceErrorExactPairsAreLocalizedForCreateAndRenew(t *testing.T) {
	tests := []struct {
		name      string
		status    int
		errorCode string
		messages  map[string]string
	}{
		{
			name:      "state conflict",
			status:    http.StatusConflict,
			errorCode: "upload_state_conflict",
			messages: map[string]string{
				"en-US": "upload state changed; retry the upload",
				"zh-CN": "上传状态已变更，请重试上传",
			},
		},
		{
			name:      "session expired",
			status:    http.StatusGone,
			errorCode: "upload_session_expired",
			messages: map[string]string{
				"en-US": "upload session expired; start the upload again",
				"zh-CN": "上传会话已过期，请重新开始上传",
			},
		},
		{
			name:      "limit exceeded",
			status:    http.StatusRequestEntityTooLarge,
			errorCode: "upload_limit_exceeded",
			messages: map[string]string{
				"en-US": "too many uploads in progress; cancel a failed upload and retry",
				"zh-CN": "同时上传已达上限，请取消失败的上传后重试",
			},
		},
	}
	operations := []struct {
		name        string
		path        string
		body        string
		contentType string
		idempotency string
		handler     func(*Handler) gin.HandlerFunc
	}{
		{
			name:        "create",
			path:        "/api/v1/files",
			body:        `{"filename":"paper.pdf","size_bytes":1}`,
			contentType: "application/json",
			idempotency: "550e8400-e29b-41d4-a716-446655440000",
			handler:     func(handler *Handler) gin.HandlerFunc { return handler.CreateUpload },
		},
		{
			name:    "renew",
			path:    "/api/v1/files/file_handler/capability",
			handler: func(handler *Handler) gin.HandlerFunc { return handler.RenewUploadCapability },
		},
	}

	for _, test := range tests {
		for _, operation := range operations {
			for language, wantMessage := range test.messages {
				t.Run(test.name+"/"+operation.name+"/"+language, func(t *testing.T) {
					upstreamBody := `{"error":{"code":"` + test.errorCode + `","message":"private-upstream-message-marker","stage":"private-stage-marker","path":"/private/path-marker","request_id":"private-request-id-marker"},"raw":"private-raw-body-marker"}`
					server := uploadHandlerErrorServer(t, test.status, upstreamBody)
					setupUploadHandler(t, server.URL)
					response := invokeUploadHandlerWithLanguage(
						t, http.MethodPost, operation.path, operation.body, operation.contentType,
						"alice@example.com", operation.idempotency, language,
						operation.handler(NewHandler()),
					)
					if response.Code != test.status {
						t.Fatalf("status=%d body=%s, want %d", response.Code, response.Body.String(), test.status)
					}
					var payload uploadHandlerErrorResponse
					if err := json.Unmarshal(response.Body.Bytes(), &payload); err != nil {
						t.Fatalf("decode error response: %v", err)
					}
					if payload.Code != test.status || payload.ErrorCode == nil || *payload.ErrorCode != test.errorCode || payload.Message != wantMessage {
						t.Fatalf("error response=%#v, want code=%d error_code=%q message=%q", payload, test.status, test.errorCode, wantMessage)
					}
					for _, marker := range []string{"private-upstream-message-marker", "private-stage-marker", "/private/path-marker", "private-request-id-marker", "private-raw-body-marker"} {
						if strings.Contains(response.Body.String(), marker) {
							t.Fatalf("browser response leaked upstream marker %q: %s", marker, response.Body.String())
						}
					}
				})
			}
		}
	}
}

func TestUploadServiceErrorUnsafeOutcomesStayGenericForCreateAndRenew(t *testing.T) {
	tests := []struct {
		name   string
		status int
		body   string
	}{
		{
			name:   "mismatched status and code",
			status: http.StatusConflict,
			body:   `{"error":{"code":"upload_session_expired","message":"private-upstream-message-marker"}}`,
		},
		{
			name:   "unknown code",
			status: http.StatusUnprocessableEntity,
			body:   `{"error":{"code":"private_unknown_code_marker","message":"private-upstream-message-marker"}}`,
		},
		{
			name:   "malformed body",
			status: http.StatusConflict,
			body:   `{"error":{"code":"upload_state_conflict","message":"private-malformed-body-marker"`,
		},
		{
			name:   "server error",
			status: http.StatusInternalServerError,
			body:   `{"error":{"code":"upload_state_conflict","message":"private-upstream-message-marker"}}`,
		},
	}
	operations := []struct {
		name        string
		path        string
		body        string
		contentType string
		idempotency string
		language    string
		wantMessage string
		handler     func(*Handler) gin.HandlerFunc
	}{
		{
			name:        "create",
			path:        "/api/v1/files",
			body:        `{"filename":"paper.pdf","size_bytes":1}`,
			contentType: "application/json",
			idempotency: "550e8400-e29b-41d4-a716-446655440000",
			language:    "en-US",
			wantMessage: "file upload is temporarily unavailable",
			handler:     func(handler *Handler) gin.HandlerFunc { return handler.CreateUpload },
		},
		{
			name:        "renew",
			path:        "/api/v1/files/file_handler/capability",
			language:    "zh-CN",
			wantMessage: "文件上传暂时不可用",
			handler:     func(handler *Handler) gin.HandlerFunc { return handler.RenewUploadCapability },
		},
	}

	for _, test := range tests {
		for _, operation := range operations {
			t.Run(test.name+"/"+operation.name, func(t *testing.T) {
				server := uploadHandlerErrorServer(t, test.status, test.body)
				setupUploadHandler(t, server.URL)
				response := invokeUploadHandlerWithLanguage(
					t, http.MethodPost, operation.path, operation.body, operation.contentType,
					"alice@example.com", operation.idempotency, operation.language,
					operation.handler(NewHandler()),
				)
				if response.Code != http.StatusServiceUnavailable {
					t.Fatalf("status=%d body=%s, want 503", response.Code, response.Body.String())
				}
				var payload uploadHandlerErrorResponse
				if err := json.Unmarshal(response.Body.Bytes(), &payload); err != nil {
					t.Fatalf("decode error response: %v", err)
				}
				if payload.Code != http.StatusServiceUnavailable || payload.ErrorCode != nil || payload.Message != operation.wantMessage {
					t.Fatalf("generic error response=%#v, want code=503 without error_code and message=%q", payload, operation.wantMessage)
				}
				for _, marker := range []string{"upload_state_conflict", "upload_session_expired", "private_unknown_code_marker", "private-upstream-message-marker", "private-malformed-body-marker"} {
					if strings.Contains(response.Body.String(), marker) {
						t.Fatalf("generic response leaked upstream marker %q: %s", marker, response.Body.String())
					}
				}
			})
		}
	}
}
