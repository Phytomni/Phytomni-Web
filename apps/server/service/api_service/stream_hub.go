package api_service

import (
	"fmt"
	"sync"
	"time"
)

// StreamFrame is one AG-UI SSE frame stamped with a monotonic id for resume.
type StreamFrame struct {
	Seq   int64
	Bytes []byte // original AG-UI frame plus `id: <seq>\n` prefix
}

// StreamProducerState distinguishes an empty live stream from a missing log.
type StreamProducerState uint8

const (
	StreamProducerMissing StreamProducerState = iota
	StreamProducerStarting
	StreamProducerActive
	StreamProducerFinished
)

type streamFollower struct {
	ch        chan StreamFrame
	wake      chan struct{}
	stop      chan struct{}
	stopOnce  sync.Once
	closeOnce sync.Once
}

func newStreamFollower() *streamFollower {
	return &streamFollower{
		ch:   make(chan StreamFrame, 16),
		wake: make(chan struct{}, 1),
		stop: make(chan struct{}),
	}
}

func (f *streamFollower) signal() {
	select {
	case f.wake <- struct{}{}:
	default:
	}
}

func (f *streamFollower) requestStop() {
	f.stopOnce.Do(func() { close(f.stop) })
}

func (f *streamFollower) closeCh() {
	f.closeOnce.Do(func() { close(f.ch) })
}

func (f *streamFollower) send(frame StreamFrame) bool {
	select {
	case f.ch <- frame:
		return true
	case <-f.stop:
		return false
	}
}

type streamEntry struct {
	frames    []StreamFrame
	nextSeq   int64
	producer  StreamProducerState
	followers map[*streamFollower]struct{}
}

// StreamHub is a process-local log of AG-UI frames keyed by assistant messageID.
type StreamHub struct {
	mu       sync.Mutex
	messages map[int64]*streamEntry
}

func NewStreamHub() *StreamHub {
	return &StreamHub{messages: make(map[int64]*streamEntry)}
}

func newStreamEntry(state StreamProducerState) *streamEntry {
	return &streamEntry{
		nextSeq:   1,
		producer:  state,
		followers: make(map[*streamFollower]struct{}),
	}
}

// Begin records a producer before its first frame can arrive.
func (h *StreamHub) Begin(messageID int64) {
	h.mu.Lock()
	defer h.mu.Unlock()
	if entry := h.messages[messageID]; entry != nil && entry.producer != StreamProducerFinished {
		if entry.producer == StreamProducerMissing {
			entry.producer = StreamProducerStarting
		}
		return
	}
	h.messages[messageID] = newStreamEntry(StreamProducerStarting)
}

func (h *StreamHub) ProducerState(messageID int64) StreamProducerState {
	h.mu.Lock()
	defer h.mu.Unlock()
	if entry := h.messages[messageID]; entry != nil {
		return entry.producer
	}
	return StreamProducerMissing
}

// Append assigns the next seq for messageID, stamps `id: N\n` onto raw, stores
// the frame, and wakes current followers. Followers read from the stored log,
// so a coalesced wake notification cannot drop data under backpressure.
func (h *StreamHub) Append(messageID int64, raw []byte) StreamFrame {
	h.mu.Lock()
	defer h.mu.Unlock()

	entry := h.messages[messageID]
	if entry == nil || entry.producer == StreamProducerFinished {
		entry = newStreamEntry(StreamProducerStarting)
		h.messages[messageID] = entry
	}
	seq := entry.nextSeq
	entry.nextSeq++
	entry.producer = StreamProducerActive

	prefix := []byte(fmt.Sprintf("id: %d\n", seq))
	stamped := make([]byte, 0, len(prefix)+len(raw))
	stamped = append(stamped, prefix...)
	stamped = append(stamped, raw...)
	frame := StreamFrame{Seq: seq, Bytes: stamped}
	entry.frames = append(entry.frames, frame)

	for follower := range entry.followers {
		follower.signal()
	}
	return frame
}

// After returns frames with Seq > afterSeq. Missing messageID yields nil.
func (h *StreamHub) After(messageID int64, afterSeq int64) []StreamFrame {
	h.mu.Lock()
	defer h.mu.Unlock()
	return framesAfter(h.messages[messageID], afterSeq)
}

func framesAfter(entry *streamEntry, afterSeq int64) []StreamFrame {
	if entry == nil {
		return nil
	}
	var frames []StreamFrame
	for _, frame := range entry.frames {
		if frame.Seq > afterSeq {
			frames = append(frames, frame)
		}
	}
	return frames
}

// Follow replays After(messageID, afterSeq), then reads newly appended frames
// from the stored log until Finish. unsub is safe to call more than once.
func (h *StreamHub) Follow(messageID int64, afterSeq int64) (ch <-chan StreamFrame, unsub func()) {
	follower := newStreamFollower()

	var once sync.Once
	unsub = func() {
		once.Do(func() {
			h.mu.Lock()
			for _, entry := range h.messages {
				delete(entry.followers, follower)
			}
			h.mu.Unlock()
			follower.requestStop()
		})
	}

	h.mu.Lock()
	entry := h.messages[messageID]
	if entry == nil {
		entry = newStreamEntry(StreamProducerMissing)
		h.messages[messageID] = entry
	}
	entry.followers[follower] = struct{}{}
	h.mu.Unlock()

	go h.deliverFollow(messageID, afterSeq, follower)
	return follower.ch, unsub
}

func (h *StreamHub) deliverFollow(messageID int64, cursor int64, follower *streamFollower) {
	defer follower.closeCh()

	for {
		h.mu.Lock()
		entry := h.messages[messageID]
		frames := framesAfter(entry, cursor)
		finished := entry != nil && entry.producer == StreamProducerFinished
		h.mu.Unlock()

		for _, frame := range frames {
			if !follower.send(frame) {
				return
			}
			cursor = frame.Seq
		}
		if finished {
			return
		}

		select {
		case <-follower.wake:
		case <-follower.stop:
			return
		}
	}
}

// Finish marks the stream done, wakes followers so they drain the stored log,
// and retains the snapshot for 30s for late resume.
func (h *StreamHub) Finish(messageID int64) {
	h.mu.Lock()
	entry := h.messages[messageID]
	if entry == nil {
		entry = newStreamEntry(StreamProducerFinished)
		h.messages[messageID] = entry
	} else if entry.producer == StreamProducerFinished {
		h.mu.Unlock()
		return
	} else {
		entry.producer = StreamProducerFinished
	}
	for follower := range entry.followers {
		follower.signal()
	}
	h.mu.Unlock()

	h.scheduleDelete(messageID, entry)
}

func (h *StreamHub) scheduleDelete(messageID int64, finished *streamEntry) {
	time.AfterFunc(30*time.Second, func() {
		h.mu.Lock()
		defer h.mu.Unlock()
		if current := h.messages[messageID]; current == finished && current.producer == StreamProducerFinished {
			delete(h.messages, messageID)
		}
	})
}
