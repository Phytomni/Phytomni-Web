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

func TestResumeQuestionStreamNonterminalBotEOFDoesNotFinishHub(t *testing.T) {
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
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	forwarded := make(chan StreamFrame, 1)
	done := make(chan error, 1)
	go func() {
		done <- svc.ResumeQuestionStream(
			ctx, "alice@example.com", "dlg-truncated", row.Id, 0,
			func(frame StreamFrame) error {
				forwarded <- frame
				return nil
			},
		)
	}()
	select {
	case frame := <-forwarded:
		if frame.Seq != 1 || !strings.Contains(string(frame.Bytes), "RunStarted") {
			t.Fatalf("frame=%+v", frame)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("resume did not forward the Bot prefix")
	}
	select {
	case err := <-done:
		t.Fatalf("nonterminal Bot EOF finished the hub; err=%v", err)
	case <-time.After(80 * time.Millisecond):
		// Still following the open hub: expected until the request is cancelled.
	}
	cancel()
	select {
	case err := <-done:
		if err != nil {
			t.Fatalf("err after cancel=%v", err)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("resume did not stop after request cancellation")
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
