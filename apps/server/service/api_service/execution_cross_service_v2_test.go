package api_service

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	rxBot "phytomni-server/external/bot"
	"phytomni-server/model"
)

// startDeterministicBotProcess replaces only the provider edge. The process
// still owns the production HTTP routes, service authentication, detached
// command worker, Runtime, journal, supervisor, projection, and SSE endpoint.
func startDeterministicBotProcess(t *testing.T, answer string) (string, string, string, func()) {
	t.Helper()
	temp := t.TempDir()
	return startDeterministicBotProcessAtPath(
		t,
		answer,
		filepath.Join(temp, "bot-runtime.sqlite"),
	)
}

func startDeterministicBotProcessAtPath(t *testing.T, answer, botDBPath string) (string, string, string, func()) {
	t.Helper()
	_, currentFile, _, _ := runtime.Caller(0)
	workspace := filepath.Clean(filepath.Join(filepath.Dir(currentFile), "..", "..", "..", "..", ".."))
	botRoot := filepath.Join(workspace, "Phytomni-Bot")
	python := filepath.Join(botRoot, ".venv", "Scripts", "python.exe")
	if _, err := os.Stat(python); err != nil {
		t.Skipf("real Bot test runtime unavailable: %v", err)
	}
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	port := listener.Addr().(*net.TCPAddr).Port
	_ = listener.Close()

	temp := filepath.Dir(botDBPath)
	logPath := filepath.Join(temp, "bot.log")
	logFile, err := os.Create(logPath)
	if err != nil {
		t.Fatal(err)
	}
	cmd := exec.Command(
		python,
		filepath.Join(botRoot, "tests", "support", "cross_service_runtime_server.py"),
		"--port", fmt.Sprint(port),
	)
	cmd.Dir = botRoot
	cmd.Stdout = logFile
	cmd.Stderr = logFile
	cmd.Env = append(os.Environ(),
		"API_TASKS_DB_PATH="+botDBPath,
		"API_SERVICE_TOKEN=cross-service-token",
		"TEMP_DIR="+filepath.Join(temp, "scratch"),
		"PHYTOMNI_CROSS_SERVICE_ANSWER="+answer,
		"PYTHONPATH="+filepath.Join(botRoot, "src")+string(os.PathListSeparator)+botRoot,
	)
	if err := cmd.Start(); err != nil {
		_ = logFile.Close()
		t.Fatal(err)
	}
	stopped := false
	stop := func() {
		if stopped {
			return
		}
		stopped = true
		_ = cmd.Process.Kill()
		_ = cmd.Wait()
		_ = logFile.Close()
	}
	t.Cleanup(stop)

	baseURL := fmt.Sprintf("http://127.0.0.1:%d", port)
	deadline := time.Now().Add(20 * time.Second)
	for time.Now().Before(deadline) {
		response, requestErr := http.Get(baseURL + "/openapi.json")
		if requestErr == nil {
			_ = response.Body.Close()
			if response.StatusCode == http.StatusOK {
				return baseURL, botDBPath, python, stop
			}
		}
		time.Sleep(50 * time.Millisecond)
	}
	stop()
	raw, _ := os.ReadFile(logPath)
	t.Fatalf("real Bot process did not become ready: %s", raw)
	return "", "", "", func() {}
}

func startLostAdmissionAcknowledgementProxy(t *testing.T, botBaseURL string) (string, *atomic.Int32) {
	t.Helper()
	var dropped atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		body, err := io.ReadAll(request.Body)
		if err != nil {
			http.Error(writer, "read request", http.StatusBadRequest)
			return
		}
		upstream, err := http.NewRequestWithContext(
			context.Background(), request.Method,
			botBaseURL+request.URL.RequestURI(), bytes.NewReader(body),
		)
		if err != nil {
			http.Error(writer, "build upstream", http.StatusBadGateway)
			return
		}
		upstream.Header = request.Header.Clone()
		response, err := http.DefaultClient.Do(upstream)
		if err != nil {
			http.Error(writer, "upstream unavailable", http.StatusBadGateway)
			return
		}
		defer response.Body.Close()
		if request.Method == http.MethodPost && request.URL.Path == "/v2/executions" {
			_, _ = io.Copy(io.Discard, response.Body)
			dropped.Add(1)
			hijacker, ok := writer.(http.Hijacker)
			if !ok {
				panic("lost-ack proxy requires connection hijacking")
			}
			connection, _, hijackErr := hijacker.Hijack()
			if hijackErr != nil {
				panic(hijackErr)
			}
			_ = connection.Close()
			return
		}
		for key, values := range response.Header {
			for _, value := range values {
				writer.Header().Add(key, value)
			}
		}
		writer.WriteHeader(response.StatusCode)
		_, _ = io.Copy(writer, response.Body)
	}))
	t.Cleanup(server.Close)
	return server.URL, &dropped
}

func botLostAckIntegrityDiagnostics(python, dbPath, executionID string) string {
	script := `import sqlite3,sys; c=sqlite3.connect(sys.argv[1]); ` +
		`print(c.execute("select count(*) from runs where execution_id=?",(sys.argv[2],)).fetchone()[0]); ` +
		`print(c.execute("select count(*) from execution_commands_v2 where execution_id=?",(sys.argv[2],)).fetchone()[0]); ` +
		`print(c.execute("select count(*) from execution_events_v2 where execution_id=? and event_type in ('execution.succeeded','execution.partial','execution.failed','execution.cancelled','execution.timed_out')",(sys.argv[2],)).fetchone()[0])`
	raw, err := exec.Command(python, "-c", script, dbPath, executionID).CombinedOutput()
	return fmt.Sprintf("%s error=%v", strings.TrimSpace(string(raw)), err)
}

func botExecutionIntegrityCounts(python, dbPath, executionID string) []string {
	script := `import sqlite3,sys; c=sqlite3.connect(sys.argv[1]); ` +
		`print(c.execute("select count(*) from runs where execution_id=?",(sys.argv[2],)).fetchone()[0]); ` +
		`print(c.execute("select count(*) from execution_commands_v2 where execution_id=?",(sys.argv[2],)).fetchone()[0]); ` +
		`print(c.execute("select count(distinct t.task_id) from tasks t join runs r on r.run_id=t.run_id where r.execution_id=?",(sys.argv[2],)).fetchone()[0]); ` +
		`print(c.execute("select count(*) from execution_events_v2 where execution_id=? and event_type in ('execution.succeeded','execution.partial','execution.failed','execution.cancelled','execution.timed_out')",(sys.argv[2],)).fetchone()[0])`
	raw, err := exec.Command(python, "-c", script, dbPath, executionID).CombinedOutput()
	if err != nil {
		return []string{"diagnostic-error", err.Error(), string(raw)}
	}
	return strings.Fields(string(raw))
}

func botReconcileDiagnostics(python, dbPath, executionID string) []string {
	script := `import sqlite3,sys; c=sqlite3.connect(sys.argv[1]); ` +
		`print(*c.execute("select state,reconcile_attempt,reconcile_redispatch_count from execution_commands_v2 where execution_id=?",(sys.argv[2],)).fetchone())`
	raw, err := exec.Command(python, "-c", script, dbPath, executionID).CombinedOutput()
	if err != nil {
		return []string{"diagnostic-error", err.Error(), string(raw)}
	}
	return strings.Fields(string(raw))
}

func botDatabaseDiagnostics(python, dbPath, executionID string) string {
	script := `import sqlite3,sys; c=sqlite3.connect(sys.argv[1]); ` +
		`print('command=',c.execute("select state,attempt,last_error_code from execution_commands_v2 where execution_id=?",(sys.argv[2],)).fetchall()); ` +
		`print('run=',c.execute("select status,tool_name from runs where execution_id=?",(sys.argv[2],)).fetchall())`
	raw, err := exec.Command(python, "-c", script, dbPath, executionID).CombinedOutput()
	logs, logErr := os.ReadFile(filepath.Join(filepath.Dir(dbPath), "bot.log"))
	return fmt.Sprintf("%s (diagnostic error=%v)\nbot log=%s (log error=%v)", raw, err, logs, logErr)
}

func parseExecutionEventIDs(t *testing.T, stream io.Reader) []string {
	t.Helper()
	scanner := bufio.NewScanner(stream)
	scanner.Buffer(make([]byte, 1024), 1<<20)
	eventName := ""
	ids := make([]string, 0)
	for scanner.Scan() {
		line := scanner.Text()
		switch {
		case strings.HasPrefix(line, "event: "):
			eventName = strings.TrimPrefix(line, "event: ")
		case eventName == "execution_event" && strings.HasPrefix(line, "data: "):
			var event rxBot.ExecutionEventV2
			if err := json.Unmarshal([]byte(strings.TrimPrefix(line, "data: ")), &event); err != nil {
				t.Fatal(err)
			}
			ids = append(ids, event.EventID)
			eventName = ""
		}
	}
	if err := scanner.Err(); err != nil {
		t.Fatal(err)
	}
	return ids
}

