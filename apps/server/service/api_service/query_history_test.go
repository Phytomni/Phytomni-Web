package api_service

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strings"
	"testing"

	rxBot "phytomni-server/external/bot"
)

func TestParseHistoryRejectsMalformedJSON(t *testing.T) {
	if got := parseHistory(`[{"role":"user"`); got != nil {
		t.Fatalf("malformed history = %#v, want nil", got)
	}
}

func TestParseHistoryDropsOversizedContent(t *testing.T) {
	raw, err := json.Marshal([]rxBot.ChatMessage{
		{Role: "user", Content: strings.Repeat("x", 32*1024+1)},
		{Role: "assistant", Content: "bounded"},
	})
	if err != nil {
		t.Fatalf("marshal history: %v", err)
	}

	want := []rxBot.ChatMessage{{Role: "assistant", Content: "bounded"}}
	if got := parseHistory(string(raw)); !reflect.DeepEqual(got, want) {
		t.Fatalf("bounded history = %#v, want %#v", got, want)
	}
}

func TestParseHistoryBoundsRolesAndContent(t *testing.T) {
	input := make([]map[string]string, 0, 25)
	input = append(input, map[string]string{"role": "system", "content": "untrusted system role"})
	for i := 0; i < 24; i++ {
		role := "user"
		if i%2 == 1 {
			role = "assistant"
		}
		input = append(input, map[string]string{"role": role, "content": fmt.Sprintf("turn-%02d", i)})
	}
	raw, err := json.Marshal(input)
	if err != nil {
		t.Fatalf("marshal history: %v", err)
	}

	got := parseHistory(string(raw))
	if len(got) != 20 {
		t.Fatalf("history length = %d, want 20", len(got))
	}
	for _, message := range got {
		if message.Role != "user" && message.Role != "assistant" {
			t.Fatalf("untrusted history role survived: %#v", message)
		}
		if message.Content == "" {
			t.Fatal("empty history content survived")
		}
	}
	if got[len(got)-1].Content != "turn-23" {
		t.Fatalf("history tail = %q, want turn-23", got[len(got)-1].Content)
	}
}

func TestQueryForwardsBoundedHistoryBeforeCurrentTurn(t *testing.T) {
	setupExpertTestDB(t)
	var captured rxBot.ChatCompletionRequest
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if err := json.NewDecoder(r.Body).Decode(&captured); err != nil {
			t.Errorf("decode chat request: %v", err)
			w.WriteHeader(http.StatusBadRequest)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"id":"c-history","run_id":"run-history","choices":[{"message":{"role":"assistant","content":"answer"}}]}`))
	}))
	t.Cleanup(srv.Close)
	rxBot.BotConfig = &rxBot.Config{BaseURL: srv.URL, ProxyEnabled: true, TimeoutSeconds: 5}
	t.Cleanup(func() { rxBot.BotConfig = nil })

	history := `[{"role":"user","content":"first"},{"role":"assistant","content":"prior answer"}]`
	_, err := NewService().Query(context.Background(), "alice", QueryInput{
		Query: "follow up", History: history, Mode: "instant",
	})
	if err != nil {
		t.Fatalf("Query: %v", err)
	}
	want := []rxBot.ChatMessage{
		{Role: "user", Content: "first"},
		{Role: "assistant", Content: "prior answer"},
		{Role: "user", Content: "follow up"},
	}
	if !reflect.DeepEqual(captured.Messages, want) {
		t.Fatalf("messages = %#v, want %#v", captured.Messages, want)
	}
}

func TestQueryStreamForwardsHistoryBeforeCurrentTurn(t *testing.T) {
	setupStreamTestDB(t)
	var captured rxBot.ChatCompletionRequest
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if err := json.NewDecoder(r.Body).Decode(&captured); err != nil {
			t.Errorf("decode stream request: %v", err)
			w.WriteHeader(http.StatusBadRequest)
			return
		}
		w.Header().Set("Content-Type", "text/event-stream")
		_, _ = w.Write([]byte("event: RunStarted\ndata: {\"type\":\"RunStarted\",\"run_id\":\"run-history-stream\"}\n\n" +
			"event: TextMessageContent\ndata: {\"type\":\"TextMessageContent\",\"delta\":\"answer\"}\n\n" +
			"event: RunFinished\ndata: {\"type\":\"RunFinished\",\"run_id\":\"run-history-stream\"}\n\n"))
	}))
	t.Cleanup(srv.Close)
	rxBot.BotConfig = &rxBot.Config{BaseURL: srv.URL, ProxyEnabled: true, StreamEnabled: true, TimeoutSeconds: 5}
	t.Cleanup(func() { rxBot.BotConfig = nil })

	_, err := NewService().QueryStream(context.Background(), "alice", QueryInput{
		Query: "follow up", History: `[{"role":"assistant","content":"prior"}]`, Mode: "instant",
	}, nil, nil)
	if err != nil {
		t.Fatalf("QueryStream: %v", err)
	}
	if len(captured.Messages) != 2 || captured.Messages[0].Content != "prior" || captured.Messages[1].Content != "follow up" {
		t.Fatalf("stream messages = %#v", captured.Messages)
	}
}
