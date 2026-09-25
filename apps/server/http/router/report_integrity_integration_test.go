package router

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"strings"
	"testing"

	rxBot "phytomni-server/external/bot"
	"phytomni-server/middleware"
	"phytomni-server/service/api_service"
)

func TestReportIntegrityArchiveRealAuthorization(t *testing.T) {
	engine, gdb := buildRealApiEnv(t)
	if err := gdb.Exec(`CREATE TABLE question_agent_logs (
		id INTEGER PRIMARY KEY, dialogue_id TEXT, f_id INTEGER DEFAULT 0,
		user_name TEXT, status TEXT, answer TEXT, bot_run_id TEXT,
		bot_projection_json TEXT, bot_report_revision INTEGER,
		updated_at DATETIME, delete_at DATETIME
	)`).Error; err != nil {
		t.Fatal(err)
	}
	for _, owner := range []string{"synthetic-owner", "other-owner"} {
		if err := gdb.Exec(`INSERT INTO users (email, first_login_status) VALUES (?, '1')`, owner).Error; err != nil {
			t.Fatal(err)
		}
	}
	ownerToken, err := middleware.GenerateToken("synthetic-owner")
	if err != nil {
		t.Fatal(err)
	}
	foreignToken, err := middleware.GenerateToken("other-owner")
	if err != nil {
		t.Fatal(err)
	}
	producerBytes, err := os.ReadFile("../../service/api_service/testdata/report-integrity/terminal-report-integrity.json")
	if err != nil {
		t.Fatal(err)
	}
	var producers []struct {
		Agent, Scenario, Status string
		Result                  json.RawMessage
	}
	if err := json.Unmarshal(producerBytes, &producers); err != nil {
		t.Fatal(err)
	}
	publicBytes, err := os.ReadFile("../../../web/tests/fixtures/report-integrity/public-projection.json")
	if err != nil {
		t.Fatal(err)
	}
	var public struct {
		Cases []struct {
			ID      string
			History struct {
				ID         int64
				DialogueID string `json:"dialogue_id"`
				RunID      string `json:"bot_run_id"`
				Artifacts  []struct{ ID string }
			}
		}
	}
	if err := json.Unmarshal(publicBytes, &public); err != nil {
		t.Fatal(err)
	}
	checked := 0
	for _, producer := range producers {
		if producer.Scenario != "no_text" {
			continue
		}
		for _, candidate := range public.Cases {
			if candidate.ID != "no-science-archive-"+producer.Agent {
				continue
			}
			checked++
			t.Run(producer.Agent, func(t *testing.T) {
				row := candidate.History
				if len(row.Artifacts) != 1 {
					t.Fatal("expected one archive")
				}
				projection, err := api_service.DecodeRunProjection(rxBot.RunRecord{RunID: row.RunID, Agent: producer.Agent, Status: producer.Status, Result: producer.Result})
				if err != nil {
					t.Fatal(err)
				}
				if projection.VisibleReport() != "" || projection.Delivery == nil || projection.Delivery.Status != "ready" {
					t.Fatal("expected empty science with ready archive")
				}
				if err := gdb.Exec(`INSERT INTO question_agent_logs (id, dialogue_id, user_name, status, answer, bot_run_id, bot_projection_json, bot_report_revision) VALUES (?, ?, 'synthetic-owner', 'SUCCEEDED', '', ?, '', -1)`, row.ID, row.DialogueID, row.RunID).Error; err != nil {
					t.Fatal(err)
				}
				if err := api_service.SaveBotRunProjection(context.Background(), "synthetic-owner", row.ID, projection); err != nil {
					t.Fatal(err)
				}
				route := fmt.Sprintf("/api/v1/conversations/%s/messages/%d/artifacts/%s/download-url", row.DialogueID, row.ID, row.Artifacts[0].ID)
				for _, auth := range []struct {
					name, token string
					status      int
				}{
					{"owner", ownerToken, http.StatusOK},
					{"foreign owner", foreignToken, http.StatusNotFound},
					{"unauthenticated", "", http.StatusUnauthorized},
				} {
					t.Run(auth.name, func(t *testing.T) {
						response := geneResourceRouteRequest(engine, route, auth.token)
						if response.Code != auth.status {
							t.Fatalf("status=%d want=%d", response.Code, auth.status)
						}
						if auth.status != http.StatusOK {
							return
						}
						var envelope struct {
							Code int
							Data string
						}
						if err := json.Unmarshal(response.Body.Bytes(), &envelope); err != nil {
							t.Fatal(err)
						}
						const prefix = "/api/v1/downloads/relay-file?token="
						if envelope.Code != http.StatusOK || !strings.HasPrefix(envelope.Data, prefix) {
							t.Fatal("expected signed relay route")
						}
						key, err := middleware.ParseDownloadToken(strings.TrimPrefix(envelope.Data, prefix))
						if err != nil || !strings.HasSuffix(key, "/"+producer.Agent+"-results.zip") {
							t.Fatal("wrong archive capability")
						}
						if strings.Contains(response.Body.String(), "synthetic-bucket") {
							t.Fatal("storage root leaked")
						}
					})
				}
			})
		}
	}
	if checked != 4 {
		t.Fatalf("checked %d agents, expected 4", checked)
	}
}