func assertChatSerialNestedTopology(t *testing.T, page *WebExecutionEventPageV2) {
	t.Helper()
	parents := map[string]string{}
	modelStarts := map[string]int64{}
	modelSuccesses := map[string]int64{}
	for _, event := range page.Items {
		if event.Type == "span.created" && event.ParentSpanID != nil {
			parents[event.SpanID] = *event.ParentSpanID
		}
		operationKey, _ := event.PublicPayload["operation_key"].(string)
		if operationKey != "model.generate" || event.WorkUnitID == nil {
			continue
		}
		switch event.Type {
		case "work_unit.attempt_started":
			modelStarts[*event.WorkUnitID] = event.Seq
		case "work_unit.succeeded":
			modelSuccesses[*event.WorkUnitID] = event.Seq
		}
	}
	maxDepth := 0
	for spanID := range parents {
		depth := 0
		seen := map[string]struct{}{}
		for spanID != "" {
			if _, duplicate := seen[spanID]; duplicate {
				t.Fatalf("cycle in public span hierarchy at %q", spanID)
			}
			seen[spanID] = struct{}{}
			parent, ok := parents[spanID]
			if !ok {
				break
			}
			depth++
			spanID = parent
		}
		if depth > maxDepth {
			maxDepth = depth
		}
	}
	if maxDepth < 3 {
		t.Fatalf("chat span depth=%d, want nested root/tool/stage/model hierarchy", maxDepth)
	}
	if len(modelStarts) != 2 || len(modelSuccesses) != 2 {
		t.Fatalf("chat model flow starts=%#v successes=%#v, want two calls", modelStarts, modelSuccesses)
	}
	var firstID, secondID string
	for workUnitID, seq := range modelStarts {
		if firstID == "" || seq < modelStarts[firstID] {
			secondID = firstID
			firstID = workUnitID
		} else {
			secondID = workUnitID
		}
	}
	if modelSuccesses[firstID] >= modelStarts[secondID] {
		t.Fatalf("chat model work is not serial: starts=%#v successes=%#v", modelStarts, modelSuccesses)
	}
}

func TestRealWebBotStoresWorkersAndOfflineReplayConverge(t *testing.T) {
	answer := strings.Repeat("A", 9000) + "终"
	baseURL, botDBPath, botPython, stopBot := startDeterministicBotProcess(t, answer)
	t.Setenv("PHYTOMNI_API_SERVICE_TOKEN", "cross-service-token")
	previousBotConfig := rxBot.BotConfig
	rxBot.BotConfig = &rxBot.Config{BaseURL: baseURL, ProxyEnabled: true, TimeoutSeconds: 5}
	t.Cleanup(func() { rxBot.BotConfig = previousBotConfig })

	setupExecutionRuntimeV2DB(t)
	ctx := context.Background()
	executionID := "turn-real-cross-service"
	input := QueryInput{
		Query: "Explain rice tillering.", Mode: "instant", Tool: "ChatAgent",
		ClientTurnID: executionID, Locale: "en-US",
	}
	target := v1SubmissionTarget{dialogueID: "dialogue-cross-service", mode: "instant", operation: "append"}
	admitted, err := NewService().admitExecutionCommand(
		ctx, "alice", input, target,
		AgentPermissionResolution{AllowedTools: []string{"ChatAgent"}}, false, "chat",
	)
	if err != nil {
		t.Fatal(err)
	}
	if admitted.assistantMessageID == "" {
		t.Fatalf("admission did not durably mint identities: %#v", admitted)
	}
	var beforeDispatch model.QuestionAgentExecutionAdmission
	if err := model.DB(ctx).Where("execution_id = ?", executionID).Take(&beforeDispatch).Error; err != nil {
		t.Fatal(err)
	}
	if beforeDispatch.BotRunID != nil || beforeDispatch.Status != "admitted" {
		t.Fatalf("execution was not durable before Bot dispatch: %#v", beforeDispatch)
	}
	if err := model.DB(ctx).Model(&model.QuestionAgentExecutionOutbox{}).
		Where("execution_id = ?", executionID).
		Update("next_attempt_at", time.Date(2000, 1, 1, 0, 0, 0, 0, time.UTC)).Error; err != nil {
		t.Fatal(err)
	}
	stats, err := NewService().DispatchExecutionOutboxOnce(ctx, "real-cross-service-dispatcher")
	if err != nil || stats.Acknowledged != 1 {
		t.Fatalf("dispatch stats=%#v err=%v", stats, err)
	}

	client := rxBot.NewClientWithTimeout(5 * time.Second)
	deadline := time.Now().Add(20 * time.Second)
	for {
		snapshot, _, snapshotErr := client.GetExecutionSnapshotV2(ctx, "alice", executionID)
		if snapshotErr == nil && snapshot.Terminal != nil {
			if snapshot.Status != "succeeded" || snapshot.OutputOffset != int64(len([]rune(answer))) {
				t.Fatalf("Bot terminal snapshot=%#v", snapshot)
			}
			break
		}
		if time.Now().After(deadline) {
			diagnostics := botDatabaseDiagnostics(botPython, botDBPath, executionID)
			t.Fatalf("Bot did not finish: snapshot=%#v err=%v db=%s", snapshot, snapshotErr, diagnostics)
		}
		time.Sleep(50 * time.Millisecond)
	}

	// The Bot completed while the Web projector was offline. Recreate the
	// service for every attempt to prove projection state lives in SQLite, not
	// in one worker instance.
	projectionDeadline := time.Now().Add(20 * time.Second)
	for {
		if err := model.DB(ctx).Model(&model.QuestionAgentExecutionAdmission{}).
			Where("execution_id = ?", executionID).
			Updates(map[string]any{"next_projection_at": time.Now().UTC().Add(-time.Second), "projection_lease_owner": nil, "projection_lease_until": nil}).Error; err != nil {
			t.Fatal(err)
		}
		projectionStats, projectionErr := NewService().ProjectExecutionsOnce(ctx)
		if projectionErr != nil {
			t.Fatalf("project stats=%#v err=%v", projectionStats, projectionErr)
		}
		var row model.QuestionAgentExecutionAdmission
		if err := model.DB(ctx).Where("execution_id = ?", executionID).Take(&row).Error; err != nil {
			t.Fatal(err)
		}
		if row.TerminalStatus != nil {
			break
		}
		if time.Now().After(projectionDeadline) {
			t.Fatalf("Web projection did not converge: %#v", row)
		}
		time.Sleep(20 * time.Millisecond)
	}

	var assistant model.ConversationMessageV2
	if err := model.DB(ctx).Where("execution_id = ? AND role = ?", executionID, "assistant").Take(&assistant).Error; err != nil {
		t.Fatal(err)
	}
	if assistant.MessageID != admitted.assistantMessageID || assistant.Content != answer || assistant.Status != "succeeded" {
		t.Fatalf("durable assistant mismatch: id=%q size=%d status=%q", assistant.MessageID, len([]rune(assistant.Content)), assistant.Status)
	}

	page, err := NewService().ExecutionEventsPageV2(ctx, "alice", executionID, 0, 200)
	if err != nil || page.Source != "bot" || len(page.Items) == 0 {
		t.Fatalf("Bot page=%#v err=%v", page, err)
	}
	wantEventIDs := make([]string, 0, len(page.Items))
	for _, event := range page.Items {
		wantEventIDs = append(wantEventIDs, event.EventID)
	}
	body, _, err := NewService().executionRuntimeClient().OpenExecutionStreamV2(ctx, "alice", executionID, 0, 0, 0)
	if err != nil {
		t.Fatal(err)
	}
	streamEventIDs := parseExecutionEventIDs(t, body)
	_ = body.Close()
	if !bytes.Equal([]byte(strings.Join(streamEventIDs, "\n")), []byte(strings.Join(wantEventIDs, "\n"))) {
		t.Fatalf("GET/SSE identity drift\nGET=%v\nSSE=%v", wantEventIDs, streamEventIDs)
	}
	reconnectCursor := page.Items[len(page.Items)/2].Seq
	wantReconnectIDs := make([]string, 0, len(page.Items))
	for _, event := range page.Items {
		if event.Seq > reconnectCursor {
			wantReconnectIDs = append(wantReconnectIDs, event.EventID)
		}
	}
	reconnectBody, _, err := NewService().executionRuntimeClient().OpenExecutionStreamV2(ctx, "alice", executionID, reconnectCursor, 0, 0)
	if err != nil {
		t.Fatal(err)
	}
	reconnectEventIDs := parseExecutionEventIDs(t, reconnectBody)
	_ = reconnectBody.Close()
	if !bytes.Equal([]byte(strings.Join(reconnectEventIDs, "\n")), []byte(strings.Join(wantReconnectIDs, "\n"))) {
		t.Fatalf("reconnect cursor drift\nwant=%v\ngot=%v", wantReconnectIDs, reconnectEventIDs)
	}

	stopBot()
	cachedSnapshot, err := NewService().ExecutionSnapshotV2(ctx, "alice", executionID)
	if err != nil || cachedSnapshot.Source != "web_cache" || !cachedSnapshot.Stale || cachedSnapshot.Terminal == nil || cachedSnapshot.Status != "succeeded" {
		t.Fatalf("offline snapshot=%#v err=%v", cachedSnapshot, err)
	}
	cachedPage, err := NewService().ExecutionEventsPageV2(ctx, "alice", executionID, 0, 200)
	if err != nil || cachedPage.Source != "web_cache" || len(cachedPage.Items) != len(page.Items) {
		t.Fatalf("offline page=%#v err=%v", cachedPage, err)
	}
}

