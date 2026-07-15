package middleware

import (
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"phytomni-server/common/i18n"

	"github.com/gin-gonic/gin"
)

type a2uiJSONGuardTestServer struct {
	downstreamCalls int
	finalCalls      int
	finalBody       []byte
	contentLength   int64
}

func newA2uiJSONGuardTestServer(t *testing.T) *a2uiJSONGuardTestServer {
	t.Helper()
	return &a2uiJSONGuardTestServer{}
}

func newA2uiJSONGuardEngine(state *a2uiJSONGuardTestServer) *gin.Engine {
	gin.SetMode(gin.TestMode)
	engine := gin.New()
	engine.Use(func(c *gin.Context) {
		c.Set("x-request-id", "guard-test-request")
		c.Next()
	})
	engine.Use(i18n.Localize())
	engine.POST(
		"/a2ui",
		A2uiJSONGuard(),
		func(c *gin.Context) {
			state.downstreamCalls++
			c.Next()
		},
		func(c *gin.Context) {
			state.finalCalls++
			state.finalBody, _ = io.ReadAll(c.Request.Body)
			state.contentLength = c.Request.ContentLength
			c.Status(http.StatusNoContent)
		},
	)
	return engine
}

type a2uiJSONGuardResponse struct {
	Error struct {
		Type      string `json:"type"`
		Code      string `json:"code"`
		Message   string `json:"message"`
		RequestID string `json:"request_id"`
	} `json:"error"`
	Forwarded bool `json:"forwarded"`
	Retryable bool `json:"retryable"`
}

func decodeA2uiJSONGuardResponse(t *testing.T, response *httptest.ResponseRecorder) a2uiJSONGuardResponse {
	t.Helper()
	var envelope a2uiJSONGuardResponse
	if err := json.Unmarshal(response.Body.Bytes(), &envelope); err != nil {
		t.Fatalf("decode response: %v; body=%q", err, response.Body.String())
	}
	return envelope
}

func assertA2uiJSONGuardError(t *testing.T, response *httptest.ResponseRecorder, status int, code, message string) {
	t.Helper()
	if response.Code != status {
		t.Fatalf("status = %d, want %d; body=%q", response.Code, status, response.Body.String())
	}
	envelope := decodeA2uiJSONGuardResponse(t, response)
	if envelope.Error.Type != "gateway_error" {
		t.Errorf("error.type = %q, want gateway_error", envelope.Error.Type)
	}
	if envelope.Error.Code != code {
		t.Errorf("error.code = %q, want %q", envelope.Error.Code, code)
	}
	if envelope.Error.Message != message {
		t.Errorf("error.message = %q, want localized copy %q", envelope.Error.Message, message)
	}
	if envelope.Error.RequestID == "" {
		t.Error("error.request_id is empty")
	}
	if envelope.Forwarded {
		t.Error("forwarded = true, want false")
	}
	if envelope.Retryable {
		t.Error("retryable = true, want false")
	}
}

func TestA2uiJSONGuard_AcceptsJSONMediaTypesAndRestoresBytes(t *testing.T) {
	tests := []struct {
		name        string
		contentType string
	}{
		{name: "json", contentType: "application/json"},
		{name: "vendor json", contentType: "application/vnd.phytomni+json"},
		{name: "case insensitive with charset", contentType: "APPLICATION/JSON; CHARSET=UTF-8"},
		{name: "vendor json with charset", contentType: "application/vnd.phytomni+json; charset=utf-8"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			server := newA2uiJSONGuardTestServer(t)
			body := []byte(`{"surface_id":"surface-1","widget":"confirm"}`)
			request := httptest.NewRequest(http.MethodPost, "/a2ui", bytes.NewReader(body))
			request.Header.Set("Content-Type", tt.contentType)
			response := httptest.NewRecorder()
			engine := newA2uiJSONGuardEngine(server)
			engine.ServeHTTP(response, request)

			if response.Code != http.StatusNoContent {
				t.Fatalf("status = %d, want 204; body=%q", response.Code, response.Body.String())
			}
			if server.downstreamCalls != 1 || server.finalCalls != 1 {
				t.Fatalf("downstream/final calls = %d/%d, want 1/1", server.downstreamCalls, server.finalCalls)
			}
			if !bytes.Equal(server.finalBody, body) {
				t.Fatalf("restored body = %q, want %q", server.finalBody, body)
			}
			if server.contentLength != int64(len(body)) {
				t.Fatalf("ContentLength = %d, want %d", server.contentLength, len(body))
			}
		})
	}
}

