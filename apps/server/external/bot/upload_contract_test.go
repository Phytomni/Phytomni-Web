package bot

import (
	"bytes"
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

func uploadAbortFixture() UploadAbortResponse {
	return UploadAbortResponse{
		Protocol: ResumableUploadProtocol,
		AssetID:  "file_test_abc",
		Status:   "aborted",
	}
}

func TestAbortUploadUsesCapabilityAgainstConfiguredBaseURL(t *testing.T) {
	const capability = "opaque-abort-capability"
	var calls int
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls++
		if r.Method != http.MethodDelete || r.URL.Path != "/v1/files/file_test_abc" {
			t.Errorf("request=%s %s, want DELETE /v1/files/file_test_abc", r.Method, r.URL.Path)
		}
		if r.URL.RawQuery != "" {
			t.Errorf("query=%q, want empty", r.URL.RawQuery)
		}
		if got := r.Header.Values("Authorization"); len(got) != 1 || got[0] != "Bearer "+capability {
			t.Errorf("Authorization=%q, want exactly one capability header", got)
		}
		for name, values := range r.Header {
			for _, value := range values {
				if strings.Contains(value, "ptm_test") {
					t.Errorf("header %q exposed service key", name)
				}
			}
		}
		body, err := io.ReadAll(r.Body)
		if err != nil {
			t.Errorf("read body: %v", err)
		}
		if len(body) != 0 {
			t.Errorf("body=%q, want empty", body)
		}
		if got := r.Header.Get("Content-Type"); got != "" {
			t.Errorf("Content-Type=%q, want absent", got)
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(uploadAbortFixture())
	}))
	defer srv.Close()

	response, meta, err := newTestClient(srv.URL).AbortUpload(
		context.Background(), "file_test_abc", capability,
	)
	if err != nil {
		t.Fatalf("AbortUpload error: %v", err)
	}
	if response == nil || *response != uploadAbortFixture() {
		t.Fatalf("response=%#v, want %#v", response, uploadAbortFixture())
	}
	if meta.StatusCode != http.StatusOK || calls != 1 {
		t.Fatalf("meta=%#v calls=%d, want 200 and one call", meta, calls)
	}
}

func TestAbortUploadIgnoresHostileCreateUploadURL(t *testing.T) {
	var trustedCalls, hostileCalls int
	hostile := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		hostileCalls++
		http.Error(w, "must not be called", http.StatusInternalServerError)
	}))
	defer hostile.Close()
	trusted := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		trustedCalls++
		_ = json.NewEncoder(w).Encode(uploadAbortFixture())
	}))
	defer trusted.Close()

	_, hostileCreateResponse := uploadCreateFixture(hostile.URL)
	if hostileCreateResponse.UploadURL != hostile.URL+"/v1/files/file_test_abc" {
		t.Fatalf("hostile test fixture URL=%q", hostileCreateResponse.UploadURL)
	}
	response, _, err := newTestClient(trusted.URL).AbortUpload(
		context.Background(), hostileCreateResponse.AssetID, hostileCreateResponse.Capability,
	)
	if err != nil || response == nil {
		t.Fatalf("AbortUpload response=%#v err=%v", response, err)
	}
	if trustedCalls != 1 || hostileCalls != 0 {
		t.Fatalf("trusted calls=%d hostile calls=%d, want 1 and 0", trustedCalls, hostileCalls)
	}
}

func TestAbortUploadRejectsInvalidInputsBeforeNetwork(t *testing.T) {
	var calls int
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls++
		_ = json.NewEncoder(w).Encode(uploadAbortFixture())
	}))
	defer srv.Close()
	client := newTestClient(srv.URL)

	tests := []struct {
		name       string
		assetID    string
		capability string
	}{
		{name: "empty asset", assetID: "", capability: "opaque-capability"},
		{name: "empty asset suffix", assetID: "file_", capability: "opaque-capability"},
		{name: "path traversal", assetID: "file_../secret", capability: "opaque-capability"},
		{name: "oversized asset", assetID: "file_" + strings.Repeat("a", 124), capability: "opaque-capability"},
		{name: "unicode asset", assetID: "file_ä", capability: "opaque-capability"},
		{name: "empty capability", assetID: "file_test_abc", capability: ""},
		{name: "space capability", assetID: "file_test_abc", capability: "opaque capability"},
		{name: "newline capability", assetID: "file_test_abc", capability: "opaque\ncapability"},
		{name: "delete capability", assetID: "file_test_abc", capability: "opaque\x7fcapability"},
		{name: "invalid UTF-8 capability", assetID: "file_test_abc", capability: string([]byte{0xff})},
		{name: "oversized capability", assetID: "file_test_abc", capability: strings.Repeat("a", maxUploadCapabilityBytes+1)},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			response, meta, err := client.AbortUpload(context.Background(), tt.assetID, tt.capability)
			if response != nil || err == nil || meta != (ResponseMeta{}) {
				t.Fatalf("response=%#v meta=%#v err=%v, want local rejection", response, meta, err)
			}
		})
	}
	if calls != 0 {
		t.Fatalf("network calls=%d, want zero", calls)
	}
}