func TestRealWebBotLostAdmissionAcknowledgementReconcilesAfterWorkerRestart(t *testing.T) {
	answer := "authoritative answer after every admission acknowledgement was lost"
	botBaseURL, botDBPath, botPython, _ := startDeterministicBotProcess(t, answer)
	proxyURL, dropped := startLostAdmissionAcknowledgementProxy(t, botBaseURL)
	t.Setenv("PHYTOMNI_API_SERVICE_TOKEN", "cross-service-token")
	previousBotConfig := rxBot.BotConfig
	rxBot.BotConfig = &rxBot.Config{BaseURL: proxyURL, ProxyEnabled: true, TimeoutSeconds: 5}
	t.Cleanup(func() { rxBot.BotConfig = previousBotConfig })

	setupExecutionRuntimeV2DB(t)
	ctx := context.Background()
	executionID := "turn-real-lost-admission-ack"
	admitted, err := NewService().admitExecutionCommand(
		ctx, "alice",
		QueryInput{
			Query: "Explain rice tillering after a lost acknowledgement.",
			Mode:  "instant", Tool: "ChatAgent", ClientTurnID: executionID,
			Locale: "en-US",
		},
		v1SubmissionTarget{dialogueID: "dialogue-lost-ack", mode: "instant", operation: "append"},
		AgentPermissionResolution{AllowedTools: []string{"ChatAgent"}}, false, "chat",
	)
	if err != nil {
		t.Fatal(err)
	}
	if err := model.DB(ctx).Model(&model.QuestionAgentExecutionOutbox{}).
		Where("execution_id = ?", executionID).
		Updates(map[string]any{
			"attempts":        executionDispatchMaxAttempts - 1,
			"next_attempt_at": time.Date(2000, 1, 1, 0, 0, 0, 0, time.UTC),
		}).Error; err != nil {
		t.Fatal(err)
	}
	dispatchStats, err := NewService().DispatchExecutionOutboxOnce(ctx, "lost-ack-dispatcher")
	if err != nil || dispatchStats.Reconciled != 1 || dropped.Load() != 1 {
		t.Fatalf("dispatch stats=%#v dropped=%d err=%v", dispatchStats, dropped.Load(), err)
	}
	var beforeRecovery model.QuestionAgentExecutionAdmission
	if err := model.DB(ctx).Where("execution_id = ?", executionID).Take(&beforeRecovery).Error; err != nil {
		t.Fatal(err)
	}
	if beforeRecovery.BotRunID != nil || beforeRecovery.TerminalStatus != nil || beforeRecovery.Status == "failed" {
		t.Fatalf("lost acknowledgement fabricated Web terminal state: %#v", beforeRecovery)
	}

	// Recreate the service on every pass: no in-memory dispatcher/projector
	// state may be required after the acknowledgement is lost.
	deadline := time.Now().Add(20 * time.Second)
	for {
		if err := model.DB(ctx).Model(&model.QuestionAgentExecutionAdmission{}).
			Where("execution_id = ?", executionID).
			Updates(map[string]any{
				"next_projection_at":     time.Now().UTC().Add(-time.Second),
				"projection_lease_owner": nil, "projection_lease_until": nil,
			}).Error; err != nil {
			t.Fatal(err)
		}
		_, _ = NewService().ProjectExecutionsOnce(ctx)
		var row model.QuestionAgentExecutionAdmission
		if err := model.DB(ctx).Where("execution_id = ?", executionID).Take(&row).Error; err != nil {
			t.Fatal(err)
		}
		if row.TerminalStatus != nil {
			if row.BotRunID == nil || *row.BotRunID == "" || *row.TerminalStatus != "succeeded" {
				t.Fatalf("invalid reconciled admission: %#v", row)
			}
			break
		}
		if time.Now().After(deadline) {
			t.Fatalf("lost-ack recovery did not converge: %#v db=%s", row, botDatabaseDiagnostics(botPython, botDBPath, executionID))
		}
		time.Sleep(50 * time.Millisecond)
	}

	var assistant model.ConversationMessageV2
	if err := model.DB(ctx).Where("execution_id = ? AND role = ?", executionID, "assistant").Take(&assistant).Error; err != nil {
		t.Fatal(err)
	}
	if assistant.MessageID != admitted.assistantMessageID || assistant.Content != answer || assistant.Status != "succeeded" {
		t.Fatalf("assistant did not converge: %#v", assistant)
	}
	fields := strings.Fields(botLostAckIntegrityDiagnostics(botPython, botDBPath, executionID))
	if len(fields) < 3 || fields[0] != "1" || fields[1] != "1" || fields[2] != "1" {
		t.Fatalf("lost-ack duplicated Bot authority or terminal fact: %v", fields)
	}
}

func TestRealWebBotOutageRecoversWithoutBrowserConnection(t *testing.T) {
	answer := "answer projected after Bot recovered"
	baseURL, _, _, _ := startDeterministicBotProcess(t, answer)
	t.Setenv("PHYTOMNI_API_SERVICE_TOKEN", "cross-service-token")
	previousBotConfig := rxBot.BotConfig
	t.Cleanup(func() { rxBot.BotConfig = previousBotConfig })

	closedListener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	closedURL := "http://" + closedListener.Addr().String()
	_ = closedListener.Close()
	rxBot.BotConfig = &rxBot.Config{BaseURL: closedURL, ProxyEnabled: true, TimeoutSeconds: 1}

	setupExecutionRuntimeV2DB(t)
	ctx := context.Background()
	executionID := "turn-real-cross-service-outage"
	input := QueryInput{
		Query: "Explain recovery without an attached browser.", Mode: "instant", Tool: "ChatAgent",
		ClientTurnID: executionID, Locale: "en-US",
	}
	target := v1SubmissionTarget{dialogueID: "dialogue-cross-service-outage", mode: "instant", operation: "append"}
	admitted, err := NewService().admitExecutionCommand(
		ctx, "alice", input, target,
		AgentPermissionResolution{AllowedTools: []string{"ChatAgent"}}, false, "chat",
	)
	if err != nil {
		t.Fatal(err)
	}
	if err := model.DB(ctx).Model(&model.QuestionAgentExecutionOutbox{}).
		Where("execution_id = ?", executionID).
		Update("next_attempt_at", time.Date(2000, 1, 1, 0, 0, 0, 0, time.UTC)).Error; err != nil {
		t.Fatal(err)
	}
	stats, err := NewService().DispatchExecutionOutboxOnce(ctx, "outage-dispatcher")
	if err != nil || stats.Retried != 1 {
		t.Fatalf("outage dispatch stats=%#v err=%v", stats, err)
	}
	var duringOutage model.QuestionAgentExecutionAdmission
	if err := model.DB(ctx).Where("execution_id = ?", executionID).Take(&duringOutage).Error; err != nil {
		t.Fatal(err)
	}
	if duringOutage.TerminalStatus != nil || duringOutage.BotRunID != nil || duringOutage.Status != "admitted" {
		t.Fatalf("Bot outage terminalized admission: %#v", duringOutage)
	}
	var outageOutbox model.QuestionAgentExecutionOutbox
	if err := model.DB(ctx).Where("execution_id = ?", executionID).Take(&outageOutbox).Error; err != nil {
		t.Fatal(err)
	}
	if outageOutbox.Classification == nil || *outageOutbox.Classification != "retry" ||
		outageOutbox.BoundaryState == nil || *outageOutbox.BoundaryState != "entered" {
		t.Fatalf("Bot outage classification=%#v", outageOutbox)
	}

	// Recovery is driven solely by durable workers. No stream or browser
	// connection is created during either dispatch or projection.
	rxBot.BotConfig = &rxBot.Config{BaseURL: baseURL, ProxyEnabled: true, TimeoutSeconds: 5}
	if err := model.DB(ctx).Model(&model.QuestionAgentExecutionOutbox{}).
		Where("execution_id = ?", executionID).
		Update("next_attempt_at", time.Date(2000, 1, 1, 0, 0, 0, 0, time.UTC)).Error; err != nil {
		t.Fatal(err)
	}
	stats, err = NewService().DispatchExecutionOutboxOnce(ctx, "recovered-dispatcher")
	if err != nil || stats.Acknowledged != 1 {
		t.Fatalf("recovered dispatch stats=%#v err=%v", stats, err)
	}

	deadline := time.Now().Add(20 * time.Second)
	for {
		if err := model.DB(ctx).Model(&model.QuestionAgentExecutionAdmission{}).
			Where("execution_id = ?", executionID).
			Updates(map[string]any{
				"next_projection_at":     time.Now().UTC().Add(-time.Second),
				"projection_lease_owner": nil,
				"projection_lease_until": nil,
			}).Error; err != nil {
			t.Fatal(err)
		}
		if _, err := NewService().ProjectExecutionsOnce(ctx); err != nil {
			t.Fatal(err)
		}
		var row model.QuestionAgentExecutionAdmission
		if err := model.DB(ctx).Where("execution_id = ?", executionID).Take(&row).Error; err != nil {
			t.Fatal(err)
		}
		if row.TerminalStatus != nil {
			if *row.TerminalStatus != "succeeded" || row.BotRunID == nil {
				t.Fatalf("recovered projection=%#v", row)
			}
			break
		}
		if time.Now().After(deadline) {
			t.Fatalf("Bot recovery did not converge: %#v", row)
		}
		time.Sleep(20 * time.Millisecond)
	}
	var assistant model.ConversationMessageV2
	if err := model.DB(ctx).Where("execution_id = ? AND role = ?", executionID, "assistant").Take(&assistant).Error; err != nil {
		t.Fatal(err)
	}
	if assistant.MessageID != admitted.assistantMessageID || assistant.Content != answer || assistant.Status != "succeeded" {
		t.Fatalf("recovered assistant mismatch: %#v", assistant)
	}
}

