package api_service

import (
	"context"
	"errors"
	"testing"
	"time"

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
