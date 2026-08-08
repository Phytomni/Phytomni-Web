package api_service

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"testing"

	"github.com/glebarez/sqlite"
	"github.com/spf13/viper"
	"gorm.io/gorm"

	"phytomni-server/db"
	rxBot "phytomni-server/external/bot"
)

type lifecycleFakeRunReader struct {
	record *rxBot.RunRecord
	meta   rxBot.ResponseMeta
	err    error
	calls  int
	runIDs []string
}

func (f *lifecycleFakeRunReader) GetRunWithMeta(_ context.Context, runID string) (*rxBot.RunRecord, rxBot.ResponseMeta, error) {
	f.calls++
	f.runIDs = append(f.runIDs, runID)
	return f.record, f.meta, f.err
}

func (f *lifecycleFakeRunReader) GetRunLogs(context.Context, string) (*rxBot.RunLogsResponse, error) {
	return nil, errors.New("unexpected run logs request")
}

func setupAgentTaskLifecycleDB(t *testing.T) *gorm.DB {
	t.Helper()
	gdb, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatalf("open sqlite: %v", err)
	}
	if sqlDB, err := gdb.DB(); err == nil {
		sqlDB.SetMaxOpenConns(1)
	}
	if err := gdb.Exec(`CREATE TABLE question_agent_logs (
		id INTEGER PRIMARY KEY,
		user_name TEXT,
		bot_run_id TEXT,
		status TEXT,
		answer TEXT,
		download_path TEXT,
		image_paths TEXT,
		bot_projection_json TEXT,
		bot_report_revision INTEGER NOT NULL DEFAULT -1,
		updated_at DATETIME
	)`).Error; err != nil {
		t.Fatalf("create lifecycle table: %v", err)
	}
	db.Set("phytomni-server", gdb)
	return gdb
}

type lifecycleSeed struct {
	id             int64
	username       string
	runID          string
	status         string
	answer         string
	downloadPath   string
	imagePaths     string
	projection     string
	reportRevision int64
}

