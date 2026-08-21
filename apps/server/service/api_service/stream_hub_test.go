package api_service

import (
	"bytes"
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