func TestAbortUploadBoundsResponseBody(t *testing.T) {
	const maxAbortBodyBytes = 16 << 10
	valid, err := json.Marshal(uploadAbortFixture())
	if err != nil {
		t.Fatalf("marshal fixture: %v", err)
	}
	for _, tt := range []struct {
		name    string
		size    int
		wantErr bool
	}{
		{name: "exact limit", size: maxAbortBodyBytes},
		{name: "one byte overflow", size: maxAbortBodyBytes + 1, wantErr: true},
	} {
		t.Run(tt.name, func(t *testing.T) {
			body := append(append([]byte(nil), valid...), bytes.Repeat([]byte(" "), tt.size-len(valid))...)
			srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				_, _ = w.Write(body)
			}))
			defer srv.Close()

			response, _, err := newTestClient(srv.URL).AbortUpload(
				context.Background(), "file_test_abc", "opaque-capability",
			)
			if tt.wantErr {
				if response != nil || err == nil {
					t.Fatalf("overflow accepted: response=%#v err=%v", response, err)
				}
				return
			}
			if response == nil || err != nil {
				t.Fatalf("bounded response rejected: response=%#v err=%v", response, err)
			}
		})
	}
}

func TestAbortUploadRejectsDuplicateResponseKeys(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = io.WriteString(w, `{"protocol":"obs-multipart-v2","asset_id":"file_test_abc","asset_id":"file_other","status":"aborted"}`)
	}))
	defer srv.Close()

	response, _, err := newTestClient(srv.URL).AbortUpload(
		context.Background(), "file_test_abc", "opaque-capability",
	)
	if response != nil || !errors.Is(err, errDuplicateJSONKey) {
		t.Fatalf("duplicate response keys accepted: response=%#v err=%v", response, err)
	}
}

func TestAbortUploadRejectsInvalidResponseIdentity(t *testing.T) {
	for _, tt := range []struct {
		name   string
		mutate func(*UploadAbortResponse)
	}{
		{name: "wrong protocol", mutate: func(response *UploadAbortResponse) { response.Protocol = "legacy" }},
		{name: "wrong asset", mutate: func(response *UploadAbortResponse) { response.AssetID = "file_other" }},
		{name: "wrong status", mutate: func(response *UploadAbortResponse) { response.Status = "uploading" }},
	} {
		t.Run(tt.name, func(t *testing.T) {
			responseBody := uploadAbortFixture()
			tt.mutate(&responseBody)
			srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				_ = json.NewEncoder(w).Encode(responseBody)
			}))
			defer srv.Close()

			response, _, err := newTestClient(srv.URL).AbortUpload(
				context.Background(), "file_test_abc", "opaque-capability",
			)
			if response != nil || err == nil {
				t.Fatalf("invalid response accepted: response=%#v err=%v", response, err)
			}
		})
	}
}

func TestAbortUploadRejectsMalformedJSON(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = io.WriteString(w, `{"protocol":`)
	}))
	defer srv.Close()

	response, _, err := newTestClient(srv.URL).AbortUpload(
		context.Background(), "file_test_abc", "opaque-capability",
	)
	if response != nil || err == nil {
		t.Fatalf("malformed JSON accepted: response=%#v err=%v", response, err)
	}
}

