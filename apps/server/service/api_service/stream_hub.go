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

type streamFollower struct {
	ch        chan StreamFrame
	stop      chan struct{}
	stopOnce  sync.Once
	closeOnce sync.Once
}

func newStreamFollower() *streamFollower {
	return &streamFollower{
		ch:   make(chan StreamFrame, 16),
		stop: make(chan struct{}),
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
	done      bool
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

// Append assigns the next seq for messageID, stamps `id: N\n` onto raw, stores
// the frame, and non-blocking-sends it to current followers.
func (h *StreamHub) Append(messageID int64, raw []byte) StreamFrame {
	h.mu.Lock()
	defer h.mu.Unlock()

	e := h.messages[messageID]
	if e == nil {
		e = &streamEntry{
			nextSeq:   1,
			followers: make(map[*streamFollower]struct{}),
		}
		h.messages[messageID] = e
	}
	seq := e.nextSeq
	e.nextSeq++

	prefix := []byte(fmt.Sprintf("id: %d\n", seq))
	stamped := make([]byte, 0, len(prefix)+len(raw))
	stamped = append(stamped, prefix...)
	stamped = append(stamped, raw...)
	frame := StreamFrame{Seq: seq, Bytes: stamped}
	e.frames = append(e.frames, frame)

	if !e.done {
		for fol := range e.followers {
			select {
			case fol.ch <- frame:
			default:
			}
		}
	}
	return frame
}

// After returns frames with Seq > afterSeq. Missing messageID yields nil.
func (h *StreamHub) After(messageID int64, afterSeq int64) []StreamFrame {
	h.mu.Lock()
	defer h.mu.Unlock()

	e := h.messages[messageID]
	if e == nil {
		return nil
	}
	var out []StreamFrame
	for _, fr := range e.frames {
		if fr.Seq > afterSeq {
			out = append(out, fr)
		}
	}
	return out
}

// Follow replays After(messageID, afterSeq), then live Append frames, and
// closes ch when Finish runs. Missing messageID waits until Append or Finish.
// unsub is safe to call more than once.
func (h *StreamHub) Follow(messageID int64, afterSeq int64) (ch <-chan StreamFrame, unsub func()) {
	fol := newStreamFollower()

	var once sync.Once
	unsub = func() {
		once.Do(func() {
			h.mu.Lock()
			if e := h.messages[messageID]; e != nil {
				delete(e.followers, fol)
			}
			h.mu.Unlock()
			fol.requestStop()
		})
	}

	h.mu.Lock()
	e := h.messages[messageID]
	if e == nil {
		e = &streamEntry{
			nextSeq:   1,
			followers: make(map[*streamFollower]struct{}),
		}
		h.messages[messageID] = e
	}
	var replay []StreamFrame
	for _, fr := range e.frames {
		if fr.Seq > afterSeq {
			replay = append(replay, fr)
		}
	}
	done := e.done
	h.mu.Unlock()

	go h.deliverFollow(messageID, afterSeq, replay, done, fol)
	return fol.ch, unsub
}

func (h *StreamHub) deliverFollow(
	messageID int64,
	afterSeq int64,
	replay []StreamFrame,
	done bool,
	fol *streamFollower,
) {
	defer fol.closeCh()

	for _, fr := range replay {
		if !fol.send(fr) {
			return
		}
	}
	if done {
		return
	}

	last := afterSeq
	if n := len(replay); n > 0 {
		last = replay[n-1].Seq
	}

	// Deliver catch-up before registering so Finish cannot abort mid-catch-up
	// and drop frames that are already in the log. Only unsub aborts early
	// (fol.send). Re-check under the lock until catch-up is empty, then register.
	for {
		h.mu.Lock()
		e := h.messages[messageID]
		if e == nil {
			h.mu.Unlock()
			return
		}
		var catchup []StreamFrame
		for _, fr := range e.frames {
			if fr.Seq > last {
				catchup = append(catchup, fr)
			}
		}
		if e.done {
			h.mu.Unlock()
			for _, fr := range catchup {
				if !fol.send(fr) {
					return
				}
			}
			return
		}
		if len(catchup) == 0 {
			e.followers[fol] = struct{}{}
			h.mu.Unlock()
			<-fol.stop
			return
		}
		h.mu.Unlock()

		for _, fr := range catchup {
			if !fol.send(fr) {
				return
			}
			last = fr.Seq
		}
	}
}

// Finish marks the stream done, closes followers, and retains the snapshot for
// 30s so a late resume can still After before the entry is deleted.
func (h *StreamHub) Finish(messageID int64) {
	h.mu.Lock()
	e := h.messages[messageID]
	if e == nil {
		e = &streamEntry{
			nextSeq:   1,
			done:      true,
			followers: make(map[*streamFollower]struct{}),
		}
		h.messages[messageID] = e
		h.mu.Unlock()
		h.scheduleDelete(messageID)
		return
	}
	if e.done {
		h.mu.Unlock()
		return
	}
	e.done = true
	followers := e.followers
	e.followers = make(map[*streamFollower]struct{})
	h.mu.Unlock()

	for fol := range followers {
		fol.requestStop()
	}
	h.scheduleDelete(messageID)
}

func (h *StreamHub) scheduleDelete(messageID int64) {
	time.AfterFunc(30*time.Second, func() {
		h.mu.Lock()
		defer h.mu.Unlock()
		if cur := h.messages[messageID]; cur != nil && cur.done {
			delete(h.messages, messageID)
		}
	})
}