func TestRealWebBotProviderRetryConvergesWithoutDuplicateExecution(t *testing.T) {
	t.Setenv("PHYTOMNI_CROSS_SERVICE_PROVIDER_FAILURES", "1")
	answer := "retry recovered answer"
	baseURL, botDBPath, botPython, _ := startDeterministicBotProcess(t, answer)
	t.Setenv("PHYTOMNI_API_SERVICE_TOKEN", "cross-service-token")
	previousBotConfig := rxBot.BotConfig
	rxBot.BotConfig = &rxBot.Config{BaseURL: baseURL, ProxyEnabled: true, TimeoutSeconds: 5}
	t.Cleanup(func() { rxBot.BotConfig = previousBotConfig })

	setupExecutionRuntimeV2DB(t)
	ctx := context.Background()
	executionID := "turn-real-cross-service-retry"
	input := QueryInput{
		Query: "Explain rice tillering after a transient failure.", Mode: "instant", Tool: "ChatAgent",
		ClientTurnID: executionID, Locale: "en-US",
	}
	target := v1SubmissionTarget{dialogueID: "dialogue-cross-service-retry", mode: "instant", operation: "append"}
	admitted, err := NewService().admitExecutionCommand(
		ctx, "alice", input, target,
		AgentPermissionResolution{AllowedTools: []string{"ChatAgent"}}, false, "chat",
	)
	if err != nil {
		t.Fatal(err)
	}
	if err := model.DB(ctx).Model(&model.QuestionAgentExecutionOutbox{}).
		Where("execution_id = ?", executionID).
		Update("next_attempt_at", time.Date(2000, 1, 1, 0, 0, 0, 0, time.UTC)).Error; err != nil {
		t.Fatal(err)
	}
	stats, err := NewService().DispatchExecutionOutboxOnce(ctx, "real-cross-service-retry-dispatcher")
	if err != nil || stats.Acknowledged != 1 {
		t.Fatalf("dispatch stats=%#v err=%v", stats, err)
	}

	client := rxBot.NewClientWithTimeout(5 * time.Second)
	deadline := time.Now().Add(20 * time.Second)
	for {
		snapshot, _, snapshotErr := client.GetExecutionSnapshotV2(ctx, "alice", executionID)
		if snapshotErr == nil && snapshot.Terminal != nil {
			if snapshot.Status != "succeeded" {
				t.Fatalf("Bot terminal snapshot=%#v", snapshot)
			}
			break
		}
		if time.Now().After(deadline) {
			diagnostics := botDatabaseDiagnostics(botPython, botDBPath, executionID)
			t.Fatalf("Bot did not finish retry: snapshot=%#v err=%v db=%s", snapshot, snapshotErr, diagnostics)
		}
		time.Sleep(50 * time.Millisecond)
	}

	projectionDeadline := time.Now().Add(20 * time.Second)
	for {
		if err := model.DB(ctx).Model(&model.QuestionAgentExecutionAdmission{}).
			Where("execution_id = ?", executionID).
			Updates(map[string]any{"next_projection_at": time.Now().UTC().Add(-time.Second), "projection_lease_owner": nil, "projection_lease_until": nil}).Error; err != nil {
			t.Fatal(err)
		}
		if _, err := NewService().ProjectExecutionsOnce(ctx); err != nil {
			t.Fatal(err)
		}
		var row model.QuestionAgentExecutionAdmission
		if err := model.DB(ctx).Where("execution_id = ?", executionID).Take(&row).Error; err != nil {
			t.Fatal(err)
		}
		if row.TerminalStatus != nil {
			break
		}
		if time.Now().After(projectionDeadline) {
			t.Fatalf("Web retry projection did not converge: %#v", row)
		}
		time.Sleep(20 * time.Millisecond)
	}

	page, err := NewService().ExecutionEventsPageV2(ctx, "alice", executionID, 0, 200)
	if err != nil {
		t.Fatal(err)
	}
	counts := map[string]int{}
	for _, event := range page.Items {
		counts[event.Type]++
	}
	if counts["work_unit.retry_scheduled"] != 1 {
		t.Fatalf("retry facts=%#v, want exactly one scheduled retry", counts)
	}
	if counts["execution.started"] != 1 || counts["execution.succeeded"] != 1 {
		t.Fatalf("execution lifecycle duplicated: %#v", counts)
	}
	var admissionCount int64
	if err := model.DB(ctx).Model(&model.QuestionAgentExecutionAdmission{}).
		Where("execution_id = ?", executionID).Count(&admissionCount).Error; err != nil {
		t.Fatal(err)
	}
	if admissionCount != 1 {
		t.Fatalf("admission count=%d, want 1", admissionCount)
	}
	var assistant model.ConversationMessageV2
	if err := model.DB(ctx).Where("execution_id = ? AND role = ?", executionID, "assistant").Take(&assistant).Error; err != nil {
		t.Fatal(err)
	}
	if assistant.MessageID != admitted.assistantMessageID || assistant.Content != answer || assistant.Status != "succeeded" {
		t.Fatalf("retry assistant mismatch: %#v", assistant)
	}
}

