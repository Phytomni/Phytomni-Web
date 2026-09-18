package bot

import (
	"context"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestListObsKeysSendsPrefixAndAuth(t *testing.T) {
	var gotPrefix, gotAuth, gotPath string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotPath = r.URL.Path
		gotPrefix = r.URL.Query().Get("prefix")
		gotAuth = r.Header.Get("Authorization")
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"keys":["agent_data/user_data/web/runs/r1/out.zip","agent_data/user_data/web/runs/r1/p.png"]}`))
	}))
	defer srv.Close()

	keys, err := newTestClient(srv.URL).ListObsKeys(context.Background(), "/obs/phytomni/agent_data/user_data/web/runs/r1/")
	if err != nil {
		t.Fatalf("ListObsKeys error: %v", err)
	}
	if gotPath != "/v1/relay/obs/list" {
		t.Errorf("path = %q, want /v1/relay/obs/list", gotPath)
	}
	if gotPrefix != "/obs/phytomni/agent_data/user_data/web/runs/r1/" {
		t.Errorf("prefix = %q", gotPrefix)
	}
	if gotAuth != "Bearer ptm_test" {
		t.Errorf("Authorization = %q, want Bearer ptm_test", gotAuth)
	}
	if len(keys) != 2 || keys[0] != "agent_data/user_data/web/runs/r1/out.zip" {
		t.Errorf("keys = %v", keys)
	}
}

func TestGetObsObjectStreamRoundTrip(t *testing.T) {
	var gotObjPath, gotAuth string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotObjPath = r.URL.Query().Get("path")
		gotAuth = r.Header.Get("Authorization")
		w.Header().Set("Content-Type", "application/octet-stream")
		_, _ = w.Write([]byte("zip-bytes"))
	}))
	defer srv.Close()

	rc, n, err := newTestClient(srv.URL).GetObsObjectStream(context.Background(), "agent_data/user_data/web/runs/r1/out.zip")
	if err != nil {
		t.Fatalf("GetObsObjectStream error: %v", err)
	}
	defer rc.Close()
	body, _ := io.ReadAll(rc)
	if string(body) != "zip-bytes" {
		t.Errorf("body = %q, want zip-bytes", body)
	}
	if n != int64(len("zip-bytes")) {
		t.Errorf("content length = %d, want %d", n, len("zip-bytes"))
	}
	if gotObjPath != "agent_data/user_data/web/runs/r1/out.zip" {
		t.Errorf("path = %q", gotObjPath)
	}
	if gotAuth != "Bearer ptm_test" {
		t.Errorf("Authorization = %q", gotAuth)
	}
}

func TestGetObsObjectStreamErrorEnvelope(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusForbidden)
		_, _ = w.Write([]byte(`{"error":{"message":"list prefix outside the output root"}}`))
	}))
	defer srv.Close()

	_, _, err := newTestClient(srv.URL).GetObsObjectStream(context.Background(), "legacy/old-bucket/r.zip")
	if err == nil {
		t.Fatal("want error on 403")
	}
	if !IsLegacyPathErr(err) {
		t.Errorf("403 should classify as legacy-path error, got %v", err)
	}
}

type obsRelayTestTransport func(*http.Request) (*http.Response, error)

func (transport obsRelayTestTransport) RoundTrip(req *http.Request) (*http.Response, error) {
	return transport(req)
}

type obsRelayTrackedBody struct {
	io.Reader
	bytesRead int
	closes    int
}

func (body *obsRelayTrackedBody) Read(p []byte) (int, error) {
	n, err := body.Reader.Read(p)
	body.bytesRead += n
	return n, err
}

func (body *obsRelayTrackedBody) Close() error {
	body.closes++
	return nil
}

func obsRelayBodyClient(body io.ReadCloser, status int, length int64) *Client {
	return &Client{
		baseURL: "https://relay.example.invalid",
		http: &http.Client{Transport: obsRelayTestTransport(func(req *http.Request) (*http.Response, error) {
			return &http.Response{
				StatusCode: status, Body: body, ContentLength: length,
				Header: make(http.Header), Request: req,
			}, nil
		})},
	}
}

func TestGetObsObjectStreamBoundsErrorBodies(t *testing.T) {
	const oversizedBytes = 9 << 20
	for _, knownLength := range []bool{false, true} {
		name, length := "unknown length", int64(-1)
		if knownLength {
			name, length = "known length", oversizedBytes
		}
		t.Run(name, func(t *testing.T) {
			body := &obsRelayTrackedBody{Reader: strings.NewReader(strings.Repeat("x", oversizedBytes))}
			reader, size, err := obsRelayBodyClient(body, http.StatusBadGateway, length).
				GetObsObjectStream(context.Background(), "gene-examples/img/Os01/Os01_tree.png")
			var upstream *APIError
			if reader != nil || size != 0 || !errors.As(err, &upstream) || upstream.Status != http.StatusBadGateway {
				t.Fatalf("error response lost status or published bytes: size=%d err=%v", size, err)
			}
			if body.closes != 1 {
				t.Errorf("error body closes=%d, want 1", body.closes)
			}
			if body.bytesRead != 64<<10 {
				t.Errorf("error body read=%d bytes, want exactly 65536 bounded bytes", body.bytesRead)
			}
			if upstream.Message != "" || upstream.Error() != "bot request failed: status 502" {
				t.Fatal("oversized non-JSON body must retain only safe status metadata")
			}
		})
	}
}

func TestGetObsObjectStreamBoundedErrorPreservesEnvelope(t *testing.T) {
	const uniform = `{"error":{"code":"resource_not_found","message":"Unavailable","request_id":"request-test","stage":"read","retryable":true}}`
	for name, raw := range map[string]string{
		"uniform":     uniform,
		"exact limit": uniform + strings.Repeat(" ", (64<<10)-len(uniform)),
		"legacy":      `{"error":{"message":"Unavailable","request_id":"request-test"}}`,
	} {
		t.Run(name, func(t *testing.T) {
			body := &obsRelayTrackedBody{Reader: strings.NewReader(raw)}
			_, _, err := obsRelayBodyClient(body, http.StatusNotFound, int64(len(raw))).
				GetObsObjectStream(context.Background(), "gene-examples/md/Os01_result.md")
			var upstream *APIError
			if !errors.As(err, &upstream) || upstream.Status != 404 || upstream.Message != "Unavailable" || upstream.RequestID != "request-test" {
				t.Fatalf("bounded envelope changed: %v", err)
			}
			if name != "legacy" && (upstream.Code != "resource_not_found" || upstream.Stage != "read" || !upstream.Retryable) {
				t.Fatal("uniform error metadata changed")
			}
			if body.closes != 1 || body.bytesRead != len(raw) {
				t.Fatalf("bounded body lifecycle: read=%d closes=%d", body.bytesRead, body.closes)
			}
		})
	}
}

type obsRelayCancelReader struct{ cancel context.CancelFunc }

func (reader obsRelayCancelReader) Read([]byte) (int, error) {
	reader.cancel()
	return 0, context.Canceled
}

func TestGetObsObjectStreamErrorBodyCancellationClosesBody(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	body := &obsRelayTrackedBody{Reader: obsRelayCancelReader{cancel: cancel}}
	reader, size, err := obsRelayBodyClient(body, http.StatusBadGateway, -1).
		GetObsObjectStream(ctx, "gene-examples/md/Os01_result.md")
	if reader != nil || size != 0 || !errors.Is(err, context.Canceled) || body.closes != 1 {
		t.Fatalf("cancellation lost or body left open: size=%d err=%v closes=%d", size, err, body.closes)
	}
}

func TestGetObsObjectStreamSuccessKeepsCallerOwnedUnboundedStream(t *testing.T) {
	const size = 9 << 20
	body := &obsRelayTrackedBody{Reader: strings.NewReader(strings.Repeat("x", size))}
	reader, length, err := obsRelayBodyClient(body, http.StatusOK, size).
		GetObsObjectStream(context.Background(), "gene-examples/img/Os01/Os01_tree.png")
	if err != nil || length != size || reader == nil || body.closes != 0 || body.bytesRead != 0 {
		t.Fatalf("successful stream ownership changed: length=%d err=%v", length, err)
	}
	defer reader.Close()
	n, err := io.Copy(io.Discard, reader)
	if err != nil || n != size {
		t.Fatalf("error-only limit truncated a successful stream: bytes=%d err=%v", n, err)
	}
}

func TestIsLegacyPathErr(t *testing.T) {
	if !IsLegacyPathErr(&APIError{Status: http.StatusBadRequest}) {
		t.Error("400 should be legacy-path")
	}
	if !IsLegacyPathErr(&APIError{Status: http.StatusForbidden}) {
		t.Error("403 should be legacy-path")
	}
	if IsLegacyPathErr(&APIError{Status: http.StatusNotFound}) {
		t.Error("404 should NOT be legacy-path (relay disabled is an ops error)")
	}
	if IsLegacyPathErr(io.EOF) {
		t.Error("non-APIError should not be legacy-path")
	}
}
