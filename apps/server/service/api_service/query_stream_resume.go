package api_service

import (
	"bufio"
	"context"
	"errors"
	"fmt"
	"io"
	"strings"
	"time"

	rxBot "phytomni-server/external/bot"
	"phytomni-server/model"

	"gorm.io/gorm"
)

// ErrStreamRunMissing means the owner row is still live but this process has no
// frame log to replay or tail. Resume does not start a second Bot run.
var ErrStreamRunMissing = errors.New("stream run is missing from this gateway")

const (
	streamResupplyAttempts = 3
	streamResupplyTimeout  = 30 * time.Minute
)

type streamResupply struct {
	ready chan struct{}
}

// ResumeQuestionStream replays AG-UI frames with seq > afterSeq then tails the
// process-local hub. Missing or foreign rows return the same not-found error as
// history. A missing hub resupplies the same durable Bot run when bot_run_id is
// set; it never starts a second generation.
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
	switch hub.ProducerState(messageID) {
	case StreamProducerFinished:
		return forwardResumeFrames(hub.After(messageID, afterSeq), forward)
	case StreamProducerStarting, StreamProducerActive:
		return followResumeStream(ctx, hub, messageID, afterSeq, forward)
	}

	if botRunIDForResupply(row.BotRunId) == "" {
		if resumeStreamTerminal(row.Status) {
			return nil
		}
		return ErrStreamRunMissing
	}
	if err := ps.resupplyQuestionStreamFromBot(ctx, row, nil); err != nil {
		return err
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
	requestCtx context.Context,
	row model.QuestionAgentLog,
	stream runStreamReader,
) error {
	runID := botRunIDForResupply(row.BotRunId)
	if runID == "" {
		return ErrStreamRunMissing
	}
	state, owner := ps.claimStreamResupply(row.Id)
	if !owner {
		select {
		case <-state.ready:
			return nil
		case <-requestCtx.Done():
			return requestCtx.Err()
		}
	}

	if stream == nil {
		stream = ps.runStreamReader()
	}
	ps.hub().Begin(row.Id)
	close(state.ready)
	runCtx, cancel := context.WithTimeout(context.WithoutCancel(requestCtx), streamResupplyTimeout)
	go func() {
		defer cancel()
		defer ps.clearStreamResupply(row.Id, state)
		ps.copyBotRunStreamToHub(runCtx, row, runID, stream)
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

func (ps *Service) clearStreamResupply(messageID int64, state *streamResupply) {
	ps.resupplyMu.Lock()
	defer ps.resupplyMu.Unlock()
	if ps.resupplies[messageID] == state {
		delete(ps.resupplies, messageID)
	}
}

func (ps *Service) copyBotRunStreamToHub(
	ctx context.Context,
	row model.QuestionAgentLog,
	runID string,
	stream runStreamReader,
) {
	if stream == nil {
		stream = ps.runStreamReader()
	}
	hub := ps.hub()
	accumulator := rxBot.NewAGUIAccumulator("")
	var cursor int64
	terminal := false

	for attempt := 0; attempt < streamResupplyAttempts && !terminal; attempt++ {
		reader, meta, err := stream.RunStreamWithMeta(ctx, runID, cursor)
		logBotResponseMeta(ctx, meta)
		if err == nil && reader != nil {
			cursor, terminal = copyBotRunStreamAttempt(hub, row.Id, cursor, reader, accumulator)
		}
		if terminal || ctx.Err() != nil {
			break
		}
		if attempt+1 < streamResupplyAttempts {
			select {
			case <-ctx.Done():
			case <-time.After(time.Duration(attempt+1) * 20 * time.Millisecond):
			}
		}
	}

	status := resuppliedTerminalStatus(accumulator)
	if !terminal {
		status = "FAILED"
		hub.Append(row.Id, []byte(
			"event: RunError\n"+
				"data: {\"type\":\"RunError\",\"code\":\"stream_replay_incomplete\",\"message\":\"Bot replay ended before a terminal event\"}\n\n",
		))
	}
	settleCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 2*time.Second)
	defer cancel()
	_ = ps.settleResuppliedQuestionStream(settleCtx, row, accumulator, status)
	hub.Finish(row.Id)
}

func copyBotRunStreamAttempt(
	hub *StreamHub,
	messageID int64,
	cursor int64,
	reader io.ReadCloser,
	accumulator *rxBot.AGUIAccumulator,
) (int64, bool) {
	defer reader.Close()
	scanner := bufio.NewScanner(reader)
	scanner.Buffer(make([]byte, 0, 64*1024), 1024*1024)
	scanner.Split(splitSSEFrames)
	terminal := false
	for scanner.Scan() {
		frame := append([]byte(nil), scanner.Bytes()...)
		stored := hub.Append(messageID, frame)
		cursor = stored.Seq
		if event, ok := rxBot.ParseAGUIFrame(frame); ok {
			accumulator.Observe(event)
			terminal = isTerminalAGUIFrame(frame)
		}
		if terminal {
			break
		}
	}
	return cursor, terminal
}

func resuppliedTerminalStatus(accumulator *rxBot.AGUIAccumulator) string {
	if runErr := accumulator.Err(); runErr != nil {
		if strings.Contains(strings.ToLower(runErr.Code), "cancel") {
			return "CANCELLED"
		}
		return "FAILED"
	}
	if accumulator.Finished() {
		return statusSucceeded
	}
	return "FAILED"
}

func (ps *Service) settleResuppliedQuestionStream(
	ctx context.Context,
	row model.QuestionAgentLog,
	accumulator *rxBot.AGUIAccumulator,
	status string,
) error {
	return model.DB(ctx).Transaction(func(tx *gorm.DB) error {
		var stored model.QuestionAgentLog
		if err := tx.Model(&model.QuestionAgentLog{}).
			Select("id, user_name, dialogue_id, tool_name, status, answer").
			Where("id = ? AND user_name = ? AND dialogue_id = ?", row.Id, row.UserName, row.DialogueId).
			Take(&stored).Error; err != nil {
			return err
		}
		updates := map[string]interface{}{
			"follow_up_questions": accumulator.FollowUpJSON(),
		}
		if !resumeStreamTerminal(stored.Status) {
			updates["status"] = status
		}
		if answer := accumulator.AnswerText(); strings.TrimSpace(answer) != "" {
			slug, ok := rxBot.SlugFor(stored.ToolName)
			if !ok {
				return fmt.Errorf("unknown stream tool %q", stored.ToolName)
			}
			updates["answer"] = rxBot.ShapeAnswer(slug, answer, accumulator.CitedFormatted())
		}
		result := tx.Model(&model.QuestionAgentLog{}).
			Where("id = ? AND user_name = ? AND dialogue_id = ?", row.Id, row.UserName, row.DialogueId).
			Updates(updates)
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected != 1 {
			return fmt.Errorf("stream row %d not found", row.Id)
		}
		return nil
	})
}

func isTerminalAGUIFrame(frame []byte) bool {
	event, ok := rxBot.ParseAGUIFrame(frame)
	if !ok {
		return false
	}
	switch event.Type {
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