func TestRealWebBotBestEffortCancellationPreservesLateTerminalResult(t *testing.T) {
	t.Setenv("PHYTOMNI_CROSS_SERVICE_PROVIDER_DELAY_MS", "1500")
	answer := "late answer after best-effort cancellation"
	baseURL, _, _, _ := startDeterministicBotProcess(t, answer)
	t.Setenv("PHYTOMNI_API_SERVICE_TOKEN", "cross-service-token")
	previousBotConfig := rxBot.BotConfig
	rxBot.BotConfig = &rxBot.Config{BaseURL: baseURL, ProxyEnabled: true, TimeoutSeconds: 5}
	t.Cleanup(func() { rxBot.BotConfig = previousBotConfig })

	setupExecutionRuntimeV2DB(t)
	ctx := context.Background()
	executionID := "turn-real-cross-service-cancel"
	input := QueryInput{
		Query: "Explain rice tillering slowly.", Mode: "instant", Tool: "ChatAgent",
		ClientTurnID: executionID, Locale: "en-US",
	}
	target := v1SubmissionTarget{dialogueID: "dialogue-cross-service-cancel", mode: "instant", operation: "append"}
	if _, err := NewService().admitExecutionCommand(
		ctx, "alice", input, target,
		AgentPermissionResolution{AllowedTools: []string{"ChatAgent"}}, false, "chat",
	); err != nil {
		t.Fatal(err)
	}
	if err := model.DB(ctx).Model(&model.QuestionAgentExecutionOutbox{}).
		Where("execution_id = ?", executionID).
		Update("next_attempt_at", time.Date(2000, 1, 1, 0, 0, 0, 0, time.UTC)).Error; err != nil {
		t.Fatal(err)
	}
	stats, err := NewService().DispatchExecutionOutboxOnce(ctx, "real-cross-service-cancel-dispatcher")
	if err != nil || stats.Acknowledged != 1 {
		t.Fatalf("dispatch stats=%#v err=%v", stats, err)
	}

	client := rxBot.NewClientWithTimeout(5 * time.Second)
	runningDeadline := time.Now().Add(10 * time.Second)
	var operationRevision int64
	for {
		snapshot, _, snapshotErr := client.GetExecutionSnapshotV2(ctx, "alice", executionID)
		if snapshotErr == nil && snapshot.Status == "running" && snapshot.Terminal == nil {
			operationRevision = snapshot.OperationRevision
			break
		}
		if snapshotErr == nil && snapshot.Terminal != nil {
			t.Fatalf("provider completed before cancellation: %#v", snapshot)
		}
		if time.Now().After(runningDeadline) {
			t.Fatalf("execution never reached cancellable running state: snapshot=%#v err=%v", snapshot, snapshotErr)
		}
		time.Sleep(20 * time.Millisecond)
	}
	cancelled, err := NewService().ExecutionCancelV2(
		ctx,
		"alice",
		executionID,
		rxBot.ExecutionCancelRequestV2{
			RequestID:        "cancel-real-cross-service",
			ExpectedRevision: operationRevision,
			Reason:           "user_requested",
		},
	)
	if err != nil {
		t.Fatal(err)
	}
	if cancelled.CancellationOutcome != "best_effort" || cancelled.Status != "running" {
		t.Fatalf("cancellation response=%#v", cancelled)
	}

	terminalDeadline := time.Now().Add(20 * time.Second)
	for {
		snapshot, _, snapshotErr := client.GetExecutionSnapshotV2(ctx, "alice", executionID)
		if snapshotErr == nil && snapshot.Terminal != nil {
			if snapshot.Status != "succeeded" {
				t.Fatalf("late provider outcome did not settle truthfully: %#v", snapshot)
			}
			break
		}
		if time.Now().After(terminalDeadline) {
			t.Fatalf("late provider result did not settle: snapshot=%#v err=%v", snapshot, snapshotErr)
		}
		time.Sleep(50 * time.Millisecond)
	}
	page, err := NewService().ExecutionEventsPageV2(ctx, "alice", executionID, 0, 200)
	if err != nil {
		t.Fatal(err)
	}
	counts := map[string]int{}
	cancellationOutcomes := map[string]int{}
	for _, event := range page.Items {
		counts[event.Type]++
		if event.Type == "execution.cancellation_requested" {
			if outcome, ok := event.PublicPayload["outcome"].(string); ok {
				cancellationOutcomes[outcome]++
			}
		}
	}
	if counts["execution.cancellation_requested"] != 2 || cancellationOutcomes["requested"] != 1 || cancellationOutcomes["best_effort"] != 1 || counts["execution.succeeded"] != 1 || counts["execution.cancelled"] != 0 {
		t.Fatalf("best-effort cancellation lifecycle=%#v outcomes=%#v", counts, cancellationOutcomes)
	}
}

func TestRealWebBotLifecycleOutcomeProjectionMatrix(t *testing.T) {
	tests := []struct {
		name           string
		scenario       string
		status         string
		eventType      string
		trackingHealth string
		terminal       bool
		inputRequired  bool
	}{
		{name: "partial", scenario: "partial", status: "partial", eventType: "execution.partial", trackingHealth: "healthy", terminal: true},
		{name: "timed_out", scenario: "timed_out", status: "timed_out", eventType: "execution.timed_out", trackingHealth: "healthy", terminal: true},
		{name: "degraded", scenario: "degraded", status: "running", eventType: "tracking.degraded", trackingHealth: "degraded"},
		{name: "waiting_input", scenario: "waiting_input", status: "waiting_input", eventType: "input.required", trackingHealth: "healthy", inputRequired: true},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			t.Setenv("PHYTOMNI_CROSS_SERVICE_SCENARIO", test.scenario)
			baseURL, botDBPath, botPython, stopBot := startDeterministicBotProcess(t, "scenario answer")
			t.Setenv("PHYTOMNI_API_SERVICE_TOKEN", "cross-service-token")
			previousBotConfig := rxBot.BotConfig
			rxBot.BotConfig = &rxBot.Config{BaseURL: baseURL, ProxyEnabled: true, TimeoutSeconds: 5}
			t.Cleanup(func() { rxBot.BotConfig = previousBotConfig })

			setupExecutionRuntimeV2DB(t)
			ctx := context.Background()
			executionID := "turn-real-cross-service-" + test.name
			input := QueryInput{
				Query: "Exercise the " + test.name + " lifecycle.", Mode: "instant", Tool: "ChatAgent",
				ClientTurnID: executionID, Locale: "en-US",
			}
			target := v1SubmissionTarget{dialogueID: "dialogue-" + test.name, mode: "instant", operation: "append"}
			if _, err := NewService().admitExecutionCommand(
				ctx, "alice", input, target,
				AgentPermissionResolution{AllowedTools: []string{"ChatAgent"}}, false, "chat",
			); err != nil {
				t.Fatal(err)
			}
			if err := model.DB(ctx).Model(&model.QuestionAgentExecutionOutbox{}).
				Where("execution_id = ?", executionID).
				Update("next_attempt_at", time.Date(2000, 1, 1, 0, 0, 0, 0, time.UTC)).Error; err != nil {
				t.Fatal(err)
			}
			stats, err := NewService().DispatchExecutionOutboxOnce(ctx, "lifecycle-matrix-"+test.name)
			if err != nil || stats.Acknowledged != 1 {
				t.Fatalf("dispatch stats=%#v err=%v", stats, err)
			}

			client := rxBot.NewClientWithTimeout(5 * time.Second)
			deadline := time.Now().Add(20 * time.Second)
			var botSnapshot *rxBot.ExecutionProjectionV2
			for {
				snapshot, _, snapshotErr := client.GetExecutionSnapshotV2(ctx, "alice", executionID)
				if snapshotErr == nil && snapshot.Status == test.status && snapshot.TrackingHealth == test.trackingHealth && (snapshot.Terminal != nil) == test.terminal && (!test.inputRequired || snapshot.InputRequired != nil) {
					botSnapshot = snapshot
					break
				}
				if time.Now().After(deadline) {
					diagnostics := botDatabaseDiagnostics(botPython, botDBPath, executionID)
					t.Fatalf("Bot lifecycle did not converge: snapshot=%#v err=%v db=%s", snapshot, snapshotErr, diagnostics)
				}
				time.Sleep(25 * time.Millisecond)
			}

			page, err := NewService().ExecutionEventsPageV2(ctx, "alice", executionID, 0, 200)
			if err != nil {
				t.Fatal(err)
			}
			foundExpectedEvent := false
			for _, event := range page.Items {
				foundExpectedEvent = foundExpectedEvent || event.Type == test.eventType
			}
			if !foundExpectedEvent {
				t.Fatalf("missing %q in real Bot facts: %#v", test.eventType, page.Items)
			}

			projectionDeadline := time.Now().Add(20 * time.Second)
			for {
				if err := model.DB(ctx).Model(&model.QuestionAgentExecutionAdmission{}).
					Where("execution_id = ?", executionID).
					Updates(map[string]any{"next_projection_at": time.Now().UTC().Add(-time.Second), "projection_lease_owner": nil, "projection_lease_until": nil}).Error; err != nil {
					t.Fatal(err)
				}
				if _, err := NewService().ProjectExecutionsOnce(ctx); err != nil {
					t.Fatal(err)
				}
				var admission model.QuestionAgentExecutionAdmission
				if err := model.DB(ctx).Where("execution_id = ?", executionID).Take(&admission).Error; err != nil {
					t.Fatal(err)
				}
				if admission.Status == test.status && admission.TrackingHealth == test.trackingHealth && (admission.TerminalStatus != nil) == test.terminal && admission.DispatchRevision == botSnapshot.OperationRevision {
					break
				}
				if time.Now().After(projectionDeadline) {
					t.Fatalf("Web lifecycle projection did not converge: %#v", admission)
				}
				time.Sleep(20 * time.Millisecond)
			}

			stopBot()
			cached, err := NewService().ExecutionSnapshotV2(ctx, "alice", executionID)
			if err != nil || !cached.Stale || cached.Source != "web_cache" || cached.Status != test.status || cached.TrackingHealth != test.trackingHealth || (cached.Terminal != nil) != test.terminal || (cached.InputRequired != nil) != test.inputRequired {
				t.Fatalf("cached lifecycle snapshot=%#v err=%v", cached, err)
			}
		})
	}
}

