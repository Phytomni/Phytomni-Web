package api_handler

import (
	"bytes"
	"testing"
)

type countingFlusher struct {
	count int
}

func (flusher *countingFlusher) Flush() {
	flusher.count++
}

func TestCopyExecutionStreamFlushesForwardedSSE(t *testing.T) {
	var destination bytes.Buffer
	flusher := &countingFlusher{}
	source := bytes.NewBufferString(": heartbeat\n\nevent: execution_tracking\ndata: {}\n\n")

	written, err := copyExecutionStream(&destination, flusher, source, "turn-stream")

	if err != nil {
		t.Fatalf("copy execution stream: %v", err)
	}
	if written != int64(destination.Len()) {
		t.Fatalf("written=%d len=%d", written, destination.Len())
	}
	if flusher.count == 0 {
		t.Fatal("expected forwarded SSE bytes to be flushed")
	}
}