func seedAgentTaskLifecycleRow(t *testing.T, gdb *gorm.DB, row lifecycleSeed) {
	t.Helper()
	if err := gdb.Exec(`INSERT INTO question_agent_logs
		(id, user_name, bot_run_id, status, answer, download_path, image_paths, bot_projection_json, bot_report_revision)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		row.id, row.username, row.runID, row.status, row.answer, row.downloadPath, row.imagePaths, row.projection, row.reportRevision,
	).Error; err != nil {
		t.Fatalf("seed lifecycle row: %v", err)
	}
}

func lifecycleRunRecord(runID, status string, childIDs ...string) *rxBot.RunRecord {
	return &rxBot.RunRecord{
		RunID:   runID,
		Agent:   "analyst",
		Status:  status,
		TaskIDs: childIDs,
		Result:  json.RawMessage(`{}`),
	}
}

func lifecycleDeliveryRunRecord(t *testing.T, runID, scientificStatus, deliveryStatus string, revision int64) *rxBot.RunRecord {
	t.Helper()
	delivery := map[string]interface{}{
		"schema_version":   1,
		"required":         true,
		"status":           deliveryStatus,
		"revision":         revision,
		"inventory_digest": testProjectionDigestA,
		"archive":          nil,
		"error_code":       nil,
		"retryable":        false,
	}
	switch deliveryStatus {
	case "ready":
		delivery["archive"] = map[string]interface{}{
			"role":                    "result_archive",
			"name":                    "analyst-results.zip",
			"media_type":              "application/zip",
			"size_bytes":              int64(4097),
			"downloadable":            true,
			"report_context_eligible": false,
			"download_ref":            "result-archive:" + testProjectionDigestA,
		}
	case "failed":
		delivery["error_code"] = "archive_publish_failed"
		delivery["retryable"] = true
	}
	result, err := json.Marshal(map[string]interface{}{
		"report_revision": 3,
		"final_report":    "# Scientific result",
		"execution": map[string]interface{}{
			"output_dirs": []string{"obs://bucket/owner/run"},
			"delivery":    delivery,
		},
	})
	if err != nil {
		t.Fatalf("marshal lifecycle run: %v", err)
	}
	return &rxBot.RunRecord{
		RunID:  runID,
		Agent:  "analyst",
		Status: scientificStatus,
		Result: result,
	}
}

// Mutation coverage: mapping a legacy zero-child running umbrella run to a
// terminal or preparing phase would hide its truthful generic running state.
func TestAgentTaskLifecycleMapsFreshRunStates(t *testing.T) {
	tests := []struct {
		name              string
		botStatus         string
		childIDs          []string
		wantPhase         string
		wantTerminal      bool
		wantChildAccepted bool
	}{
		{name: "running without stage stays generic", botStatus: "running", wantPhase: "RUNNING"},
		{name: "running with children accepts work", botStatus: "running", childIDs: []string{"child-1", "child-2"}, wantPhase: "RUNNING", wantChildAccepted: true},
		{name: "succeeded is terminal", botStatus: "succeeded", wantPhase: "SUCCEEDED", wantTerminal: true},
		{name: "failed is terminal", botStatus: "failed", wantPhase: "FAILED", wantTerminal: true},
		{name: "cancelled is terminal", botStatus: "cancelled", wantPhase: "CANCELLED", wantTerminal: true},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			gdb := setupAgentTaskLifecycleDB(t)
			seedAgentTaskLifecycleRow(t, gdb, lifecycleSeed{id: 1, username: "alice", runID: "run-1", status: "RUNNING", reportRevision: -1})
			fake := &lifecycleFakeRunReader{record: lifecycleRunRecord("run-1", tt.botStatus, tt.childIDs...)}

			got, err := (&Service{runReader: fake}).AgentTaskLifecycle(context.Background(), 1, "alice")
			if err != nil {
				t.Fatalf("AgentTaskLifecycle: %v", err)
			}
			if got.Phase != tt.wantPhase || got.Terminal != tt.wantTerminal || got.ChildWorkAccepted != tt.wantChildAccepted {
				t.Fatalf("lifecycle=%+v, want phase=%q terminal=%v child_work_accepted=%v", got, tt.wantPhase, tt.wantTerminal, tt.wantChildAccepted)
			}
			if got.Reconciliation != "FRESH" || fake.calls != 1 || len(fake.runIDs) != 1 || fake.runIDs[0] != "run-1" {
				t.Fatalf("reconciliation/calls = %q/%d/%v, want FRESH/1/[run-1]", got.Reconciliation, fake.calls, fake.runIDs)
			}
		})
	}
}

// Mutation coverage: returning the fake response directly instead of re-reading
// the CAS winner would return RUNNING with two children instead of SUCCEEDED
// with the persisted five-child projection.
func TestAgentTaskLifecycleReadsBackProjectionWinner(t *testing.T) {
	gdb := setupAgentTaskLifecycleDB(t)
	stored, err := marshalPersistedProjection(BotRunProjection{
		RunID: "run-winner", Agent: "analyst", Status: "SUCCEEDED", ChildTaskCount: 5, ReportRevision: 7,
	})
	if err != nil {
		t.Fatalf("marshal stored projection: %v", err)
	}
	seedAgentTaskLifecycleRow(t, gdb, lifecycleSeed{
		id: 2, username: "alice", runID: "run-winner", status: "RUNNING", projection: stored, reportRevision: 7,
	})
	fake := &lifecycleFakeRunReader{record: lifecycleRunRecord("run-winner", "running", "child-1", "child-2")}

	got, err := (&Service{runReader: fake}).AgentTaskLifecycle(context.Background(), 2, "alice")
	if err != nil {
		t.Fatalf("AgentTaskLifecycle: %v", err)
	}
	if got.Phase != "SUCCEEDED" || !got.Terminal || got.ChildTaskCount != 5 || !got.ChildWorkAccepted || got.ReportRevision != 7 {
		t.Fatalf("lifecycle=%+v, want persisted winner", got)
	}
}

func TestAgentTaskLifecycleKeepsRequiredPendingDeliveryPollable(t *testing.T) {
	gdb := setupAgentTaskLifecycleDB(t)
	stored, err := marshalPersistedProjection(BotRunProjection{
		RunID: "run-pending-delivery", Agent: "analyst", Status: "SUCCEEDED", ReportRevision: 3,
		ResultArchiveV1: true, Delivery: testPendingDelivery(1, testProjectionDigestA),
	})
	if err != nil {
		t.Fatalf("marshal stored projection: %v", err)
	}
	seedAgentTaskLifecycleRow(t, gdb, lifecycleSeed{
		id: 20, username: "alice", runID: "run-pending-delivery", status: "SUCCEEDED", projection: stored, reportRevision: 3,
	})
	fake := &lifecycleFakeRunReader{record: lifecycleDeliveryRunRecord(t, "run-pending-delivery", "succeeded", "pending", 1)}

	got, err := (&Service{runReader: fake}).AgentTaskLifecycle(context.Background(), 20, "alice")
	if err != nil {
		t.Fatalf("AgentTaskLifecycle: %v", err)
	}
	if got.Phase != "RUNNING" || got.Terminal || got.Reconciliation != "FRESH" || fake.calls != 1 {
		t.Fatalf("lifecycle=%+v calls=%d, want fresh nonterminal pending delivery", got, fake.calls)
	}
	if got.Delivery == nil || got.Delivery.Status != "pending" || got.Delivery.Revision != 1 {
		t.Fatalf("delivery=%+v, want pending revision 1", got.Delivery)
	}
	status, _ := readStatusAnswer(t, gdb, 20)
	if status != "RUNNING" {
		t.Fatalf("business row status=%q, want RUNNING", status)
	}
	assertDeliveryDTOIsBounded(t, got.Delivery)
}

func TestAgentTaskLifecycleDerivesDeliveryTerminalStates(t *testing.T) {
	tests := []struct {
		name             string
		scientificStatus string
		delivery         *ProjectionDelivery
		wantPhase        string
		wantTerminal     bool
	}{
		{
			name: "scientific failure remains terminal with initial pending delivery", scientificStatus: "FAILED",
			delivery: testPendingDelivery(1, ""), wantPhase: "FAILED", wantTerminal: true,
		},
		{
			name: "scientific timeout remains terminal with initial pending delivery", scientificStatus: "TIMED_OUT",
			delivery: testPendingDelivery(1, ""), wantPhase: "TIMED_OUT", wantTerminal: true,
		},
		{
			name: "ready delivery completes business result", scientificStatus: "SUCCEEDED",
			delivery: testReadyDelivery(1, testProjectionDigestA), wantPhase: "SUCCEEDED", wantTerminal: true,
		},
		{
			name: "delivery failure is terminal but incomplete", scientificStatus: "SUCCEEDED",
			delivery: testFailedDelivery(1, testProjectionDigestA, true), wantPhase: "FAILED", wantTerminal: true,
		},
	}
	for index, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			gdb := setupAgentTaskLifecycleDB(t)
			stored, err := marshalPersistedProjection(BotRunProjection{
				RunID: "run-terminal-delivery", Agent: "analyst", Status: tt.scientificStatus, ReportRevision: 3,
				ResultArchiveV1: true, Delivery: tt.delivery,
			})
			if err != nil {
				t.Fatalf("marshal stored projection: %v", err)
			}
			seedAgentTaskLifecycleRow(t, gdb, lifecycleSeed{
				id: int64(30 + index), username: "alice", runID: "run-terminal-delivery", status: tt.scientificStatus,
				projection: stored, reportRevision: 3,
			})
			fake := &lifecycleFakeRunReader{err: errors.New("terminal delivery must not poll")}

			got, err := (&Service{runReader: fake}).AgentTaskLifecycle(context.Background(), int64(30+index), "alice")
			if err != nil {
				t.Fatalf("AgentTaskLifecycle: %v", err)
			}
			if got.Phase != tt.wantPhase || got.Terminal != tt.wantTerminal || got.Reconciliation != "CACHED" || fake.calls != 0 {
				t.Fatalf("lifecycle=%+v calls=%d", got, fake.calls)
			}
			if got.Delivery == nil || got.Delivery.Status != tt.delivery.Status {
				t.Fatalf("delivery=%+v, want %q", got.Delivery, tt.delivery.Status)
			}
			assertDeliveryDTOIsBounded(t, got.Delivery)
		})
	}
}

func TestAnswerCheckIncludesBoundedDeliveryForOwnerHistory(t *testing.T) {
	gdb := setupTestDB(t)
	previousDualRead := viper.Get("bot.history_dual_read")
	viper.Set("bot.history_dual_read", false)
	t.Cleanup(func() { viper.Set("bot.history_dual_read", previousDualRead) })
	previousBotConfig := rxBot.BotConfig
	rxBot.BotConfig = nil
	t.Cleanup(func() { rxBot.BotConfig = previousBotConfig })

	deliveries := []*ProjectionDelivery{
		testPendingDelivery(1, testProjectionDigestA),
		testReadyDelivery(1, testProjectionDigestA),
		testFailedDelivery(1, testProjectionDigestA, true),
	}
	for index, delivery := range deliveries {
		rowID := int64(40 + index)
		parentID := int64(40)
		projection, err := marshalPersistedProjection(BotRunProjection{
			RunID: "run-history-" + delivery.Status, Agent: "analyst", Status: "SUCCEEDED", ReportRevision: 3,
			ResultArchiveV1: true, Delivery: delivery,
		})
		if err != nil {
			t.Fatalf("marshal history projection: %v", err)
		}
		fID := int64(0)
		if index > 0 {
			fID = parentID
		}
		rowStatus := "SUCCEEDED"
		if delivery.Status == "pending" {
			rowStatus = "RUNNING"
		}
		if err := gdb.Exec(`INSERT INTO question_agent_logs
			(id, dialogue_id, f_id, user_name, query, answer, tool_name, bot_run_id, status, bot_projection_json, bot_report_revision, created_at)
			VALUES (?, 'dlg-delivery', ?, 'alice', 'q', 'answer', 'AnalystAgent', ?, ?, ?, 3, '2026-08-05 00:00:00')`,
			rowID, fID, "run-history-"+delivery.Status, rowStatus, projection,
		).Error; err != nil {
			t.Fatalf("seed history row: %v", err)
		}
	}

	history, err := NewService().AnswerCheck(context.Background(), "alice", "dlg-delivery")
	if err != nil {
		t.Fatalf("AnswerCheck: %v", err)
	}
	if len(history) != 3 {
		t.Fatalf("history rows=%d, want 3", len(history))
	}
	for index, wantStatus := range []string{"pending", "ready", "failed"} {
		if history[index].Delivery == nil || history[index].Delivery.Status != wantStatus {
			t.Fatalf("history[%d].delivery=%+v, want %q", index, history[index].Delivery, wantStatus)
		}
		if wantStatus == "pending" && history[index].Status != "RUNNING" {
			t.Fatalf("pending history status=%q, want RUNNING", history[index].Status)
		}
		assertDeliveryDTOIsBounded(t, history[index].Delivery)
	}
	foreign, err := NewService().AnswerCheck(context.Background(), "bob", "dlg-delivery")
	if err != nil || len(foreign) != 0 {
		t.Fatalf("foreign history=%+v err=%v, want empty", foreign, err)
	}
}

func assertDeliveryDTOIsBounded(t *testing.T, dto *AgentTaskDeliveryDTO) {
	t.Helper()
	encoded, err := json.Marshal(dto)
	if err != nil {
		t.Fatalf("marshal delivery DTO: %v", err)
	}
	var fields map[string]json.RawMessage
	if err := json.Unmarshal(encoded, &fields); err != nil {
		t.Fatalf("decode delivery DTO: %v", err)
	}
	wantFields := []string{"schema_version", "required", "status", "revision", "name", "size_bytes", "error_code", "retryable"}
	if len(fields) != len(wantFields) {
		t.Fatalf("delivery DTO keys=%v, want exactly %v", fields, wantFields)
	}
	for _, field := range wantFields {
		if _, ok := fields[field]; !ok {
			t.Fatalf("delivery DTO missing %q: %s", field, encoded)
		}
	}
	for _, forbidden := range []string{"inventory_digest", "archive_ref", "download_ref", "output_dirs", "members", "provider", testProjectionDigestA, "obs://"} {
		if strings.Contains(string(encoded), forbidden) {
			t.Fatalf("delivery DTO leaked %q: %s", forbidden, encoded)
		}
	}
}

// Mutation coverage: checking only row.Status polls Bot for a row whose durable
// projection is already terminal. The projection winner must be cached instead.
func TestAgentTaskLifecycleCachesTerminalProjectionWithStaleRowStatus(t *testing.T) {
	tests := []struct {
		status    string
		wantPhase string
	}{
		{status: "SUCCEEDED", wantPhase: "SUCCEEDED"},
		{status: "FAILED", wantPhase: "FAILED"},
		{status: "CANCELLED", wantPhase: "CANCELLED"},
		{status: "TIMED_OUT", wantPhase: "TIMED_OUT"},
	}

	for _, tt := range tests {
		t.Run(tt.status, func(t *testing.T) {
			gdb := setupAgentTaskLifecycleDB(t)
			stored, err := marshalPersistedProjection(BotRunProjection{
				RunID: "run-terminal-projection", Agent: "analyst", Status: tt.status, ReportRevision: 4,
			})
			if err != nil {
				t.Fatalf("marshal stored projection: %v", err)
			}
			seedAgentTaskLifecycleRow(t, gdb, lifecycleSeed{
				id: 9, username: "alice", runID: "run-terminal-projection", status: "RUNNING", projection: stored, reportRevision: 4,
			})
			fake := &lifecycleFakeRunReader{err: errors.New("terminal projection must not poll")}

			got, err := (&Service{runReader: fake}).AgentTaskLifecycle(context.Background(), 9, "alice")
			if err != nil {
				t.Fatalf("AgentTaskLifecycle: %v", err)
			}
			if got.Phase != tt.wantPhase || !got.Terminal || got.Reconciliation != "CACHED" || fake.calls != 0 {
				t.Fatalf("lifecycle=%+v calls=%d, want cached terminal projection without polling", got, fake.calls)
			}
		})
	}
}

func TestAgentTaskLifecycleUsesCachedStateWithoutPolling(t *testing.T) {
	tests := []struct {
		name      string
		row       lifecycleSeed
		wantPhase string
	}{
		{
			name:      "terminal row",
			row:       lifecycleSeed{id: 3, username: "alice", runID: "run-terminal", status: "SUCCEEDED", reportRevision: -1},
			wantPhase: "SUCCEEDED",
		},
		{
			name:      "legacy row without run id",
			row:       lifecycleSeed{id: 4, username: "alice", status: "RUNNING", reportRevision: -1},
			wantPhase: "RUNNING",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			gdb := setupAgentTaskLifecycleDB(t)
			seedAgentTaskLifecycleRow(t, gdb, tt.row)
			fake := &lifecycleFakeRunReader{err: errors.New("must not poll")}

			got, err := (&Service{runReader: fake}).AgentTaskLifecycle(context.Background(), tt.row.id, "alice")
			if err != nil {
				t.Fatalf("AgentTaskLifecycle: %v", err)
			}
			if got.Phase != tt.wantPhase || got.Reconciliation != "CACHED" || fake.calls != 0 {
				t.Fatalf("lifecycle=%+v calls=%d, want cached %q without polling", got, fake.calls, tt.wantPhase)
			}
		})
	}
}

func TestAgentTaskLifecycleDegradesToCachedStateForUnsafeRunResponses(t *testing.T) {
	tests := []struct {
		name string
		fake *lifecycleFakeRunReader
	}{
		{name: "transport failure", fake: &lifecycleFakeRunReader{err: errors.New("transport down")}},
		{name: "mismatched run id", fake: &lifecycleFakeRunReader{record: lifecycleRunRecord("run-other", "running")}},
		{name: "malformed run", fake: &lifecycleFakeRunReader{record: lifecycleRunRecord("run-safe", "unknown")}},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			gdb := setupAgentTaskLifecycleDB(t)
			seedAgentTaskLifecycleRow(t, gdb, lifecycleSeed{id: 5, username: "alice", runID: "run-safe", status: "RUNNING", reportRevision: -1})

			got, err := (&Service{runReader: tt.fake}).AgentTaskLifecycle(context.Background(), 5, "alice")
			if err != nil {
				t.Fatalf("AgentTaskLifecycle: %v", err)
			}
			if got.Phase != "RUNNING" || got.Reconciliation != "DEGRADED" || got.ErrorCode == nil || got.TrackingDegraded || tt.fake.calls != 1 {
				t.Fatalf("lifecycle=%+v calls=%d, want safe degraded cached state", got, tt.fake.calls)
			}
			if tt.name == "transport failure" && *got.ErrorCode != "bot_transport_failed" {
				t.Fatalf("transport error code=%q", *got.ErrorCode)
			}
			if tt.name != "transport failure" && *got.ErrorCode != "run_contract_invalid" {
				t.Fatalf("contract error code=%q", *got.ErrorCode)
			}
		})
	}
}

func TestLifecyclePhaseMapsResearchWorkStages(t *testing.T) {
	cases := map[string]string{
		"input_resolution": "RESOLVING_INPUTS",
		"planning":         "PLANNING",
		"execution":        "RUNNING",
		"report_assembly":  "FINALIZING",
	}
	for stage, want := range cases {
		got, terminal := lifecyclePhase("RUNNING", stage)
		if got != want || terminal {
			t.Fatalf("%s => %s/%v, want %s/false", stage, got, terminal, want)
		}
	}
}

func TestLifecyclePhaseKeepsLegacyRunningGeneric(t *testing.T) {
	for _, stage := range []string{"", "unknown", strings.Repeat("x", 65)} {
		got, terminal := lifecyclePhase("RUNNING", stage)
		if got != "RUNNING" || terminal {
			t.Fatalf("stage=%q => %s/%v, want RUNNING/false", stage, got, terminal)
		}
	}
}

func TestLifecyclePhaseTerminalAuthority(t *testing.T) {
	tests := []struct {
		status   string
		want     string
		terminal bool
	}{
		{status: "PENDING", want: "PREPARING"},
		{status: "RUNNING", want: "RUNNING"},
		{status: "SUCCEEDED", want: "SUCCEEDED", terminal: true},
		{status: "FAILED", want: "FAILED", terminal: true},
		{status: "TIMED_OUT", want: "TIMED_OUT", terminal: true},
		{status: "TIMEOUT", want: "TIMED_OUT", terminal: true},
		{status: "CANCELLED", want: "CANCELLED", terminal: true},
	}
	for _, tt := range tests {
		got, terminal := lifecyclePhase(tt.status, "")
		if got != tt.want || terminal != tt.terminal {
			t.Fatalf("status=%q => %s/%v, want %s/%v", tt.status, got, terminal, tt.want, tt.terminal)
		}
	}
}

func TestResearchLifecycleSequenceHasOneTerminalSuccess(t *testing.T) {
	sequence := []struct {
		status   string
		stage    string
		want     string
		terminal bool
	}{
		{status: "PENDING", want: "PREPARING"},
		{status: "RUNNING", stage: "input_resolution", want: "RESOLVING_INPUTS"},
		{status: "RUNNING", stage: "planning", want: "PLANNING"},
		{status: "RUNNING", stage: "execution", want: "RUNNING"},
		{status: "RUNNING", stage: "report_assembly", want: "FINALIZING"},
		{status: "SUCCEEDED", want: "SUCCEEDED", terminal: true},
	}

	terminalCount := 0
	for index, step := range sequence {
		got, terminal := lifecyclePhase(step.status, step.stage)
		if got != step.want || terminal != step.terminal {
			t.Fatalf("step %d = %s/%v, want %s/%v", index, got, terminal, step.want, step.terminal)
		}
		if terminal {
			terminalCount++
		}
	}
	if terminalCount != 1 {
		t.Fatalf("terminal lifecycle steps = %d, want exactly one", terminalCount)
	}
}

// Mutation coverage: dropping user_name from the lookup lets a caller probe a
// foreign row and causes either a Bot call or a distinguishable response.
func TestAgentTaskLifecycleHidesAbsentAndForeignRows(t *testing.T) {
	gdb := setupAgentTaskLifecycleDB(t)
	seedAgentTaskLifecycleRow(t, gdb, lifecycleSeed{id: 6, username: "alice", runID: "run-private", status: "RUNNING", reportRevision: -1})
	fake := &lifecycleFakeRunReader{record: lifecycleRunRecord("run-private", "running")}
	service := &Service{runReader: fake}

	_, absentErr := service.AgentTaskLifecycle(context.Background(), 99, "alice")
	_, foreignErr := service.AgentTaskLifecycle(context.Background(), 6, "bob")
	if !errors.Is(absentErr, ErrAgentTaskLifecycleNotFound) || !errors.Is(foreignErr, ErrAgentTaskLifecycleNotFound) || absentErr != foreignErr {
		t.Fatalf("absent=%v foreign=%v, want the same not-found error", absentErr, foreignErr)
	}
	if fake.calls != 0 {
		t.Fatalf("not-found lookups polled Bot %d times", fake.calls)
	}
}

func TestAgentTaskLifecycleMarshalsOnlyBoundedArtifactSummary(t *testing.T) {
	t.Run("projection artifacts", func(t *testing.T) {
		gdb := setupAgentTaskLifecycleDB(t)
		stored, err := marshalPersistedProjection(BotRunProjection{
			RunID: "run-private", Agent: "analyst", Status: "SUCCEEDED", ChildTaskCount: 2, ReportRevision: 3,
			FinalReport: "private report text",
			Artifacts:   ProjectionArtifacts{Directories: []string{"/obs/private/output"}, Paths: []string{"/obs/private/output/a.png", "/obs/private/output/b.png"}},
		})
		if err != nil {
			t.Fatalf("marshal stored projection: %v", err)
		}
		seedAgentTaskLifecycleRow(t, gdb, lifecycleSeed{id: 7, username: "alice-private", runID: "run-private", status: "SUCCEEDED", answer: "private report text", projection: stored, reportRevision: 3})

		got, err := (&Service{}).AgentTaskLifecycle(context.Background(), 7, "alice-private")
		if err != nil {
			t.Fatalf("AgentTaskLifecycle: %v", err)
		}
		assertLifecycleJSONIsMinimized(t, got, []string{"private report text", "/obs/private/output", "alice-private", "run-private", "child-private"})
		encoded, _ := json.Marshal(got)
		for _, want := range []string{`"image_count":2`, `"output_directory_count":1`, `"has_report":true`} {
			if !strings.Contains(string(encoded), want) {
				t.Fatalf("DTO JSON %s does not contain %s", encoded, want)
			}
		}
	})

	t.Run("legacy artifact columns", func(t *testing.T) {
		gdb := setupAgentTaskLifecycleDB(t)
		seedAgentTaskLifecycleRow(t, gdb, lifecycleSeed{
			id: 8, username: "alice-legacy", status: "RUNNING", answer: "legacy private report", downloadPath: "/obs/legacy/output",
			imagePaths: `["/obs/legacy/output/a.png","/obs/legacy/output/b.png"]`, reportRevision: -1,
		})

		got, err := (&Service{}).AgentTaskLifecycle(context.Background(), 8, "alice-legacy")
		if err != nil {
			t.Fatalf("AgentTaskLifecycle: %v", err)
		}
		if got.ArtifactSummary.ImageCount != 2 || got.ArtifactSummary.OutputDirectoryCount != 1 || !got.ArtifactSummary.HasReport {
			t.Fatalf("legacy artifact summary=%+v", got.ArtifactSummary)
		}
		assertLifecycleJSONIsMinimized(t, got, []string{"legacy private report", "/obs/legacy/output", "alice-legacy"})
	})
}

func assertLifecycleJSONIsMinimized(t *testing.T, dto AgentTaskLifecycleDTO, privateValues []string) {
	t.Helper()
	encoded, err := json.Marshal(dto)
	if err != nil {
		t.Fatalf("marshal lifecycle DTO: %v", err)
	}
	for _, privateValue := range privateValues {
		if strings.Contains(string(encoded), privateValue) {
			t.Fatalf("DTO JSON leaked %q: %s", privateValue, encoded)
		}
	}
}
