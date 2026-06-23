package cache

import (
	"sync"
	"testing"
)

func TestObserveFailOpen_CountsEveryCall(t *testing.T) {
	resetFailOpenForTest()
	for i := 0; i < 5; i++ {
		ObserveFailOpen("revocation")
	}
	if got := FailOpenCount(); got != 5 {
		t.Errorf("FailOpenCount = %d, want 5 (counter increments on every call)", got)
	}
}

func TestObserveFailOpen_ConcurrentSafe(t *testing.T) {
	resetFailOpenForTest()
	var wg sync.WaitGroup
	for i := 0; i < 100; i++ {
		wg.Add(1)
		go func() { defer wg.Done(); ObserveFailOpen("ratelimit") }()
	}
	wg.Wait()
	if got := FailOpenCount(); got != 100 {
		t.Errorf("FailOpenCount = %d, want 100 (must be race-free)", got)
	}
}
