package bot

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestExecutionEventClientMethodsUseOwnerScopedBotPaths(t *testing.T) {
	fixtures := loadExecutionEventFixtures(t)
	event := string(fixtureEvent(t, fixtures, fixtures.ValidEvents[0].Event, 8))
	projectionRaw, err := jsonMarshal(fixtures.Projection)
	if err != nil {
		t.Fatal(err)
	}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") == "" {
			t.Fatal("missing authorization")
		}
		switch r.URL.Path {
		case "/v1/runs/run-1/events":
			if r.URL.Query().Get("after_seq") != "7" || r.URL.Query().Get("limit") != "20" {
				t.Fatalf("query=%s", r.URL.RawQuery)
			}
			fmt.Fprintf(w, `{"schema_version":1,"run_id":"run-fixture","items":[%s],"next_after_seq":8,"has_more":false}`, event)
		case "/v1/runs/run-1/event-projection":
			_, _ = w.Write(projectionRaw)
		case "/v1/runs/run-1/events/evt-1":
			_, _ = io.WriteString(w, event)
		case "/v1/runs/run-1/events/stream":
			if r.URL.Query().Get("after_seq") != "1" || r.Header.Get("Accept") != "text/event-stream" || r.Header.Get("Last-Event-ID") != "1" {
				t.Fatalf("stream request=%s headers=%v", r.URL.String(), r.Header)
			}
			w.Header().Set("Content-Type", "text/event-stream")
			_, _ = io.WriteString(w, "id: 2\nevent: execution_event\ndata: {}\n\n")
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()
	client := newTestClient(server.URL)

	if _, err := client.GetRunEvents(context.Background(), "run-1", 7, 20); err != nil {
		t.Fatal(err)
	}
	if _, err := client.GetRunEventProjection(context.Background(), "run-1"); err != nil {
		t.Fatal(err)
	}
	if _, err := client.GetRunEvent(context.Background(), "run-1", "evt-1"); err != nil {
		t.Fatal(err)
	}
	body, _, err := client.OpenRunEventStream(context.Background(), "run-1", 1)
	if err != nil {
		t.Fatal(err)
	}
	raw, _ := io.ReadAll(body)
	body.Close()
	if !strings.Contains(string(raw), "id: 2") {
		t.Fatalf("stream=%q", raw)
	}
}

func TestExecutionEventClientUsesPublicExecutionPaths(t *testing.T) {
	fixtures := loadExecutionEventFixtures(t)
	event := string(fixtureEvent(t, fixtures, fixtures.ValidEvents[0].Event, 1))
	projectionRaw, err := jsonMarshal(fixtures.Projection)
	if err != nil {
		t.Fatal(err)
	}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/v1/executions/turn-1/events":
			fmt.Fprintf(w, `{"schema_version":1,"run_id":"run-fixture","items":[%s],"next_after_seq":1,"has_more":false}`, event)
		case "/v1/executions/turn-1/event-projection":
			_, _ = w.Write(projectionRaw)
		case "/v1/executions/turn-1/events/evt-1":
			_, _ = io.WriteString(w, event)
		case "/v1/executions/turn-1/events/stream":
			w.Header().Set("Content-Type", "text/event-stream")
			_, _ = io.WriteString(w, ": attached\n\n")
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()
	client := newTestClient(server.URL)
	if _, err := client.GetExecutionEvents(context.Background(), "turn-1", 0, 50); err != nil {
		t.Fatal(err)
	}
	if _, err := client.GetExecutionEventProjection(context.Background(), "turn-1"); err != nil {
		t.Fatal(err)
	}
	if _, err := client.GetExecutionEvent(context.Background(), "turn-1", "evt-1"); err != nil {
		t.Fatal(err)
	}
	body, _, err := client.OpenExecutionEventStream(context.Background(), "turn-1", 0)
	if err != nil {
		t.Fatal(err)
	}
	body.Close()
}

func TestOpenRunEventStreamRejectsNonSSEContent(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = io.WriteString(w, `{}`)
	}))
	defer server.Close()
	body, _, err := newTestClient(server.URL).OpenRunEventStream(context.Background(), "run-1", 0)
	if err == nil || body != nil {
		t.Fatalf("body=%v err=%v", body, err)
	}
}

func TestExecutionEventClientRejectsMalformedBotPage(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = io.WriteString(w, `{"schema_version":1,"run_id":"run-1","items":[],"next_after_seq":99,"has_more":false}`)
	}))
	defer server.Close()
	page, err := newTestClient(server.URL).GetExecutionEvents(context.Background(), "turn-1", 0, 50)
	if err == nil || page != nil {
		t.Fatalf("page=%#v err=%v, want fail-closed malformed cursor", page, err)
	}
}

func TestOpenRunEventStreamDoesNotApplyOrdinaryRequestLifetimeTimeout(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "text/event-stream")
		w.WriteHeader(http.StatusOK)
		if flusher, ok := w.(http.Flusher); ok {
			flusher.Flush()
		}
		time.Sleep(40 * time.Millisecond)
		_, _ = io.WriteString(w, ": heartbeat\n\n")
	}))
	defer server.Close()
	client := newTestClient(server.URL)
	client.http.Timeout = 10 * time.Millisecond

	body, _, err := client.OpenRunEventStream(context.Background(), "run-1", 0)
	if err != nil {
		t.Fatal(err)
	}
	defer body.Close()
	raw, err := io.ReadAll(body)
	if err != nil {
		t.Fatal(err)
	}
	if string(raw) != ": heartbeat\n\n" {
		t.Fatalf("stream=%q", raw)
	}
}

func jsonMarshal(value any) ([]byte, error) {
	return json.Marshal(value)
}
