package bot

import (
	"context"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

func TestChatCompletionWithMetaReadsBotRequestID(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-Request-Id", "bot-req-7")
		w.Header().Set("Content-Type", "application/json")
		_, _ = io.WriteString(w, `{"id":"chatcmpl-1","run_id":"run-1","choices":[{"message":{"content":"ok"}}]}`)
	}))
	defer srv.Close()

	response, meta, err := newTestClient(srv.URL).ChatCompletionWithMeta(context.Background(), ChatCompletionRequest{})
	if err != nil || response == nil || response.RunID == nil || meta.BotRequestID != "bot-req-7" {
		t.Fatalf("response=%#v meta=%#v err=%v", response, meta, err)
	}
	if meta.StatusCode != http.StatusOK {
		t.Fatalf("status=%d, want %d", meta.StatusCode, http.StatusOK)
	}
}

func TestResponseMetaPrefersHeaderRequestIDForJSONErrors(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-Request-Id", "bot-header-id")
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		_, _ = io.WriteString(w, `{"error":{"message":"invalid","request_id":"body-id"}}`)
	}))
	defer srv.Close()

	response, meta, err := newTestClient(srv.URL).GetAgentsWithMeta(context.Background())
	if response == nil {
		t.Fatal("metadata method should return its decoded output slot")
	}
	if err == nil {
		t.Fatal("expected Bot 400 error")
	}
	if meta.StatusCode != http.StatusBadRequest || meta.BotRequestID != "bot-header-id" {
		t.Fatalf("meta=%#v, want status=%d request id bot-header-id", meta, http.StatusBadRequest)
	}
	var apiErr *APIError
	if !errors.As(err, &apiErr) {
		t.Fatalf("error=%T, want *APIError", err)
	}
	if apiErr.RequestID != "bot-header-id" {
		t.Fatalf("APIError request id=%q, want header id", apiErr.RequestID)
	}
}

func TestPostA2uiActionCapturesBotRequestID(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-Request-Id", "bot-action-5")
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusAccepted)
		_, _ = io.WriteString(w, `{"status":"accepted"}`)
	}))
	defer srv.Close()

	result, err := newTestClient(srv.URL).PostA2uiAction(context.Background(), "run-1", []byte(`{}`))
	if err != nil || result == nil || result.BotRequestID != "bot-action-5" {
		t.Fatalf("result=%#v err=%v", result, err)
	}
	if result.Status != http.StatusAccepted {
		t.Fatalf("status=%d, want %d", result.Status, http.StatusAccepted)
	}
}

func TestChatCompletionStreamWithMetaReadsSetupHeader(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-Request-Id", "bot-stream-9")
		w.Header().Set("Content-Type", "text/event-stream")
		_, _ = io.WriteString(w, "data: done\n\n")
	}))
	defer srv.Close()

	stream, meta, err := newTestClient(srv.URL).ChatCompletionStreamWithMeta(context.Background(), ChatCompletionRequest{})
	if err != nil || stream == nil || meta.BotRequestID != "bot-stream-9" {
		t.Fatalf("stream=%v meta=%#v err=%v", stream, meta, err)
	}
	defer stream.Close()
	if meta.StatusCode != http.StatusOK {
		t.Fatalf("status=%d, want %d", meta.StatusCode, http.StatusOK)
	}
	body, readErr := io.ReadAll(stream)
	if readErr != nil || string(body) != "data: done\n\n" {
		t.Fatalf("stream body=%q err=%v", body, readErr)
	}
}

func TestChatCompletionStreamWithMetaBodyDeadlineOnErrorReturnsTimeout(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-Request-Id", "bot-stream-timeout-10")
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		if flusher, ok := w.(http.Flusher); ok {
			flusher.Flush()
		}
		time.Sleep(200 * time.Millisecond)
		_, _ = io.WriteString(w, `{"error":{"message":"late"}}`)
	}))
	defer srv.Close()

	c := newTestClient(srv.URL)
	c.http = &http.Client{Timeout: 20 * time.Millisecond}
	stream, meta, err := c.ChatCompletionStreamWithMeta(context.Background(), ChatCompletionRequest{})
	if stream != nil {
		stream.Close()
	}
	if meta.StatusCode != http.StatusBadRequest || meta.BotRequestID != "bot-stream-timeout-10" {
		t.Fatalf("meta=%#v, want status=%d and request id", meta, http.StatusBadRequest)
	}
	if err == nil || !errors.Is(err, ErrBotTimeout) {
		t.Fatalf("err=%v, want wrapped ErrBotTimeout", err)
	}
}

func TestChatCompletionWithMetaDeadlineReturnsTimeout(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		time.Sleep(200 * time.Millisecond)
	}))
	defer srv.Close()

	c := newTestClient(srv.URL)
	c.http = &http.Client{Timeout: 20 * time.Millisecond}
	response, meta, err := c.ChatCompletionWithMeta(context.Background(), ChatCompletionRequest{})
	if response == nil || response.RunID != nil {
		t.Fatalf("response=%#v, want an undecoded response on timeout", response)
	}
	if meta != (ResponseMeta{}) {
		t.Fatalf("meta=%#v, want zero metadata without an HTTP response", meta)
	}
	if err == nil || !errors.Is(err, ErrBotTimeout) {
		t.Fatalf("err=%v, want wrapped ErrBotTimeout", err)
	}
}

func TestChatCompletionWithMetaBodyDeadlineReturnsTimeout(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		if flusher, ok := w.(http.Flusher); ok {
			flusher.Flush()
		}
		time.Sleep(200 * time.Millisecond)
		_, _ = io.WriteString(w, `{"id":"late"}`)
	}))
	defer srv.Close()

	c := newTestClient(srv.URL)
	c.http = &http.Client{Timeout: 20 * time.Millisecond}
	response, meta, err := c.ChatCompletionWithMeta(context.Background(), ChatCompletionRequest{})
	t.Logf("response=%#v meta=%#v err=%v", response, meta, err)
	if response == nil {
		t.Fatal("metadata method should return its output slot")
	}
	if meta.StatusCode != http.StatusOK {
		t.Fatalf("meta=%#v, want status=%d from received headers", meta, http.StatusOK)
	}
	if err == nil || !errors.Is(err, ErrBotTimeout) {
		t.Fatalf("err=%v, want wrapped ErrBotTimeout", err)
	}
}
