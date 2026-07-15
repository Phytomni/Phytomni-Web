package bot

import (
	"bytes"
	"context"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"
	"time"
)

func a2uiResponseServer(t *testing.T, body []byte, setContentLength bool) *httptest.Server {
	t.Helper()
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		if setContentLength {
			w.Header().Set("Content-Length", strconv.Itoa(len(body)))
		} else if flusher, ok := w.(http.Flusher); ok {
			// Flush headers before writing the body so the client receives an
			// unknown Content-Length and must enforce the streaming read bound.
			flusher.Flush()
		}
		_, _ = w.Write(body)
	}))
}

func TestPostA2uiAction_ForwardsRawBodyAndAuth(t *testing.T) {
	var gotPath, gotAuth, gotCT string
	var gotBody []byte
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotPath = r.URL.Path
		gotAuth = r.Header.Get("Authorization")
		gotCT = r.Header.Get("Content-Type")
		gotBody, _ = io.ReadAll(r.Body)
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"ok":true}`))
	}))
	defer srv.Close()

	raw := []byte(`{"surface_id":"s1","widget":"confirm","action_id":"a1","run_id":"run-1","payload":{"accepted":true}}`)
	res, err := newTestClient(srv.URL).PostA2uiAction(context.Background(), "run-1", raw)
	if err != nil {
		t.Fatalf("PostA2uiAction: %v", err)
	}
	if gotPath != "/v1/runs/run-1/a2ui-actions" {
		t.Fatalf("path = %q", gotPath)
	}
	if gotAuth != "Bearer ptm_test" {
		t.Fatalf("auth = %q", gotAuth)
	}
	if !strings.HasPrefix(gotCT, "application/json") {
		t.Fatalf("content-type = %q", gotCT)
	}
	if string(gotBody) != string(raw) {
		t.Fatalf("body mutated: %s", gotBody)
	}
	if res.Status != 200 || string(res.Body) != `{"ok":true}` {
		t.Fatalf("result = %+v", res)
	}
}

func TestPostA2uiAction_ReturnsBot4xxAsResult(t *testing.T) {
	body := []byte(`{"status":409,"error":{"type":"conflict","code":409,"message":"surface_id mismatch"}}`)
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusConflict)
		_, _ = w.Write(body)
	}))
	defer srv.Close()

	res, err := newTestClient(srv.URL).PostA2uiAction(context.Background(), "run-1", []byte(`{}`))
	if err != nil {
		t.Fatalf("4xx must not be transport err: %v", err)
	}
	if res.Status != 409 || string(res.Body) != string(body) {
		t.Fatalf("got status=%d body=%s", res.Status, res.Body)
	}
}

func TestPostA2uiAction_AcceptsExactResponseLimit(t *testing.T) {
	body := bytes.Repeat([]byte("a"), int(A2uiActionMaxResponseBytes))
	srv := a2uiResponseServer(t, body, true)
	defer srv.Close()

	res, err := newTestClient(srv.URL).PostA2uiAction(context.Background(), "run-1", []byte(`{}`))
	if err != nil {
		t.Fatalf("exact response limit must succeed: %v", err)
	}
	if res == nil {
		t.Fatal("exact response limit returned nil result")
	}
	if len(res.Body) != len(body) {
		t.Fatalf("result body length = %d, want %d", len(res.Body), len(body))
	}
}

func TestPostA2uiAction_RejectsOversizeResponseWithoutPartialResult(t *testing.T) {
	body := bytes.Repeat([]byte("a"), int(A2uiActionMaxResponseBytes)+1)
	srv := a2uiResponseServer(t, body, true)
	defer srv.Close()

	res, err := newTestClient(srv.URL).PostA2uiAction(context.Background(), "run-1", []byte(`{}`))
	if !errors.Is(err, ErrA2uiResponseTooLarge) {
		t.Fatalf("oversize response error = %v, want ErrA2uiResponseTooLarge", err)
	}
	if res != nil {
		t.Fatalf("oversize response returned partial result: %+v", res)
	}
}

func TestPostA2uiAction_RejectsOversizeUnknownContentLength(t *testing.T) {
	body := bytes.Repeat([]byte("a"), int(A2uiActionMaxResponseBytes)+1)
	srv := a2uiResponseServer(t, body, false)
	defer srv.Close()

	res, err := newTestClient(srv.URL).PostA2uiAction(context.Background(), "run-1", []byte(`{}`))
	if !errors.Is(err, ErrA2uiResponseTooLarge) {
		t.Fatalf("unknown Content-Length error = %v, want ErrA2uiResponseTooLarge", err)
	}
	if res != nil {
		t.Fatalf("unknown Content-Length returned partial result: %+v", res)
	}
}

func TestPostA2uiAction_Timeout(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		time.Sleep(200 * time.Millisecond)
	}))
	defer srv.Close()

	c := newTestClient(srv.URL)
	c.http = &http.Client{Timeout: 20 * time.Millisecond}
	_, err := c.PostA2uiAction(context.Background(), "run-1", []byte(`{}`))
	if err == nil || !errors.Is(err, ErrBotTimeout) {
		t.Fatalf("err = %v, want ErrBotTimeout", err)
	}
}
