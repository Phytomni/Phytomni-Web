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
		switch r.URL.Path {
		case "/v1/chat/completions":
			var body struct {
				Model string `json:"model"`
			}
			_ = json.NewDecoder(r.Body).Decode(&body)
			switch body.Model {
			case "phyto-chat":
				// The first instant turn is phyto-chat and must fail.
				w.WriteHeader(http.StatusBadRequest)
				_, _ = w.Write([]byte(`{"error":{"message":"synthetic rejection"}}`))
			case "phyto-knowledge":
				// The second turn keeps its explicit KnowledgeAgent selection and
				// dispatches directly to the chat-family endpoint.
				_, _ = w.Write([]byte(`{"id":"run-after-provisional-failure","run_id":"run-after-provisional-failure","object":"chat.completion","status":"succeeded","choices":[{"index":0,"message":{"role":"assistant","content":"second turn accepted"}}],"formatted":{"answer":"second turn accepted"}}`))
			default:
				t.Fatalf("unexpected chat model %q", body.Model)
			}
		case "/v1/query/route":
			// The second Expert turn uses the context-aware route with the
			// validated per-turn KnowledgeAgent selection.
			_ = json.NewEncoder(w).Encode(map[string]any{
				"id":       "run-after-provisional-failure",
				"run_id":   "run-after-provisional-failure",
				"object":   "agent.run",
				"agent":    "knowledge",
				"status":   "succeeded",
				"task_ids": []string{},
				"result": map[string]any{"formatted": map[string]any{
					"answer": "second turn accepted",
				}},
			})
		default:
			http.NotFound(w, r)
		}
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