func TestRealWebBotInputActionResumesAndRedactsPayload(t *testing.T) {
	t.Setenv("PHYTOMNI_CROSS_SERVICE_SCENARIO", "waiting_input")
	baseURL, botDBPath, botPython, _ := startDeterministicBotProcess(t, "resumed answer")
	t.Setenv("PHYTOMNI_API_SERVICE_TOKEN", "cross-service-token")
	previousBotConfig := rxBot.BotConfig
	rxBot.BotConfig = &rxBot.Config{BaseURL: baseURL, ProxyEnabled: true, TimeoutSeconds: 5}
	t.Cleanup(func() { rxBot.BotConfig = previousBotConfig })

	setupExecutionRuntimeV2DB(t)
	ctx := context.Background()
	executionID := "turn-real-cross-service-input-resume"
	input := QueryInput{
		Query: "Pause and resume this analysis.", Mode: "instant", Tool: "ChatAgent",
		ClientTurnID: executionID, Locale: "en-US",
	}
	target := v1SubmissionTarget{dialogueID: "dialogue-input-resume", mode: "instant", operation: "append"}
	if _, err := NewService().admitExecutionCommand(
		ctx, "alice", input, target,
		AgentPermissionResolution{AllowedTools: []string{"ChatAgent"}}, false, "chat",
	); err != nil {
		t.Fatal(err)
	}
	if err := model.DB(ctx).Model(&model.QuestionAgentExecutionOutbox{}).
		Where("execution_id = ?", executionID).
		Update("next_attempt_at", time.Date(2000, 1, 1, 0, 0, 0, 0, time.UTC)).Error; err != nil {
		t.Fatal(err)
	}
	stats, err := NewService().DispatchExecutionOutboxOnce(ctx, "input-resume-dispatcher")
	if err != nil || stats.Acknowledged != 1 {
		t.Fatalf("dispatch stats=%#v err=%v", stats, err)
	}

	client := rxBot.NewClientWithTimeout(5 * time.Second)
	deadline := time.Now().Add(20 * time.Second)
	var waiting *rxBot.ExecutionProjectionV2
	for {
		snapshot, _, snapshotErr := client.GetExecutionSnapshotV2(ctx, "alice", executionID)
		if snapshotErr == nil && snapshot.Status == "waiting_input" && snapshot.InputRequired != nil {
			waiting = snapshot
			break
		}
		if time.Now().After(deadline) {
			diagnostics := botDatabaseDiagnostics(botPython, botDBPath, executionID)
			t.Fatalf("execution did not pause for input: snapshot=%#v err=%v db=%s", snapshot, snapshotErr, diagnostics)
		}
		time.Sleep(25 * time.Millisecond)
	}

	const privateInput = "private-input-must-not-enter-public-journal"
	operation, err := NewService().ExecutionActionV2(
		ctx,
		"alice",
		executionID,
		rxBot.ExecutionActionRequestV2{
			ActionID:         "input-action-1",
			ExpectedRevision: waiting.OperationRevision,
			SurfaceID:        waiting.InputRequired.SurfaceID,
			Widget:           waiting.InputRequired.Widget,
			Payload:          map[string]any{"accepted": true, "comment": privateInput},
		},
	)
	if err != nil {
		t.Fatalf("resume input: %v diagnostics=%s", err, botDatabaseDiagnostics(botPython, botDBPath, executionID))
	}
	if operation.Status != "succeeded" || operation.SupervisorRevision <= waiting.OperationRevision {
		t.Fatalf("resume operation=%#v waiting=%#v", operation, waiting)
	}

	terminalDeadline := time.Now().Add(20 * time.Second)
	for {
		snapshot, _, snapshotErr := client.GetExecutionSnapshotV2(ctx, "alice", executionID)
		if snapshotErr == nil && snapshot.Status == "succeeded" && snapshot.Terminal != nil && snapshot.InputRequired == nil {
			break
		}
		if time.Now().After(terminalDeadline) {
			t.Fatalf("resumed execution did not settle: snapshot=%#v err=%v", snapshot, snapshotErr)
		}
		time.Sleep(25 * time.Millisecond)
	}

	page, err := NewService().ExecutionEventsPageV2(ctx, "alice", executionID, 0, 200)
	if err != nil {
		t.Fatal(err)
	}
	counts := map[string]int{}
	for _, event := range page.Items {
		counts[event.Type]++
	}
	encoded, err := json.Marshal(page.Items)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(encoded), privateInput) {
		t.Fatalf("submitted input leaked into public facts: %s", encoded)
	}
	for _, eventType := range []string{"input.required", "input.action_claimed", "execution.resumed", "input.resolved", "execution.succeeded"} {
		if counts[eventType] != 1 {
			t.Fatalf("input lifecycle count[%q]=%d facts=%#v", eventType, counts[eventType], counts)
		}
	}

	projectionDeadline := time.Now().Add(20 * time.Second)
	for {
		if err := model.DB(ctx).Model(&model.QuestionAgentExecutionAdmission{}).
			Where("execution_id = ?", executionID).
			Updates(map[string]any{"next_projection_at": time.Now().UTC().Add(-time.Second), "projection_lease_owner": nil, "projection_lease_until": nil}).Error; err != nil {
			t.Fatal(err)
		}
		if _, err := NewService().ProjectExecutionsOnce(ctx); err != nil {
			t.Fatal(err)
		}
		var admission model.QuestionAgentExecutionAdmission
		if err := model.DB(ctx).Where("execution_id = ?", executionID).Take(&admission).Error; err != nil {
			t.Fatal(err)
		}
		if admission.Status == "succeeded" && admission.TerminalStatus != nil && admission.DispatchRevision == operation.SupervisorRevision {
			break
		}
		if time.Now().After(projectionDeadline) {
			t.Fatalf("resumed Web projection did not converge: %#v", admission)
		}
		time.Sleep(20 * time.Millisecond)
	}
}

func TestRealWebBotParallelSiblingWorkOverlaps(t *testing.T) {
	t.Setenv("PHYTOMNI_CROSS_SERVICE_TOPOLOGY", "parallel")
	baseURL, botDBPath, botPython, _ := startDeterministicBotProcess(t, "parallel answer")
	t.Setenv("PHYTOMNI_API_SERVICE_TOKEN", "cross-service-token")
	previousBotConfig := rxBot.BotConfig
	rxBot.BotConfig = &rxBot.Config{BaseURL: baseURL, ProxyEnabled: true, TimeoutSeconds: 5}
	t.Cleanup(func() { rxBot.BotConfig = previousBotConfig })

	setupExecutionRuntimeV2DB(t)
	ctx := context.Background()
	executionID := "turn-real-cross-service-parallel"
	input := QueryInput{
		Query: "Run two independent evidence branches.", Mode: "instant", Tool: "ChatAgent",
		ClientTurnID: executionID, Locale: "en-US",
	}
	target := v1SubmissionTarget{dialogueID: "dialogue-parallel", mode: "instant", operation: "append"}
	if _, err := NewService().admitExecutionCommand(
		ctx, "alice", input, target,
		AgentPermissionResolution{AllowedTools: []string{"ChatAgent"}}, false, "chat",
	); err != nil {
		t.Fatal(err)
	}
	if err := model.DB(ctx).Model(&model.QuestionAgentExecutionOutbox{}).
		Where("execution_id = ?", executionID).
		Update("next_attempt_at", time.Date(2000, 1, 1, 0, 0, 0, 0, time.UTC)).Error; err != nil {
		t.Fatal(err)
	}
	stats, err := NewService().DispatchExecutionOutboxOnce(ctx, "parallel-dispatcher")
	if err != nil || stats.Acknowledged != 1 {
		t.Fatalf("dispatch stats=%#v err=%v", stats, err)
	}

	client := rxBot.NewClientWithTimeout(5 * time.Second)
	deadline := time.Now().Add(20 * time.Second)
	for {
		snapshot, _, snapshotErr := client.GetExecutionSnapshotV2(ctx, "alice", executionID)
		if snapshotErr == nil && snapshot.Status == "succeeded" && snapshot.Terminal != nil {
			break
		}
		if time.Now().After(deadline) {
			diagnostics := botDatabaseDiagnostics(botPython, botDBPath, executionID)
			t.Fatalf("parallel execution did not settle: snapshot=%#v err=%v db=%s", snapshot, snapshotErr, diagnostics)
		}
		time.Sleep(25 * time.Millisecond)
	}

	page, err := NewService().ExecutionEventsPageV2(ctx, "alice", executionID, 0, 200)
	if err != nil {
		t.Fatal(err)
	}
	starts := map[string]int64{}
	successes := map[string]int64{}
	parents := map[string]struct{}{}
	for _, event := range page.Items {
		operationKey, _ := event.PublicPayload["operation_key"].(string)
		if operationKey != "review.retrieve_dimension" || event.WorkUnitID == nil {
			continue
		}
		switch event.Type {
		case "work_unit.attempt_started":
			starts[*event.WorkUnitID] = event.Seq
			if event.ParentSpanID != nil {
				parents[*event.ParentSpanID] = struct{}{}
			}
		case "work_unit.succeeded":
			successes[*event.WorkUnitID] = event.Seq
		}
	}
	if len(starts) != 2 || len(successes) != 2 || len(parents) != 1 {
		t.Fatalf("parallel sibling facts starts=%#v successes=%#v parents=%#v", starts, successes, parents)
	}
	latestStart := int64(0)
	firstSuccess := int64(1<<63 - 1)
	for _, seq := range starts {
		if seq > latestStart {
			latestStart = seq
		}
	}
	for _, seq := range successes {
		if seq < firstSuccess {
			firstSuccess = seq
		}
	}
	if latestStart >= firstSuccess {
		t.Fatalf("siblings did not overlap: starts=%#v successes=%#v", starts, successes)
	}
}