func TestA2uiJSONGuard_RejectsUnsupportedMediaTypes(t *testing.T) {
	tests := []struct {
		name        string
		contentType string
	}{
		{name: "missing", contentType: ""},
		{name: "malformed", contentType: "application/json; charset"},
		{name: "text", contentType: "text/plain"},
		{name: "form", contentType: "application/x-www-form-urlencoded"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			server := newA2uiJSONGuardTestServer(t)
			body := []byte(`{"secret":"must-not-echo"}`)
			request := httptest.NewRequest(http.MethodPost, "/a2ui", bytes.NewReader(body))
			if tt.contentType != "" {
				request.Header.Set("Content-Type", tt.contentType)
			}
			response := httptest.NewRecorder()
			engine := newA2uiJSONGuardEngine(server)
			engine.ServeHTTP(response, request)

			assertA2uiJSONGuardError(t, response, http.StatusUnsupportedMediaType, "a2ui_unsupported_media_type", "unsupported media type")
			if server.downstreamCalls != 0 || server.finalCalls != 0 {
				t.Fatalf("downstream/final calls = %d/%d, want 0/0", server.downstreamCalls, server.finalCalls)
			}
			if strings.Contains(response.Body.String(), "must-not-echo") {
				t.Fatal("rejection response echoed request bytes")
			}
		})
	}
}

func TestA2uiJSONGuard_ExactLimitIsAccepted(t *testing.T) {
	server := newA2uiJSONGuardTestServer(t)
	body := []byte(`"` + strings.Repeat("x", int(A2uiActionMaxRequestBytes)-2) + `"`)
	if int64(len(body)) != A2uiActionMaxRequestBytes {
		t.Fatalf("test body length = %d, want %d", len(body), A2uiActionMaxRequestBytes)
	}
	request := httptest.NewRequest(http.MethodPost, "/a2ui", bytes.NewReader(body))
	request.Header.Set("Content-Type", "application/json")
	response := httptest.NewRecorder()
	engine := newA2uiJSONGuardEngine(server)
	engine.ServeHTTP(response, request)

	if response.Code != http.StatusNoContent {
		t.Fatalf("status = %d, want 204; body=%q", response.Code, response.Body.String())
	}
	if !bytes.Equal(server.finalBody, body) {
		t.Fatal("exact-limit body was not restored exactly")
	}
	if server.contentLength != A2uiActionMaxRequestBytes {
		t.Fatalf("ContentLength = %d, want %d", server.contentLength, A2uiActionMaxRequestBytes)
	}
}

func TestA2uiJSONGuard_ChunkedBodyOverLimitIsRejected(t *testing.T) {
	server := newA2uiJSONGuardTestServer(t)
	marker := "must-not-echo"
	body := []byte(`"` + strings.Repeat("x", int(A2uiActionMaxRequestBytes)-1-len(marker)) + marker + `"`)
	if int64(len(body)) != A2uiActionMaxRequestBytes+1 {
		t.Fatalf("test body length = %d, want %d", len(body), A2uiActionMaxRequestBytes+1)
	}
	request := httptest.NewRequest(http.MethodPost, "/a2ui", &chunkReader{data: body, chunkSize: 7})
	request.Header.Set("Content-Type", "application/json")
	response := httptest.NewRecorder()
	engine := newA2uiJSONGuardEngine(server)
	engine.ServeHTTP(response, request)

	assertA2uiJSONGuardError(t, response, http.StatusRequestEntityTooLarge, "a2ui_request_too_large", "request body too large")
	if server.downstreamCalls != 0 || server.finalCalls != 0 {
		t.Fatalf("downstream/final calls = %d/%d, want 0/0", server.downstreamCalls, server.finalCalls)
	}
	if strings.Contains(response.Body.String(), marker) {
		t.Fatal("oversize rejection response echoed request bytes")
	}
}

func TestA2uiJSONGuard_RejectsMalformedEmptyAndReadErrorBodies(t *testing.T) {
	tests := []struct {
		name string
		body io.Reader
	}{
		{name: "malformed", body: strings.NewReader(`{"unterminated"`)},
		{name: "empty", body: strings.NewReader("")},
		{name: "read error", body: errorReader{err: io.ErrUnexpectedEOF}},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			server := newA2uiJSONGuardTestServer(t)
			request := httptest.NewRequest(http.MethodPost, "/a2ui", tt.body)
			request.Header.Set("Content-Type", "application/json")
			response := httptest.NewRecorder()
			engine := newA2uiJSONGuardEngine(server)
			engine.ServeHTTP(response, request)

			assertA2uiJSONGuardError(t, response, http.StatusBadRequest, "a2ui_invalid_json", "invalid JSON body")
			if server.downstreamCalls != 0 || server.finalCalls != 0 {
				t.Fatalf("downstream/final calls = %d/%d, want 0/0", server.downstreamCalls, server.finalCalls)
			}
		})
	}
}

type chunkReader struct {
	data      []byte
	chunkSize int
	position  int
}

func (r *chunkReader) Read(p []byte) (int, error) {
	if r.position >= len(r.data) {
		return 0, io.EOF
	}
	n := r.chunkSize
	if n > len(p) {
		n = len(p)
	}
	if remaining := len(r.data) - r.position; n > remaining {
		n = remaining
	}
	copy(p[:n], r.data[r.position:r.position+n])
	r.position += n
	return n, nil
}

type errorReader struct {
	err error
}

func (r errorReader) Read([]byte) (int, error) {
	return 0, r.err
}
