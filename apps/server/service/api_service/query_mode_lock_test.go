package api_service

import (
	"context"
	"encoding/json"
	"net/http"
	"testing"

	"phytomni-server/model"
)

func TestFailedProvisionalV1TurnDoesNotLockMode(t *testing.T) {
	gdb := setupExpertTestDB(t)
	v1SubmissionServer(t, func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		if r.URL.Path != "/v1/chat/completions" {
			http.NotFound(w, r)
			return
		}
		// Both turns now dispatch to chat-completions: the first (instant) turn is
		// phyto-chat and must fail; the second (expert + forced KnowledgeAgent) is
		// phyto-knowledge and must be accepted. Distinguish by the requested model.
		var body struct {
			Model string `json:"model"`
		}
		_ = json.NewDecoder(r.Body).Decode(&body)
		if body.Model == "phyto-chat" {
			w.WriteHeader(http.StatusBadRequest)
			_, _ = w.Write([]byte(`{"error":{"message":"synthetic rejection"}}`))
			return
		}
		_ = json.NewEncoder(w).Encode(map[string]any{
			"id":     "run-after-provisional-failure",
			"run_id": "run-after-provisional-failure",
			"object": "chat.completion",
			"status": "succeeded",
			"choices": []map[string]any{
				{"index": 0, "message": map[string]any{"role": "assistant", "content": "second turn accepted"}},
			},
			"formatted": map[string]any{"answer": "second turn accepted"},
		})
	})

	_, err := NewService().Query(context.Background(), "alice", QueryInput{
		Query:        "first turn fails before acceptance",
		Mode:         "instant",
		ClientTurnID: "provisional-instant-turn",
	})
	if err == nil {
		t.Fatal("expected the first turn to fail")
	}
	var failed model.QuestionAgentLog
	if err := gdb.Order("id ASC").First(&failed).Error; err != nil {
		t.Fatal(err)
	}
	if failed.Status != "FAILED" {
		t.Fatalf("first status = %q, want FAILED", failed.Status)
	}

	accepted, err := NewService().Query(context.Background(), "alice", QueryInput{
		Query:        "continue after a failed provisional turn",
		Id:           failed.Id,
		Mode:         "expert",
		Tool:         "KnowledgeAgent",
		ClientTurnID: "provisional-expert-turn",
	})
	if err != nil {
		t.Fatalf("second mode was incorrectly locked by failed row: %v", err)
	}
	if accepted.Status != statusSucceeded {
		t.Fatalf("second status = %q, want %q", accepted.Status, statusSucceeded)
	}
	var child model.QuestionAgentLog
	if err := gdb.First(&child, accepted.Id).Error; err != nil {
		t.Fatal(err)
	}
	if child.Mode != "expert" {
		t.Fatalf("accepted child mode = %q, want expert", child.Mode)
	}
}
