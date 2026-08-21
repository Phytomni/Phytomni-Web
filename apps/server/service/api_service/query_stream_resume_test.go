package api_service

import (
	"context"
	"errors"
	"io"
	"strings"
	"sync"
	"testing"
	"time"

	rxBot "phytomni-server/external/bot"
	"phytomni-server/model"

	"gorm.io/gorm"
)

func TestResumeQuestionStreamReplaysUnseenThenTails(t *testing.T) {
	gdb := setupStreamTestDB(t)
	svc := streamCapableService()
	row := model.QuestionAgentLog{
		DialogueId: "dlg-resume", UserName: "alice@example.com",
		Query: "q", ToolName: "ChatAgent", Status: "RUNNING", Mode: "instant",
	}
	if err := gdb.Create(&row).Error; err != nil {
		t.Fatal(err)
	}
	svc.hub().Append(row.Id, []byte("event: RunStarted\ndata: {\"type\":\"RunStarted\",\"run_id\":\"r\"}\n\n"))
	var got []int64
	done := make(chan struct{})
	go func() {
		defer close(done)
		_ = svc.ResumeQuestionStream(
			context.Background(), "alice@example.com", "dlg-resume", row.Id, 0,
			func(frame StreamFrame) error {
				got = append(got, frame.Seq)
				if frame.Seq == 2 {
					return errResumeTestStop
				}
				return nil
			},
		)
	}()
	time.Sleep(20 * time.Millisecond)
	svc.hub().Append(row.Id, []byte("event: TextMessageContent\ndata: {\"type\":\"TextMessageContent\",\"delta\":\"x\"}\n\n"))
	<-done
	if len(got) < 2 || got[0] != 1 || got[1] != 2 {
		t.Fatalf("got=%v", got)
	}
}

var errResumeTestStop = errors.New("stop test subscriber")

func TestResumeQuestionStreamRejectsOtherOwner(t *testing.T) {
	gdb := setupStreamTestDB(t)
	svc := streamCapableService()
	row := model.QuestionAgentLog{
		DialogueId: "dlg-resume", UserName: "alice@example.com",
		Query: "q", ToolName: "ChatAgent", Status: "RUNNING", Mode: "instant",
	}
	if err := gdb.Create(&row).Error; err != nil {
		t.Fatal(err)
	}
	err := svc.ResumeQuestionStream(
		context.Background(), "bob@example.com", "dlg-resume", row.Id, 0,
		func(StreamFrame) error {
			t.Fatal("must not forward a foreign owner's stream")
			return nil
		},
	)
	if !errors.Is(err, gorm.ErrRecordNotFound) {
		t.Fatalf("err=%v, want record not found", err)
	}
}

func TestResumeQuestionStreamRunningWithoutHubReturnsErrStreamRunMissing(t *testing.T) {
	gdb := setupStreamTestDB(t)
	svc := streamCapableService()
	row := model.QuestionAgentLog{
		DialogueId: "dlg-resume-missing", UserName: "alice@example.com",
		Query: "q", ToolName: "ChatAgent", Status: "RUNNING", Mode: "instant",
	}
	if err := gdb.Create(&row).Error; err != nil {
		t.Fatal(err)
	}
	var forwarded int
	err := svc.ResumeQuestionStream(
		context.Background(), "alice@example.com", "dlg-resume-missing", row.Id, 0,
		func(StreamFrame) error {
			forwarded++
			return nil
		},
	)
	if !errors.Is(err, ErrStreamRunMissing) {
		t.Fatalf("err=%v, want ErrStreamRunMissing", err)
	}
	if forwarded != 0 {
		t.Fatalf("forwarded=%d, want 0", forwarded)
	}
}

