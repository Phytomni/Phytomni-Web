package api_service

import (
	"bufio"
	"context"
	"errors"
	"io"
	"strings"

	"phytomni-server/model"
)

// ErrStreamRunMissing means the owner row is still live but this process has no
// frame log to replay or tail. Resume does not start a second Bot run.
var ErrStreamRunMissing = errors.New("stream run is missing from this gateway")

// ResumeQuestionStream replays AG-UI frames with seq > afterSeq then tails the
// process-local hub. Missing or foreign rows return the same not-found error as
// history. A live row with no hub resupplies from Bot when bot_run_id is set;
// otherwise it returns ErrStreamRunMissing.
func (ps *Service) ResumeQuestionStream(
	ctx context.Context,
	username string,
	dialogueID string,
	messageID int64,
	afterSeq int64,
	forward func(StreamFrame) error,
) error {
	if afterSeq < 0 {
		afterSeq = 0
	}

	var row model.QuestionAgentLog
	if err := model.DB(ctx).
		Where("id = ? AND user_name = ? AND dialogue_id = ? AND delete_at IS NULL", messageID, username, dialogueID).
		First(&row).Error; err != nil {
		return err
	}

	hub := ps.hub()
	terminal := resumeStreamTerminal(row.Status)
	if len(hub.After(messageID, 0)) == 0 {
		if terminal {
			return nil
		}
		if err := ps.resupplyQuestionStreamFromBot(ctx, row.BotRunId, messageID); err != nil {
			return ErrStreamRunMissing
		}
	}
	if terminal {
		return forwardResumeFrames(hub.After(messageID, afterSeq), forward)
	}
	return followResumeStream(ctx, hub, messageID, afterSeq, forward)
}

func botRunIDForResupply(botRunID string) string {
	id := strings.TrimSpace(botRunID)
	if id == "" || strings.HasPrefix(id, "web-pending-") {
		return ""
	}
	return id
}

func (ps *Service) resupplyQuestionStreamFromBot(
	ctx context.Context,
	botRunID string,
	messageID int64,
) error {
	runID := botRunIDForResupply(botRunID)
	if runID == "" {
		return ErrStreamRunMissing
	}
	botCtx := context.WithoutCancel(ctx)
	rc, meta, err := ps.runStreamReader().RunStreamWithMeta(botCtx, runID, 0)
	logBotResponseMeta(ctx, meta)
	if err != nil || rc == nil {
		return ErrStreamRunMissing
	}
	go copyBotRunStreamToHub(ps.hub(), messageID, rc)
	return nil
}

func copyBotRunStreamToHub(hub *StreamHub, messageID int64, rc io.ReadCloser) {
	defer rc.Close()
	defer hub.Finish(messageID)
	scanner := bufio.NewScanner(rc)
	scanner.Buffer(make([]byte, 0, 64*1024), 1024*1024)
	scanner.Split(splitSSEFrames)
	for scanner.Scan() {
		frame := append([]byte(nil), scanner.Bytes()...)
		hub.Append(messageID, frame)
	}
}

func resumeStreamTerminal(status string) bool {
	switch strings.ToUpper(strings.TrimSpace(status)) {
	case "SUCCEEDED", "FAILED", "CANCELLED", "CANCELED":
		return true
	default:
		return false
	}
}

func forwardResumeFrames(frames []StreamFrame, forward func(StreamFrame) error) error {
	if forward == nil {
		return nil
	}
	for _, frame := range frames {
		if err := forward(frame); err != nil {
			return nil
		}
	}
	return nil
}

func followResumeStream(
	ctx context.Context,
	hub *StreamHub,
	messageID int64,
	afterSeq int64,
	forward func(StreamFrame) error,
) error {
	ch, unsub := hub.Follow(messageID, afterSeq)
	defer unsub()
	for {
		select {
		case <-ctx.Done():
			return nil
		case frame, ok := <-ch:
			if !ok {
				return nil
			}
			if forward == nil {
				continue
			}
			if err := forward(frame); err != nil {
				return nil
			}
		}
	}
}
