package api_service

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"testing"

	"github.com/glebarez/sqlite"
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

// Mutation coverage: mapping a zero-child running umbrella run to RUNNING
// would make this test fail. It must remain PREPARING until child work exists.
func TestAgentTaskLifecycleMapsFreshRunStates(t *testing.T) {
	tests := []struct {
		name              string
		botStatus         string
		childIDs          []string
		wantPhase         string
		wantTerminal      bool
		wantChildAccepted bool
	}{
		{name: "running without children prepares", botStatus: "running", wantPhase: "PREPARING"},
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
		{status: "TIMED_OUT", wantPhase: "FAILED"},
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
			wantPhase: "PREPARING",
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
			if got.Phase != "PREPARING" || got.Reconciliation != "DEGRADED" || got.ErrorCode == nil || got.TrackingDegraded || tt.fake.calls != 1 {
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