func TestRealWebBotCanonicalHandlerMatrix(t *testing.T) {
	tests := []struct {
		name        string
		agentSlug   string
		tool        string
		query       string
		status      string
		geneID      string
		toID        string
		speciesCode string
	}{
		{name: "chat", agentSlug: "chat", tool: "ChatAgent", query: "Explain rice tillering.", status: "succeeded"},
		{name: "knowledge", agentSlug: "knowledge", tool: "KnowledgeAgent", query: "Find rice tillering evidence.", status: "succeeded"},
		{name: "data", agentSlug: "data", tool: "DataAgent", query: "Count rice genes.", status: "succeeded"},
		{name: "review", agentSlug: "review", tool: "ReviewAgent", query: "Review rice tillering.", status: "succeeded"},
		{name: "brief_gene", agentSlug: "brief_gene", tool: "BriefGeneAgent", query: "Os01g0177400", status: "succeeded"},
		{name: "analyst", agentSlug: "analyst", tool: "AnalystAgent", query: "Analyze one characterized dataset.", status: "running"},
		{name: "deep_genome", agentSlug: "deep_genome", tool: "DeepGenomeAgent", query: "Analyze Os01g0177400.", status: "running", geneID: "Os01g0177400", speciesCode: "osa"},
		{name: "research", agentSlug: "research", tool: "InSilicoResearchAgent", query: "Reproduce the characterized study.", status: "running"},
		{name: "design", agentSlug: "design", tool: "DigitalDesignAgent", query: "Design Os01g0177400.", status: "running", geneID: "Os01g0177400", speciesCode: "osa"},
		{name: "network", agentSlug: "network", tool: "GeneNetworkAgent", query: "Analyze the hormone network for TO:0000011.", status: "running", toID: "TO:0000011", speciesCode: "osa"},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			t.Setenv("PHYTOMNI_CROSS_SERVICE_AGENT", test.agentSlug)
			baseURL, botDBPath, botPython, _ := startDeterministicBotProcess(t, "canonical handler answer")
			t.Setenv("PHYTOMNI_API_SERVICE_TOKEN", "cross-service-token")
			previousBotConfig := rxBot.BotConfig
			rxBot.BotConfig = &rxBot.Config{BaseURL: baseURL, ProxyEnabled: true, TimeoutSeconds: 5}
			t.Cleanup(func() { rxBot.BotConfig = previousBotConfig })

			setupExecutionRuntimeV2DB(t)
			ctx := context.Background()
			executionID := "turn-real-handler-" + test.name
			input := QueryInput{
				Query: test.query, Mode: "instant", Tool: test.tool,
				ClientTurnID: executionID, Locale: "en-US",
				GeneID: test.geneID, ToID: test.toID, SpeciesCode: test.speciesCode,
			}
			target := v1SubmissionTarget{dialogueID: "dialogue-handler-" + test.name, mode: "instant", operation: "append"}
			if _, err := NewService().admitExecutionCommand(
				ctx, "alice", input, target,
				AgentPermissionResolution{AllowedTools: []string{test.tool}}, false, test.agentSlug,
			); err != nil {
				t.Fatal(err)
			}
			if err := model.DB(ctx).Model(&model.QuestionAgentExecutionOutbox{}).
				Where("execution_id = ?", executionID).
				Update("next_attempt_at", time.Date(2000, 1, 1, 0, 0, 0, 0, time.UTC)).Error; err != nil {
				t.Fatal(err)
			}
			stats, err := NewService().DispatchExecutionOutboxOnce(ctx, "handler-matrix-"+test.name)
			if err != nil || stats.Acknowledged != 1 {
				var outbox model.QuestionAgentExecutionOutbox
				_ = model.DB(ctx).Where("execution_id = ?", executionID).Take(&outbox).Error
				var admission model.QuestionAgentExecutionAdmission
				_ = model.DB(ctx).Where("execution_id = ?", executionID).Take(&admission).Error
				errorCode := ""
				if outbox.LastErrorCode != nil {
					errorCode = *outbox.LastErrorCode
				}
				t.Fatalf("dispatch stats=%#v err=%v errorCode=%q outbox=%#v admission=%#v", stats, err, errorCode, outbox, admission)
			}

			client := rxBot.NewClientWithTimeout(5 * time.Second)
			deadline := time.Now().Add(15 * time.Second)
			var convergedPage *WebExecutionEventPageV2
			for {
				snapshot, _, snapshotErr := client.GetExecutionSnapshotV2(ctx, "alice", executionID)
				page, pageErr := NewService().ExecutionEventsPageV2(ctx, "alice", executionID, 0, 200)
				types := map[string]int{}
				if pageErr == nil {
					for _, event := range page.Items {
						types[event.Type]++
					}
				}
				terminalMatches := test.status == "running" && snapshot != nil && snapshot.Terminal == nil || test.status == "succeeded" && snapshot != nil && snapshot.Terminal != nil
				todoMatches := snapshot != nil && ((snapshot.TodoDeclared && types["todo.snapshot"] >= 1) || (!snapshot.TodoDeclared && types["todo.snapshot"] == 0))
				if snapshotErr == nil && snapshot.AgentSlug == test.agentSlug && snapshot.Status == test.status && terminalMatches && todoMatches && types["work_unit.attempt_started"] >= 1 && types["work_unit.succeeded"] >= 1 {
					convergedPage = page
					break
				}
				if time.Now().After(deadline) {
					diagnostics := botDatabaseDiagnostics(botPython, botDBPath, executionID)
					t.Fatalf("canonical handler did not converge: snapshot=%#v snapshotErr=%v pageErr=%v types=%#v db=%s", snapshot, snapshotErr, pageErr, types, diagnostics)
				}
				time.Sleep(25 * time.Millisecond)
			}
			if test.agentSlug == "chat" {
				assertChatSerialNestedTopology(t, convergedPage)
			}

			if err := model.DB(ctx).Model(&model.QuestionAgentExecutionAdmission{}).
				Where("execution_id = ?", executionID).
				Updates(map[string]any{"next_projection_at": time.Now().UTC().Add(-time.Second), "projection_lease_owner": nil, "projection_lease_until": nil}).Error; err != nil {
				t.Fatal(err)
			}
			if _, err := NewService().ProjectExecutionsOnce(ctx); err != nil {
				t.Fatal(err)
			}
			var admission model.QuestionAgentExecutionAdmission
			if err := model.DB(ctx).Where("execution_id = ?", executionID).Take(&admission).Error; err != nil {
				t.Fatal(err)
			}
			if admission.Status != test.status {
				t.Fatalf("Web projected status=%q, want %q", admission.Status, test.status)
			}
		})
	}
}