func TestResumeQuestionStreamTerminalWithoutHubSendsNothing(t *testing.T) {
	gdb := setupStreamTestDB(t)
	svc := streamCapableService()
	row := model.QuestionAgentLog{
		DialogueId: "dlg-resume-done", UserName: "alice@example.com",
		Query: "q", Answer: "already hydrated", ToolName: "ChatAgent",
		Status: "SUCCEEDED", Mode: "instant",
	}
	if err := gdb.Create(&row).Error; err != nil {
		t.Fatal(err)
	}
	var forwarded int
	err := svc.ResumeQuestionStream(
		context.Background(), "alice@example.com", "dlg-resume-done", row.Id, 0,
		func(StreamFrame) error {
			forwarded++
			return nil
		},
	)
	if err != nil {
		t.Fatalf("err=%v", err)
	}
	if forwarded != 0 {
		t.Fatalf("forwarded=%d, want 0 (do not invent AG-UI)", forwarded)
	}
}

func TestResumeQuestionStreamTerminalReplaysHubThenReturns(t *testing.T) {
	gdb := setupStreamTestDB(t)
	svc := streamCapableService()
	row := model.QuestionAgentLog{
		DialogueId: "dlg-resume-snap", UserName: "alice@example.com",
		Query: "q", ToolName: "ChatAgent", Status: "SUCCEEDED", Mode: "instant",
	}
	if err := gdb.Create(&row).Error; err != nil {
		t.Fatal(err)
	}
	svc.hub().Append(row.Id, []byte("event: RunStarted\ndata: {\"type\":\"RunStarted\",\"run_id\":\"r\"}\n\n"))
	svc.hub().Append(row.Id, []byte("event: RunFinished\ndata: {\"type\":\"RunFinished\",\"run_id\":\"r\"}\n\n"))
	svc.hub().Finish(row.Id)

	var got []int64
	done := make(chan error, 1)
	go func() {
		done <- svc.ResumeQuestionStream(
			context.Background(), "alice@example.com", "dlg-resume-snap", row.Id, 0,
			func(frame StreamFrame) error {
				got = append(got, frame.Seq)
				return nil
			},
		)
	}()
	select {
	case err := <-done:
		if err != nil {
			t.Fatalf("err=%v", err)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("resume hung on terminal hub snapshot")
	}
	if len(got) != 2 || got[0] != 1 || got[1] != 2 {
		t.Fatalf("got=%v, want [1 2]", got)
	}
}

func TestResumeQuestionStreamAfterSeqSkipsSeenThenTails(t *testing.T) {
	gdb := setupStreamTestDB(t)
	svc := streamCapableService()
	row := model.QuestionAgentLog{
		DialogueId: "dlg-resume-after", UserName: "alice@example.com",
		Query: "q", ToolName: "ChatAgent", Status: "RUNNING", Mode: "instant",
	}
	if err := gdb.Create(&row).Error; err != nil {
		t.Fatal(err)
	}
	svc.hub().Append(row.Id, []byte("event: RunStarted\ndata: {\"type\":\"RunStarted\",\"run_id\":\"r\"}\n\n"))
	svc.hub().Append(row.Id, []byte("event: TextMessageContent\ndata: {\"type\":\"TextMessageContent\",\"delta\":\"a\"}\n\n"))
	var got []int64
	done := make(chan struct{})
	go func() {
		defer close(done)
		_ = svc.ResumeQuestionStream(
			context.Background(), "alice@example.com", "dlg-resume-after", row.Id, 1,
			func(frame StreamFrame) error {
				got = append(got, frame.Seq)
				if frame.Seq == 3 {
					return errResumeTestStop
				}
				return nil
			},
		)
	}()
	time.Sleep(20 * time.Millisecond)
	svc.hub().Append(row.Id, []byte("event: TextMessageContent\ndata: {\"type\":\"TextMessageContent\",\"delta\":\"b\"}\n\n"))
	<-done
	if len(got) != 2 || got[0] != 2 || got[1] != 3 {
		t.Fatalf("got=%v, want [2 3]", got)
	}
}

type fakeRunStream struct {
	mu          sync.Mutex
	body        string
	err         error
	release     chan struct{}
	started     chan struct{}
	startedOnce sync.Once
	runID       string
	after       int64
	called      int
}

type scriptedRunStream struct {
	mu      sync.Mutex
	bodies  []string
	afters  []int64
	started chan struct{}
	release chan struct{}
	once    sync.Once
}

func (f *scriptedRunStream) RunStreamWithMeta(
	ctx context.Context,
	_runID string,
	after int64,
) (io.ReadCloser, rxBot.ResponseMeta, error) {
	f.mu.Lock()
	call := len(f.afters)
	f.afters = append(f.afters, after)
	var body string
	if call < len(f.bodies) {
		body = f.bodies[call]
	}
	f.mu.Unlock()
	if f.started != nil {
		f.once.Do(func() { close(f.started) })
	}
	if f.release != nil {
		select {
		case <-f.release:
		case <-ctx.Done():
			return nil, rxBot.ResponseMeta{}, ctx.Err()
		}
	}
	return io.NopCloser(strings.NewReader(body)), rxBot.ResponseMeta{}, nil
}

func (f *scriptedRunStream) calledAfters() []int64 {
	f.mu.Lock()
	defer f.mu.Unlock()
	return append([]int64(nil), f.afters...)
}

func (f *fakeRunStream) RunStreamWithMeta(
	ctx context.Context,
	runID string,
	after int64,
) (io.ReadCloser, rxBot.ResponseMeta, error) {
	f.mu.Lock()
	f.called++
	f.runID = runID
	f.after = after
	if f.started != nil {
		f.startedOnce.Do(func() { close(f.started) })
	}
	release := f.release
	f.mu.Unlock()
	if release != nil {
		select {
		case <-release:
		case <-ctx.Done():
			return nil, rxBot.ResponseMeta{}, ctx.Err()
		}
	}
	if f.err != nil {
		return nil, rxBot.ResponseMeta{}, f.err
	}
	return io.NopCloser(strings.NewReader(f.body)), rxBot.ResponseMeta{}, nil
}

func (f *fakeRunStream) snapshot() (called int, runID string, after int64) {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.called, f.runID, f.after
}

func TestResumeQuestionStreamResuppliesFromBotWhenHubMissing(t *testing.T) {
	gdb := setupStreamTestDB(t)
	streamer := &fakeRunStream{
		body: "event: RunStarted\ndata: {\"type\":\"RunStarted\",\"run_id\":\"bot-keep\"}\n\n" +
			"event: RunFinished\ndata: {\"type\":\"RunFinished\",\"run_id\":\"bot-keep\"}\n\n",
	}
	svc := streamCapableService()
	svc.runStream = streamer
	row := model.QuestionAgentLog{
		DialogueId: "dlg-resupply", UserName: "alice@example.com",
		Query: "q", ToolName: "ChatAgent", Status: "RUNNING", Mode: "instant",
		BotRunId: "bot-keep",
	}
	if err := gdb.Create(&row).Error; err != nil {
		t.Fatal(err)
	}
	var got []int64
	done := make(chan error, 1)
	go func() {
		done <- svc.ResumeQuestionStream(
			context.Background(), "alice@example.com", "dlg-resupply", row.Id, 0,
			func(frame StreamFrame) error {
				got = append(got, frame.Seq)
				return nil
			},
		)
	}()
	select {
	case err := <-done:
		if err != nil {
			t.Fatalf("err=%v", err)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("resume hung waiting for Bot resupply")
	}
	called, runID, after := streamer.snapshot()
	if called != 1 || runID != "bot-keep" || after != 0 {
		t.Fatalf("streamer called=%d runID=%q after=%d", called, runID, after)
	}
	if len(got) != 2 || got[0] != 1 || got[1] != 2 {
		t.Fatalf("got=%v, want [1 2]", got)
	}
}

func TestResumeQuestionStreamNonterminalBotEOFFailsHub(t *testing.T) {
	gdb := setupStreamTestDB(t)
	streamer := &fakeRunStream{
		body: "event: RunStarted\ndata: {\"type\":\"RunStarted\",\"run_id\":\"bot-truncated\"}\n\n",
	}
	svc := streamCapableService()
	svc.runStream = streamer
	row := model.QuestionAgentLog{
		DialogueId: "dlg-truncated", UserName: "alice@example.com",
		Query: "q", ToolName: "ChatAgent", Status: "RUNNING", Mode: "instant",
		BotRunId: "bot-truncated",
	}
	if err := gdb.Create(&row).Error; err != nil {
		t.Fatal(err)
	}
	var forwarded []StreamFrame
	if err := svc.ResumeQuestionStream(
		context.Background(), "alice@example.com", "dlg-truncated", row.Id, 0,
		func(frame StreamFrame) error {
			forwarded = append(forwarded, frame)
			return nil
		},
	); err != nil {
		t.Fatalf("ResumeQuestionStream: %v", err)
	}
	if len(forwarded) != 4 || !strings.Contains(string(forwarded[3].Bytes), "stream_replay_incomplete") {
		t.Fatalf("forwarded=%q, want three attempts and terminal RunError", forwarded)
	}
	if err := gdb.First(&row, row.Id).Error; err != nil {
		t.Fatal(err)
	}
	if row.Status != "FAILED" {
		t.Fatalf("row status=%q, want FAILED", row.Status)
	}
}

func TestResumeQuestionStreamConcurrentResupplyIsSingleFlight(t *testing.T) {
	gdb := setupStreamTestDB(t)
	release := make(chan struct{})
	streamer := &fakeRunStream{
		started: make(chan struct{}),
		release: release,
		body: "event: RunStarted\ndata: {\"type\":\"RunStarted\",\"run_id\":\"bot-one\"}\n\n" +
			"event: RunFinished\ndata: {\"type\":\"RunFinished\",\"run_id\":\"bot-one\"}\n\n",
	}
	svc := streamCapableService()
	svc.runStream = streamer
	row := model.QuestionAgentLog{
		DialogueId: "dlg-singleflight", UserName: "alice@example.com",
		Query: "q", ToolName: "ChatAgent", Status: "RUNNING", Mode: "instant",
		BotRunId: "bot-one",
	}
	if err := gdb.Create(&row).Error; err != nil {
		t.Fatal(err)
	}

	const subscribers = 8
	errCh := make(chan error, subscribers)
	for i := 0; i < subscribers; i++ {
		go func() {
			ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
			defer cancel()
			errCh <- svc.ResumeQuestionStream(
				ctx, "alice@example.com", "dlg-singleflight", row.Id, 0,
				func(StreamFrame) error { return nil },
			)
		}()
	}
	select {
	case <-streamer.started:
	case <-time.After(2 * time.Second):
		t.Fatal("Bot resupply was not started")
	}
	time.Sleep(80 * time.Millisecond)
	if called, _, _ := streamer.snapshot(); called != 1 {
		close(release)
		t.Fatalf("Bot resupply calls=%d, want 1 while concurrent resumes wait", called)
	}
	close(release)
	for i := 0; i < subscribers; i++ {
		select {
		case err := <-errCh:
			if err != nil {
				t.Fatalf("subscriber %d err=%v", i, err)
			}
		case <-time.After(2 * time.Second):
			t.Fatalf("subscriber %d did not finish", i)
		}
	}
	called, runID, after := streamer.snapshot()
	if called != 1 || runID != "bot-one" || after != 0 {
		t.Fatalf("streamer called=%d runID=%q after=%d", called, runID, after)
	}
	frames := svc.hub().After(row.Id, 0)
	if len(frames) != 2 || frames[0].Seq != 1 || frames[1].Seq != 2 {
		t.Fatalf("hub frames=%+v, want exactly one two-frame Bot copy", frames)
	}
}

func TestResumeQuestionStreamPendingBotRunIDDoesNotCallBot(t *testing.T) {
	gdb := setupStreamTestDB(t)
	streamer := &fakeRunStream{err: errors.New("bot should not be called")}
	svc := streamCapableService()
	svc.runStream = streamer
	row := model.QuestionAgentLog{
		DialogueId: "dlg-pending", UserName: "alice@example.com",
		Query: "q", ToolName: "ChatAgent", Status: "RUNNING", Mode: "instant",
		BotRunId: "web-pending-1",
	}
	if err := gdb.Create(&row).Error; err != nil {
		t.Fatal(err)
	}
	err := svc.ResumeQuestionStream(
		context.Background(), "alice@example.com", "dlg-pending", row.Id, 0,
		func(StreamFrame) error {
			t.Fatal("must not forward without a hub or Bot stream")
			return nil
		},
	)
	if !errors.Is(err, ErrStreamRunMissing) {
		t.Fatalf("err=%v, want ErrStreamRunMissing", err)
	}
	if called, _, _ := streamer.snapshot(); called != 0 {
		t.Fatalf("called=%d, want 0", called)
	}
}

func TestResumeQuestionStreamStartingProducerDoesNotTriggerResupply(t *testing.T) {
	gdb := setupStreamTestDB(t)
	streamer := &fakeRunStream{err: errors.New("Bot resupply must not run")}
	svc := streamCapableService()
	svc.runStream = streamer
	row := model.QuestionAgentLog{
		DialogueId: "dlg-starting", UserName: "alice@example.com",
		Query: "q", ToolName: "ChatAgent", Status: "RUNNING", Mode: "instant",
		BotRunId: "bot-starting",
	}
	if err := gdb.Create(&row).Error; err != nil {
		t.Fatal(err)
	}
	svc.hub().Begin(row.Id)

	done := make(chan error, 1)
	go func() {
		done <- svc.ResumeQuestionStream(
			context.Background(), "alice@example.com", row.DialogueId, row.Id, 0,
			func(StreamFrame) error { return nil },
		)
	}()
	time.Sleep(30 * time.Millisecond)
	svc.hub().Append(row.Id, []byte("event: RunStarted\ndata: {\"type\":\"RunStarted\",\"run_id\":\"bot-starting\"}\n\n"))
	svc.hub().Append(row.Id, []byte("event: RunFinished\ndata: {\"type\":\"RunFinished\",\"run_id\":\"bot-starting\"}\n\n"))
	svc.hub().Finish(row.Id)
	if err := <-done; err != nil {
		t.Fatalf("ResumeQuestionStream: %v", err)
	}
	if called, _, _ := streamer.snapshot(); called != 0 {
		t.Fatalf("Bot resupply calls=%d, want 0 during pre-first-frame producer window", called)
	}
}

func TestResumeQuestionStreamResupplySurvivesBrowserLeaveAndSettlesRow(t *testing.T) {
	gdb := setupStreamTestDB(t)
	release := make(chan struct{})
	streamer := &scriptedRunStream{
		started: make(chan struct{}),
		release: release,
		bodies: []string{
			"event: RunStarted\ndata: {\"type\":\"RunStarted\",\"run_id\":\"bot-detached\"}\n\n" +
				"event: TextMessageContent\ndata: {\"type\":\"TextMessageContent\",\"message_id\":\"m\",\"delta\":\"recovered answer\"}\n\n" +
				"event: RunFinished\ndata: {\"type\":\"RunFinished\",\"run_id\":\"bot-detached\"}\n\n",
		},
	}
	svc := streamCapableService()
	svc.runStream = streamer
	row := model.QuestionAgentLog{
		DialogueId: "dlg-detached", UserName: "alice@example.com",
		Query: "q", ToolName: "ChatAgent", Status: "RUNNING", Mode: "instant",
		BotRunId: "bot-detached",
	}
	if err := gdb.Create(&row).Error; err != nil {
		t.Fatal(err)
	}

	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan error, 1)
	go func() {
		done <- svc.ResumeQuestionStream(
			ctx, row.UserName, row.DialogueId, row.Id, 0,
			func(StreamFrame) error { return nil },
		)
	}()
	<-streamer.started
	cancel()
	close(release)
	select {
	case <-done:
	case <-time.After(2 * time.Second):
		t.Fatal("browser subscriber did not leave")
	}

	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		if err := gdb.First(&row, row.Id).Error; err != nil {
			t.Fatal(err)
		}
		if row.Status == "SUCCEEDED" {
			break
		}
		time.Sleep(10 * time.Millisecond)
	}
	if row.Status != "SUCCEEDED" || !strings.Contains(row.Answer, "recovered answer") {
		t.Fatalf("row after detached resupply=%#v", row)
	}
	if got := svc.hub().ProducerState(row.Id); got != StreamProducerFinished {
		t.Fatalf("producer state=%v, want finished", got)
	}
}

