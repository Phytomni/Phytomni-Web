package api_service

import (
	"bufio"
	"context"
	"errors"
	"io"
	"strings"

	rxBot "phytomni-server/external/bot"
	"phytomni-server/model"
)

// ErrStreamRunMissing means the owner row is still live but this process has no
// frame log to replay or tail. Resume does not start a second Bot run.
var ErrStreamRunMissing = errors.New("stream run is missing from this gateway")

type streamResupply struct {
	ready chan struct{}
	err   error
}

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
	state, owner := ps.claimStreamResupply(messageID)
	if !owner {
		select {
		case <-state.ready:
			return state.err
		case <-ctx.Done():
			return ctx.Err()
		}
	}

	rc, meta, err := ps.runStreamReader().RunStreamWithMeta(ctx, runID, 0)
	logBotResponseMeta(ctx, meta)
	if err != nil || rc == nil {
		ps.finishStreamResupplySetup(messageID, state, ErrStreamRunMissing)
		return ErrStreamRunMissing
	}
	ps.finishStreamResupplySetup(messageID, state, nil)
	go func() {
		defer ps.clearStreamResupply(messageID, state)
		copyBotRunStreamToHub(ps.hub(), messageID, rc)
	}()
	return nil
}

func (ps *Service) claimStreamResupply(messageID int64) (*streamResupply, bool) {
	ps.resupplyMu.Lock()
	defer ps.resupplyMu.Unlock()
	if ps.resupplies == nil {
		ps.resupplies = make(map[int64]*streamResupply)
	}
	if existing := ps.resupplies[messageID]; existing != nil {
		return existing, false
	}
	state := &streamResupply{ready: make(chan struct{})}
	ps.resupplies[messageID] = state
	return state, true
}

func (ps *Service) finishStreamResupplySetup(messageID int64, state *streamResupply, err error) {
	state.err = err
	if err != nil {
		ps.clearStreamResupply(messageID, state)
	}
	close(state.ready)
}

func (ps *Service) clearStreamResupply(messageID int64, state *streamResupply) {
	ps.resupplyMu.Lock()
	defer ps.resupplyMu.Unlock()
	if ps.resupplies[messageID] == state {
		delete(ps.resupplies, messageID)
	}
}

func copyBotRunStreamToHub(hub *StreamHub, messageID int64, rc io.ReadCloser) {
	defer rc.Close()
	scanner := bufio.NewScanner(rc)
	scanner.Buffer(make([]byte, 0, 64*1024), 1024*1024)
	scanner.Split(splitSSEFrames)
	terminal := false
	for scanner.Scan() {
		frame := append([]byte(nil), scanner.Bytes()...)
		hub.Append(messageID, frame)
		if isTerminalAGUIFrame(frame) {
			terminal = true
		}
	}
	if terminal {
		hub.Finish(messageID)
	}
}

func isTerminalAGUIFrame(frame []byte) bool {
	ev, ok := rxBot.ParseAGUIFrame(frame)
	if !ok {
		return false
	}
	switch ev.Type {
	case "RunFinished", "RunError":
		return true
	default:
		return false
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
