package bot

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
)

func uploadCreateFixture(serverURL string) (UploadCreateRequest, UploadCreateResponse) {
	return UploadCreateRequest{
			OwnerSubject:   "alice@example.com",
			Filename:       "sample.fastq.gz",
			SizeBytes:      9,
			ContentType:    "application/gzip",
			LastModified:   1722470400000,
			Purpose:        "chat_attachment",
			IdempotencyKey: uuid.NewString(),
		}, UploadCreateResponse{
			Protocol:            ResumableUploadProtocol,
			AssetID:             "file_test_abc",
			Status:              "uploading",
			PartSizeBytes:       4,
			PartCount:           3,
			MaxParallelParts:    4,
			UploadURL:           serverURL + "/v1/files/file_test_abc",
			Capability:          "opaque-capability",
			CapabilityExpiresAt: time.Now().Add(15 * time.Minute).UTC().Format(time.RFC3339),
			SessionExpiresAt:    time.Now().Add(7 * 24 * time.Hour).UTC().Format(time.RFC3339),
		}
}

func uploadCapabilityFixture(serverURL string) UploadCapabilityResponse {
	return UploadCapabilityResponse{
		Protocol:            ResumableUploadProtocol,
		AssetID:             "file_test_abc",
		Status:              "uploading",
		UploadURL:           serverURL + "/v1/files/file_test_abc",
		Capability:          "renewed-opaque-capability",
		CapabilityExpiresAt: time.Now().Add(15 * time.Minute).UTC().Format(time.RFC3339),
		SessionExpiresAt:    time.Now().Add(7 * 24 * time.Hour).UTC().Format(time.RFC3339),
	}
}

func TestCreateUploadUsesMetadataOnlyJSONAndFixedPurpose(t *testing.T) {
	var got UploadCreateRequest
	var rawBody string
	var srv *httptest.Server
	srv = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost || r.URL.Path != "/v1/files" {
			t.Errorf("request=%s %s, want POST /v1/files", r.Method, r.URL.Path)
		}
		if gotAuth := r.Header.Get("Authorization"); gotAuth != "Bearer ptm_test" {
			t.Errorf("Authorization=%q, want Bot app key", gotAuth)
		}
		if gotContentType := r.Header.Get("Content-Type"); gotContentType != "application/json" {
			t.Errorf("Content-Type=%q, want application/json", gotContentType)
		}
		body, err := io.ReadAll(r.Body)
		if err != nil {
			t.Errorf("read body: %v", err)
		}
		rawBody = string(body)
		if err := json.Unmarshal(body, &got); err != nil {
			t.Errorf("decode JSON body: %v", err)
		}
		_, response := uploadCreateFixture(srv.URL)
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(response)
	}))
	defer srv.Close()

	request, wantResponse := uploadCreateFixture(srv.URL)
	response, meta, err := newTestClient(srv.URL).CreateUpload(context.Background(), request)
	if err != nil {
		t.Fatalf("CreateUpload error: %v", err)
	}
	if response == nil || response.AssetID != wantResponse.AssetID || meta.StatusCode != http.StatusOK {
		t.Fatalf("response=%#v meta=%#v, want asset %q and 200", response, meta, wantResponse.AssetID)
	}
	if got.OwnerSubject != request.OwnerSubject || got.Filename != request.Filename || got.SizeBytes != request.SizeBytes || got.Purpose != "chat_attachment" || got.IdempotencyKey != request.IdempotencyKey {
		t.Fatalf("request=%#v, want owner and metadata from caller", got)
	}
	if strings.Contains(rawBody, "multipart/form-data") || strings.Contains(rawBody, "file_bytes") {
		t.Fatalf("create request contained file/multipart data: %q", rawBody)
	}
}

func TestRenewUploadCapabilityUsesOwnerJSONAndRejectsPathTampering(t *testing.T) {
	var calls int
	var got UploadCapabilityRenewRequest
	var srv *httptest.Server
	srv = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls++
		if r.Method != http.MethodPost || r.URL.Path != "/v1/files/file_test_abc/capability" {
			t.Errorf("request=%s %s, want capability renewal path", r.Method, r.URL.Path)
		}
		if err := json.NewDecoder(r.Body).Decode(&got); err != nil {
			t.Errorf("decode renewal body: %v", err)
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(uploadCapabilityFixture(srv.URL))
	}))
	defer srv.Close()

	response, meta, err := newTestClient(srv.URL).RenewUploadCapability(context.Background(), "file_test_abc", "alice@example.com")
	if err != nil {
		t.Fatalf("RenewUploadCapability error: %v", err)
	}
	if response == nil || response.AssetID != "file_test_abc" || meta.StatusCode != http.StatusOK {
		t.Fatalf("response=%#v meta=%#v", response, meta)
	}
	if got.OwnerSubject != "alice@example.com" {
		t.Fatalf("owner subject=%q, want server-derived owner", got.OwnerSubject)
	}
	callsBeforeTampered := calls
	if response, _, err := newTestClient(srv.URL).RenewUploadCapability(context.Background(), "file_../secret", "alice@example.com"); err == nil || response != nil {
		t.Fatalf("tampered asset path was accepted: response=%#v err=%v", response, err)
	}
	if calls != callsBeforeTampered {
		t.Fatal("path-tampered asset must be rejected before an HTTP request")
	}
}