func TestResumeQuestionStreamNonterminalEOFRetriesThenFailsDurably(t *testing.T) {
	gdb := setupStreamTestDB(t)
	streamer := &scriptedRunStream{bodies: []string{
		"event: RunStarted\ndata: {\"type\":\"RunStarted\",\"run_id\":\"bot-truncated\"}\n\n" +
			"event: TextMessageContent\ndata: {\"type\":\"TextMessageContent\",\"message_id\":\"m\",\"delta\":\"partial\"}\n\n",
		"",
		"",
	}}
	svc := streamCapableService()
	svc.runStream = streamer
	row := model.QuestionAgentLog{
		DialogueId: "dlg-truncated-durable", UserName: "alice@example.com",
		Query: "q", ToolName: "ChatAgent", Status: "RUNNING", Mode: "instant",
		BotRunId: "bot-truncated",
	}
	if err := gdb.Create(&row).Error; err != nil {
		t.Fatal(err)
	}

	if err := svc.ResumeQuestionStream(
		context.Background(), row.UserName, row.DialogueId, row.Id, 0,
		func(StreamFrame) error { return nil },
	); err != nil {
		t.Fatalf("ResumeQuestionStream: %v", err)
	}
	if err := gdb.First(&row, row.Id).Error; err != nil {
		t.Fatal(err)
	}
	if row.Status != "FAILED" || !strings.Contains(row.Answer, "partial") {
		t.Fatalf("row after truncated replay=%#v", row)
	}
	if got := svc.hub().ProducerState(row.Id); got != StreamProducerFinished {
		t.Fatalf("producer state=%v, want finished", got)
	}
	if got := streamer.calledAfters(); len(got) != 3 || got[0] != 0 || got[1] != 2 || got[2] != 2 {
		t.Fatalf("Bot replay cursors=%v, want [0 2 2]", got)
	}
}