func TestRealWebBotExplicitExpertDesignConvergesAcrossReconnectAndRestart(t *testing.T) {
	t.Setenv("PHYTOMNI_CROSS_SERVICE_AGENT", "design")
	t.Setenv("PHYTOMNI_CROSS_SERVICE_PROVIDER_TERMINAL", "failed")
	temp := t.TempDir()
	botDBPath := filepath.Join(temp, "bot-runtime.sqlite")
	baseURL, _, botPython, stopBot := startDeterministicBotProcessAtPath(
		t, `{"gene_id":"Os01g0177400","species_code":"osa"}`, botDBPath,
	)
	t.Setenv("PHYTOMNI_API_SERVICE_TOKEN", "cross-service-token")
	previousBotConfig := rxBot.BotConfig
	rxBot.BotConfig = &rxBot.Config{BaseURL: baseURL, ProxyEnabled: true, TimeoutSeconds: 5}
	t.Cleanup(func() { rxBot.BotConfig = previousBotConfig })

	setupExecutionRuntimeV2DB(t)
	ctx := context.Background()
	executionID := "turn-real-expert-design"
	input := QueryInput{
		Query: "Please help me design the protein structure based on evolution information for gene Os01g0177400.",
		Mode:  "expert", Tool: "DigitalDesignAgent", ClientTurnID: executionID,
		Locale: "en-US", GeneID: "Os01g0177400", SpeciesCode: "osa",
	}
	target := v1SubmissionTarget{
		dialogueID: "018fdf9e-1f0b-7a63-a5a3-5e4625b43ad6", mode: "expert", operation: "append",
	}
	if _, err := NewService().admitExecutionCommand(
		ctx, "alice", input, target,
		AgentPermissionResolution{AllowedTools: []string{"DigitalDesignAgent"}}, true, "design",
	); err != nil {
		t.Fatal(err)
	}
	if err := model.DB(ctx).Model(&model.QuestionAgentExecutionOutbox{}).
		Where("execution_id = ?", executionID).
		Update("next_attempt_at", time.Date(2000, 1, 1, 0, 0, 0, 0, time.UTC)).Error; err != nil {
		t.Fatal(err)
	}
	stats, err := NewService().DispatchExecutionOutboxOnce(ctx, "expert-design-dispatcher")
	if err != nil || stats.Acknowledged != 1 {
		t.Fatalf("dispatch stats=%#v err=%v", stats, err)
	}

	client := rxBot.NewClientWithTimeout(5 * time.Second)
	deadline := time.Now().Add(30 * time.Second)
	var page *WebExecutionEventPageV2
	for {
		snapshot, _, snapshotErr := client.GetExecutionSnapshotV2(ctx, "alice", executionID)
		page, err = NewService().ExecutionEventsPageV2(ctx, "alice", executionID, 0, 200)
		if snapshotErr == nil && err == nil && snapshot.Terminal != nil && snapshot.LatestSeq > 0 {
			if snapshot.AgentSlug != "design" || snapshot.Status != "failed" {
				t.Fatalf("unexpected Design terminal snapshot: %#v", snapshot)
			}
			break
		}
		if time.Now().After(deadline) {
			t.Fatalf(
				"explicit Expert Design did not converge: snapshot=%#v snapshotErr=%v page=%#v pageErr=%v db=%s",
				snapshot, snapshotErr, page, err, botDatabaseDiagnostics(botPython, botDBPath, executionID),
			)
		}
		time.Sleep(50 * time.Millisecond)
	}
	counts := botExecutionIntegrityCounts(botPython, botDBPath, executionID)
	if len(counts) != 4 || strings.Join(counts, " ") != "1 1 1 1" {
		t.Fatalf(
			"Design execution authority/provider/terminal counts=%v page=%#v db=%s",
			counts, page, botDatabaseDiagnostics(botPython, botDBPath, executionID),
		)
	}
	if _, _, err := client.GetExecutionSnapshotV2(ctx, "mallory", executionID); err == nil {
		t.Fatal("wrong owner read the Design execution")
	}

	wantEventIDs := make([]string, 0, len(page.Items))
	for _, event := range page.Items {
		wantEventIDs = append(wantEventIDs, event.EventID)
	}
	reconnectCursor := page.Items[len(page.Items)/2].Seq
	wantReconnectIDs := make([]string, 0, len(page.Items))
	for _, event := range page.Items {
		if event.Seq > reconnectCursor {
			wantReconnectIDs = append(wantReconnectIDs, event.EventID)
		}
	}
	reconnectBody, _, err := NewService().executionRuntimeClient().OpenExecutionStreamV2(
		ctx, "alice", executionID, reconnectCursor, 0, 0,
	)
	if err != nil {
		t.Fatal(err)
	}
	gotReconnectIDs := parseExecutionEventIDs(t, reconnectBody)
	_ = reconnectBody.Close()
	if strings.Join(gotReconnectIDs, "\n") != strings.Join(wantReconnectIDs, "\n") {
		t.Fatalf("Design SSE reconnect drift\nwant=%v\ngot=%v", wantReconnectIDs, gotReconnectIDs)
	}

	stopBot()
	restartedURL, _, _, _ := startDeterministicBotProcessAtPath(
		t, `{"gene_id":"Os01g0177400","species_code":"osa"}`, botDBPath,
	)
	rxBot.BotConfig = &rxBot.Config{BaseURL: restartedURL, ProxyEnabled: true, TimeoutSeconds: 5}
	restartedClient := rxBot.NewClientWithTimeout(5 * time.Second)
	restartedSnapshot, _, err := restartedClient.GetExecutionSnapshotV2(ctx, "alice", executionID)
	if err != nil || restartedSnapshot.Terminal == nil || restartedSnapshot.Status != "failed" {
		t.Fatalf("restarted Design snapshot=%#v err=%v", restartedSnapshot, err)
	}
	restartedPage, err := NewService().ExecutionEventsPageV2(ctx, "alice", executionID, 0, 200)
	if err != nil {
		t.Fatal(err)
	}
	restartedIDs := make([]string, 0, len(restartedPage.Items))
	for _, event := range restartedPage.Items {
		restartedIDs = append(restartedIDs, event.EventID)
	}
	if strings.Join(restartedIDs, "\n") != strings.Join(wantEventIDs, "\n") {
		t.Fatalf("Design restart event drift\nwant=%v\ngot=%v", wantEventIDs, restartedIDs)
	}
	if counts = botExecutionIntegrityCounts(botPython, botDBPath, executionID); len(counts) != 4 || strings.Join(counts, " ") != "1 1 1 1" {
		t.Fatalf("Design execution duplicated after restart: %v", counts)
	}
}

func TestRealBotReconcilesPersistedLegacyExpertDesignWithoutDuplicateExecution(t *testing.T) {
	t.Setenv("PHYTOMNI_CROSS_SERVICE_AGENT", "design")
	t.Setenv("PHYTOMNI_CROSS_SERVICE_PROVIDER_TERMINAL", "failed")
	setupExecutionRuntimeV2DB(t)
	ctx := context.Background()
	executionID := "turn-legacy-stuck-expert-design"
	input := QueryInput{
		Query: "Please help me design the protein structure based on evolution information for gene Os01g0177400.",
		Mode:  "expert", Tool: "DigitalDesignAgent", ClientTurnID: executionID,
		Locale: "en-US", GeneID: "Os01g0177400", SpeciesCode: "osa",
	}
	target := v1SubmissionTarget{
		dialogueID: "018fdf9e-1f0b-7a63-a5a3-5e4625b43ae0", mode: "expert", operation: "append",
	}
	if _, err := NewService().admitExecutionCommand(
		ctx, "alice", input, target,
		AgentPermissionResolution{AllowedTools: []string{"DigitalDesignAgent"}}, true, "design",
	); err != nil {
		t.Fatal(err)
	}
	var outbox model.QuestionAgentExecutionOutbox
	if err := model.DB(ctx).Where("execution_id = ?", executionID).Take(&outbox).Error; err != nil {
		t.Fatal(err)
	}
	var durable canonicalMessageExecutionCommand
	if err := json.Unmarshal([]byte(outbox.CommandJSON), &durable); err != nil {
		t.Fatal(err)
	}
	arguments, err := botArgumentsForCommand(durable)
	if err != nil {
		t.Fatal(err)
	}
	fixture, err := json.Marshal(map[string]any{
		"owner_ref": "alice", "execution_id": executionID,
		"fingerprint_version": durable.FingerprintVersion,
		"fingerprint":         durable.Fingerprint, "agent_slug": "design",
		"arguments": arguments,
	})
	if err != nil {
		t.Fatal(err)
	}
	t.Setenv("PHYTOMNI_CROSS_SERVICE_LEGACY_STUCK", string(fixture))
	temp := t.TempDir()
	botDBPath := filepath.Join(temp, "bot-runtime.sqlite")
	baseURL, _, botPython, _ := startDeterministicBotProcessAtPath(
		t, `{"gene_id":"Os01g0177400","species_code":"osa"}`, botDBPath,
	)
	t.Setenv("PHYTOMNI_API_SERVICE_TOKEN", "cross-service-token")
	previousBotConfig := rxBot.BotConfig
	rxBot.BotConfig = &rxBot.Config{BaseURL: baseURL, ProxyEnabled: true, TimeoutSeconds: 5}
	t.Cleanup(func() { rxBot.BotConfig = previousBotConfig })

	client := rxBot.NewClientWithTimeout(5 * time.Second)
	deadline := time.Now().Add(30 * time.Second)
	var snapshot *rxBot.ExecutionProjectionV2
	for {
		snapshot, _, err = client.GetExecutionSnapshotV2(ctx, "alice", executionID)
		if err == nil && snapshot.Terminal != nil && snapshot.LatestSeq > 0 {
			break
		}
		if time.Now().After(deadline) {
			t.Fatalf(
				"legacy reconcile did not converge: snapshot=%#v err=%v db=%s",
				snapshot, err, botDatabaseDiagnostics(botPython, botDBPath, executionID),
			)
		}
		time.Sleep(50 * time.Millisecond)
	}
	if snapshot.Status != "failed" || snapshot.AgentSlug != "design" {
		t.Fatalf("unexpected legacy reconcile terminal snapshot: %#v", snapshot)
	}
	counts := botExecutionIntegrityCounts(botPython, botDBPath, executionID)
	if len(counts) != 4 || strings.Join(counts, " ") != "1 1 1 1" {
		t.Fatalf("legacy reconcile duplicated execution/provider/terminal: %v", counts)
	}
	reconcile := botReconcileDiagnostics(botPython, botDBPath, executionID)
	if len(reconcile) != 3 || reconcile[0] != "acknowledged" || reconcile[2] != "1" {
		t.Fatalf("legacy reconcile command did not use one fenced redispatch: %v", reconcile)
	}
	page, _, err := client.GetExecutionEventsV2(ctx, "alice", executionID, 0, 200)
	if err != nil {
		t.Fatal(err)
	}
	types := map[string]int{}
	for _, event := range page.Items {
		types[event.Type]++
	}
	if types["execution.started"] != 1 || types["execution.failed"] != 1 {
		t.Fatalf("legacy reconcile produced duplicate canonical facts: %#v", types)
	}
}