func TestUploadControlRejectsMalformedResponses(t *testing.T) {
	tests := []struct {
		name   string
		mutate func(*UploadCreateResponse)
	}{
		{name: "wrong protocol", mutate: func(response *UploadCreateResponse) { response.Protocol = "legacy" }},
		{name: "invalid state", mutate: func(response *UploadCreateResponse) { response.Status = "completed" }},
		{name: "impossible part plan", mutate: func(response *UploadCreateResponse) { response.PartCount = 4 }},
		{name: "malformed timestamp", mutate: func(response *UploadCreateResponse) { response.CapabilityExpiresAt = "tomorrow" }},
		{name: "missing capability", mutate: func(response *UploadCreateResponse) { response.Capability = "" }},
		{name: "asset URL mismatch", mutate: func(response *UploadCreateResponse) {
			response.UploadURL = "https://upload.example/v1/files/file_other"
		}},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			var srv *httptest.Server
			srv = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				request, response := uploadCreateFixture(srv.URL)
				tt.mutate(&response)
				_ = request
				w.Header().Set("Content-Type", "application/json")
				_ = json.NewEncoder(w).Encode(response)
			}))
			defer srv.Close()
			request, _ := uploadCreateFixture(srv.URL)
			response, _, err := newTestClient(srv.URL).CreateUpload(context.Background(), request)
			if err == nil || response != nil {
				t.Fatalf("malformed response accepted: response=%#v err=%v", response, err)
			}
		})
	}
}

func TestCreateUploadRejectsDuplicateResponseKeys(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = io.WriteString(w, `{"protocol":"obs-multipart-v2","protocol":"legacy"}`)
	}))
	defer srv.Close()
	request, _ := uploadCreateFixture(srv.URL)
	response, _, err := newTestClient(srv.URL).CreateUpload(context.Background(), request)
	if response != nil || !errors.Is(err, errDuplicateJSONKey) {
		t.Fatalf("duplicate response keys accepted: response=%#v err=%v", response, err)
	}
}

func TestCreateUploadPreservesBotRequestIDOnClientError(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-Request-Id", "bot-upload-control-7")
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusTooManyRequests)
		_, _ = io.WriteString(w, `{"error":{"message":"upload rate limited","request_id":"body-id"}}`)
	}))
	defer srv.Close()
	request, _ := uploadCreateFixture(srv.URL)
	response, meta, err := newTestClient(srv.URL).CreateUpload(context.Background(), request)
	if response != nil || err == nil || meta.StatusCode != http.StatusTooManyRequests || meta.BotRequestID != "bot-upload-control-7" {
		t.Fatalf("response=%#v meta=%#v err=%v", response, meta, err)
	}
	var apiErr *APIError
	if !errors.As(err, &apiErr) || apiErr.RequestID != "bot-upload-control-7" {
		t.Fatalf("error=%T %#v, want header request id", err, err)
	}
}

func TestUploadControlRejectsInvalidCreateMetadata(t *testing.T) {
	request, _ := uploadCreateFixture("https://upload.example")
	for name, mutate := range map[string]func(*UploadCreateRequest){
		"empty owner": func(request *UploadCreateRequest) { request.OwnerSubject = "" },
		"zero size":   func(request *UploadCreateRequest) { request.SizeBytes = 0 },
		"too large":   func(request *UploadCreateRequest) { request.SizeBytes = maxResumableUploadFileBytes + 1 },
		"wrong purpose": func(request *UploadCreateRequest) {
			request.Purpose = "assistants"
		},
		"bad idempotency": func(request *UploadCreateRequest) { request.IdempotencyKey = "not-a-uuid" },
	} {
		t.Run(name, func(t *testing.T) {
			invalid := request
			mutate(&invalid)
			response, _, err := newTestClient("https://upload.example").CreateUpload(context.Background(), invalid)
			if response != nil || err == nil {
				t.Fatalf("invalid metadata accepted: response=%#v err=%v", response, err)
			}
		})
	}
}