func TestResumeQuestionStreamGatewayRestartReplaySettlesOwnerRow(t *testing.T) {
	gdb := setupStreamTestDB(t)
	streamer := &scriptedRunStream{bodies: []string{
		"event: RunStarted\ndata: {\"type\":\"RunStarted\",\"run_id\":\"bot-restart\"}\n\n" +
			"event: TextMessageContent\ndata: {\"type\":\"TextMessageContent\",\"message_id\":\"m\",\"delta\":\"after restart\"}\n\n" +
			"event: RunFinished\ndata: {\"type\":\"RunFinished\",\"run_id\":\"bot-restart\"}\n\n",
	}}
	restarted := streamCapableService()
	restarted.runStream = streamer
	row := model.QuestionAgentLog{
		DialogueId: "dlg-restart", UserName: "alice@example.com",
		Query: "q", ToolName: "ChatAgent", Status: "RUNNING", Mode: "instant",
		BotRunId: "bot-restart",
	}
	if err := gdb.Create(&row).Error; err != nil {
		t.Fatal(err)
	}

	var frames []StreamFrame
	if err := restarted.ResumeQuestionStream(
		context.Background(), row.UserName, row.DialogueId, row.Id, 0,
		func(frame StreamFrame) error {
			frames = append(frames, frame)
			return nil
		},
	); err != nil {
		t.Fatalf("ResumeQuestionStream: %v", err)
	}
	if len(frames) != 3 {
		t.Fatalf("replayed frames=%d, want 3", len(frames))
	}
	if err := gdb.First(&row, row.Id).Error; err != nil {
		t.Fatal(err)
	}
	if row.Status != "SUCCEEDED" || !strings.Contains(row.Answer, "after restart") {
		t.Fatalf("restarted row=%#v", row)
	}
}
