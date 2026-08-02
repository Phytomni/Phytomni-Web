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

func uploadHandlerAgentManifest(t *testing.T) string {
	t.Helper()
	descriptors := make([]rxBot.AgentDescriptor, 0, len(rxBot.WebAgentDefinitions))
	for _, definition := range rxBot.WebAgentDefinitions {
		descriptors = append(descriptors, rxBot.AgentDescriptor{Slug: definition.Slug, Tool: definition.Tool})
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

func setupUploadHandler(t *testing.T, serverURL string) {
	t.Helper()
	previous := rxBot.BotConfig
	rxBot.BotConfig = &rxBot.Config{
		BaseURL:                serverURL,
		ProxyEnabled:           true,
		ResumableUploadEnabled: true,
		UploadPublicOrigin:     serverURL,
		TimeoutSeconds:         1,
	}
	t.Cleanup(func() { rxBot.BotConfig = previous })
}

func invokeUploadHandler(t *testing.T, method, path, body, contentType, username, idempotency string, handler gin.HandlerFunc) *httptest.ResponseRecorder {
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
	if username != "" {
		ctx.Set("username", username)
	}
	i18n.Localize()(ctx)
	handler(ctx)
	return response
}

func TestCreateUploadHandlerSuccessSetsNoStore(t *testing.T) {
	var captures []uploadHandlerCreateCapture
	server := uploadHandlerServer(t, &captures, nil)
	setupUploadHandler(t, server.URL)
	response := invokeUploadHandler(t, http.MethodPost, "/api/v1/files", `{"filename":"sample.fastq.gz","size_bytes":1,"content_type_hint":"application/octet-stream","purpose":"dataset"}`, "application/json; charset=utf-8", "alice@example.com", "550e8400-e29b-41d4-a716-446655440000", NewHandler().CreateUpload)
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

func TestCreateUploadHandlerRequiresFinitePurpose(t *testing.T) {
	for name, body := range map[string]string{
		"missing":          `{"filename":"counts.csv","size_bytes":9}`,
		"blank":            `{"filename":"counts.csv","size_bytes":9,"purpose":""}`,
		"wrong case":       `{"filename":"counts.csv","size_bytes":9,"purpose":"Dataset"}`,
		"unknown":          `{"filename":"counts.csv","size_bytes":9,"purpose":"analysis"}`,
		"legacy forbidden": `{"filename":"counts.csv","size_bytes":9,"purpose":"chat_attachment"}`,
	} {
		t.Run(name, func(t *testing.T) {
			var calls int
			server := uploadHandlerServer(t, nil, &calls)
			setupUploadHandler(t, server.URL)
			response := invokeUploadHandler(t, http.MethodPost, "/api/v1/files", body, "application/json", "alice@example.com", "550e8400-e29b-41d4-a716-446655440000", NewHandler().CreateUpload)
			if response.Code != http.StatusUnprocessableEntity {
				t.Fatalf("status=%d body=%s, want 422", response.Code, response.Body.String())
			}
			var envelope struct {
				Code      int    `json:"code"`
				ErrorCode string `json:"error_code"`
			}
			if err := json.Unmarshal(response.Body.Bytes(), &envelope); err != nil {
				t.Fatalf("decode response: %v", err)
			}
			if envelope.Code != http.StatusUnprocessableEntity || envelope.ErrorCode != "attachment_purpose_invalid" {
				t.Fatalf("response=%#v", envelope)
			}
			if calls != 0 {
				t.Fatalf("invalid purpose reached Bot %d times", calls)
			}
		})
	}
}

func TestCreateUploadHandlerRejectsCallerAuthorityFields(t *testing.T) {
	var calls int
	server := uploadHandlerServer(t, nil, &calls)
	setupUploadHandler(t, server.URL)
	response := invokeUploadHandler(t, http.MethodPost, "/api/v1/files", `{"filename":"sample.bin","size_bytes":1,"owner_subject":"bob@example.com"}`, "application/json", "alice@example.com", "550e8400-e29b-41d4-a716-446655440000", NewHandler().CreateUpload)
	if response.Code != http.StatusBadRequest {
		t.Fatalf("status=%d body=%s, want bad request", response.Code, response.Body.String())
	}
	if calls != 0 {
		t.Fatalf("unknown browser authority reached Bot %d times", calls)
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
	response := invokeUploadHandler(t, http.MethodPost, "/api/v1/files", `{"filename":"sample.bin","size_bytes":1}`, "application/json", "", "550e8400-e29b-41d4-a716-446655440000", NewHandler().CreateUpload)
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
		response := invokeUploadHandler(t, http.MethodPost, "/api/v1/files", `{"filename":"sample.bin","size_bytes":1,"purpose":"document"}`, "application/json", user, "550e8400-e29b-41d4-a716-446655440000", NewHandler().CreateUpload)
		if response.Code != http.StatusOK {
			t.Fatalf("user %s status=%d body=%s", user, response.Code, response.Body.String())
		}
	}
	if len(captures) != 2 || captures[0].IdempotencyKey != captures[1].IdempotencyKey || captures[0].OwnerSubject == captures[1].OwnerSubject {
		t.Fatalf("idempotency owner scope=%#v", captures)
	}
}