func TestAbortUploadRejectsNon2xxWithoutLeakingCapabilityOrBody(t *testing.T) {
	const capability = "opaque-secret-abort-capability"
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-Request-Id", "bot-abort-7")
		w.WriteHeader(http.StatusForbidden)
		_, _ = io.WriteString(w, `{"error":"`+capability+`","private":"raw-response-detail"}`)
	}))
	defer srv.Close()

	response, meta, err := newTestClient(srv.URL).AbortUpload(
		context.Background(), "file_test_abc", capability,
	)
	if response != nil || err == nil {
		t.Fatalf("non-2xx accepted: response=%#v err=%v", response, err)
	}
	if meta.StatusCode != http.StatusForbidden || meta.BotRequestID != "bot-abort-7" {
		t.Fatalf("meta=%#v, want safe status and request id", meta)
	}
	message := err.Error()
	for _, forbidden := range []string{capability, "raw-response-detail"} {
		if strings.Contains(message, forbidden) {
			t.Fatalf("error leaked %q: %q", forbidden, message)
		}
	}
}

func TestCreateUploadUsesMetadataOnlyJSONAndPurpose(t *testing.T) {
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
		var fields map[string]json.RawMessage
		if err := json.Unmarshal(body, &fields); err != nil {
			t.Errorf("decode JSON fields: %v", err)
		}
		for _, forbidden := range []string{"body", "file_bytes", "bucket", "object_key", "upload_id", "storage_path", "path"} {
			if _, exists := fields[forbidden]; exists {
				t.Errorf("create request exposed forbidden storage field %q", forbidden)
			}
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
	if got.OwnerSubject != request.OwnerSubject || got.Filename != request.Filename || got.SizeBytes != request.SizeBytes || got.Purpose != request.Purpose || got.IdempotencyKey != request.IdempotencyKey {
		t.Fatalf("request=%#v, want owner and metadata from caller", got)
	}
	if strings.Contains(rawBody, "multipart/form-data") || strings.Contains(rawBody, "file_bytes") {
		t.Fatalf("create request contained file/multipart data: %q", rawBody)
	}
}

func TestUploadControlAcceptsTrustedCreatePurposes(t *testing.T) {
	request, _ := uploadCreateFixture("https://upload.example")
	for _, purpose := range []string{"dataset", "document", "chat_attachment"} {
		t.Run(purpose, func(t *testing.T) {
			request := request
			request.Purpose = purpose
			if err := validateUploadCreateRequest(request); err != nil {
				t.Fatalf("purpose %q rejected: %v", purpose, err)
			}
		})
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

func TestRenewUploadCapabilityRejectsMalformedResponses(t *testing.T) {
	tests := []struct {
		name   string
		mutate func(*UploadCapabilityResponse)
	}{
		{name: "wrong protocol", mutate: func(response *UploadCapabilityResponse) { response.Protocol = "legacy" }},
		{name: "invalid state", mutate: func(response *UploadCapabilityResponse) { response.Status = "aborted" }},
		{name: "asset mismatch", mutate: func(response *UploadCapabilityResponse) { response.AssetID = "file_other" }},
		{name: "asset URL mismatch", mutate: func(response *UploadCapabilityResponse) {
			response.UploadURL = "https://upload.example/v1/files/file_other"
		}},
		{name: "malformed timestamp", mutate: func(response *UploadCapabilityResponse) {
			response.CapabilityExpiresAt = "tomorrow"
		}},
		{name: "missing capability", mutate: func(response *UploadCapabilityResponse) {
			response.Capability = ""
		}},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			var srv *httptest.Server
			srv = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				response := uploadCapabilityFixture(srv.URL)
				tt.mutate(&response)
				w.Header().Set("Content-Type", "application/json")
				_ = json.NewEncoder(w).Encode(response)
			}))
			defer srv.Close()

			response, _, err := newTestClient(srv.URL).RenewUploadCapability(
				context.Background(), "file_test_abc", "alice@example.com",
			)
			if err == nil || response != nil {
				t.Fatalf("malformed renewal response accepted: response=%#v err=%v", response, err)
			}
		})
	}
}

func TestRenewUploadCapabilityRejectsDuplicateResponseKeys(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = io.WriteString(w, `{"protocol":"obs-multipart-v2","protocol":"legacy"}`)
	}))
	defer srv.Close()

	response, _, err := newTestClient(srv.URL).RenewUploadCapability(
		context.Background(), "file_test_abc", "alice@example.com",
	)
	if response != nil || !errors.Is(err, errDuplicateJSONKey) {
		t.Fatalf("duplicate renewal response keys accepted: response=%#v err=%v", response, err)
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
