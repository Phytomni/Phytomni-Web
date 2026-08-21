package api_service

import (
	"bytes"
	"fmt"
	"testing"
	"time"
)

func TestStreamHubReplayAndFollow(t *testing.T) {
	h := NewStreamHub()
	first := h.Append(7, []byte("event: RunStarted\ndata: {\"type\":\"RunStarted\"}\n\n"))
	if first.Seq != 1 || !bytes.HasPrefix(first.Bytes, []byte("id: 1\n")) {
		t.Fatalf("first = %+v", first)
	}
	ch, unsub := h.Follow(7, 0)
	defer unsub()
	got := <-ch
	if got.Seq != 1 {
		t.Fatalf("replay seq=%d", got.Seq)
	}
	second := h.Append(7, []byte("event: TextMessageContent\ndata: {\"type\":\"TextMessageContent\",\"delta\":\"a\"}\n\n"))
	live := <-ch
	if live.Seq != 2 || second.Seq != 2 {
		t.Fatalf("live=%+v second=%+v", live, second)
	}
	h.Finish(7)
	if _, ok := <-ch; ok {
		t.Fatal("channel must close after Finish")
	}
}

func TestStreamHubAfterSkipsSeenSeq(t *testing.T) {
	h := NewStreamHub()
	_ = h.Append(7, []byte("event: RunStarted\ndata: {\"type\":\"RunStarted\"}\n\n"))
	_ = h.Append(7, []byte("event: TextMessageContent\ndata: {\"type\":\"TextMessageContent\",\"delta\":\"a\"}\n\n"))

	after := h.After(7, 1)
	if len(after) != 1 || after[0].Seq != 2 {
		t.Fatalf("After(7, 1) = %+v, want only seq 2", after)
	}

	ch, unsub := h.Follow(7, 1)
	defer unsub()
	got := <-ch
	if got.Seq != 2 {
		t.Fatalf("Follow(7, 1) replay seq=%d, want 2", got.Seq)
	}
}

func TestStreamHubUnsubStopsDelivery(t *testing.T) {
	h := NewStreamHub()
	_ = h.Append(7, []byte("event: RunStarted\ndata: {\"type\":\"RunStarted\"}\n\n"))
	ch, unsub := h.Follow(7, 0)
	got := <-ch
	if got.Seq != 1 {
		t.Fatalf("replay seq=%d", got.Seq)
	}
	unsub()
	unsub() // must not panic on double call

	_ = h.Append(7, []byte("event: TextMessageContent\ndata: {\"type\":\"TextMessageContent\",\"delta\":\"b\"}\n\n"))
	select {
	case frame, ok := <-ch:
		if ok {
			t.Fatalf("unsubscribed follower still received %+v", frame)
		}
	case <-time.After(50 * time.Millisecond):
		// no delivery — expected
	}
}

// Finish must not drop already-logged frames if it races with catch-up delivery.
// Seed a large replay so Follow blocks on the 16-buffer, append more frames that
// become catch-up, then Finish while catch-up is in flight; the consumer must
// still see every seq before the channel closes.
func TestStreamHubFinishDuringCatchupDeliversLoggedFrames(t *testing.T) {
	h := NewStreamHub()
	const pre = 20
	const late = 20
	for i := 0; i < pre; i++ {
		h.Append(9, []byte(fmt.Sprintf("event: pre\ndata: {\"i\":%d}\n\n", i)))
	}

	ch, unsub := h.Follow(9, 0)
	defer unsub()

	// Allow deliverFollow to fill the buffer and block mid-replay.
	time.Sleep(20 * time.Millisecond)
	for i := 0; i < late; i++ {
		h.Append(9, []byte(fmt.Sprintf("event: late\ndata: {\"i\":%d}\n\n", i)))
	}

	want := pre + late
	seen := make([]int64, 0, want)

	// Drain enough for replay to finish and catch-up to begin, but leave the
	// buffer under pressure so Finish can race mid-catch-up.
	for i := 0; i < 8; i++ {
		select {
		case fr, ok := <-ch:
			if !ok {
				t.Fatal("channel closed before Finish")
			}
			seen = append(seen, fr.Seq)
		case <-time.After(time.Second):
			t.Fatal("timeout during initial drain")
		}
	}
	time.Sleep(10 * time.Millisecond)
	h.Finish(9)

	deadline := time.After(3 * time.Second)
	for {
		select {
		case fr, ok := <-ch:
			if !ok {
				if len(seen) != want {
					t.Fatalf("got %d frames after Finish mid-catch-up, want %d (seqs=%v)", len(seen), want, seen)
				}
				for i, s := range seen {
					if s != int64(i+1) {
						t.Fatalf("seq order broken at %d: %v", i, seen)
					}
				}
				return
			}
			seen = append(seen, fr.Seq)
		case <-deadline:
			t.Fatalf("timeout draining; got %d frames: %v", len(seen), seen)
		}
	}
}
