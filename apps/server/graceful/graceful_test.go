package graceful

import (
	"os"
	"syscall"
	"testing"
)

func TestGracefulSignalsAreTrappable(t *testing.T) {
	if len(gracefulSignals) != 2 {
		t.Fatalf("gracefulSignals = %v, want exactly interrupt and SIGTERM", gracefulSignals)
	}

	seen := make(map[os.Signal]bool, len(gracefulSignals))
	for _, signal := range gracefulSignals {
		seen[signal] = true
	}
	if !seen[os.Interrupt] {
		t.Error("gracefulSignals must include os.Interrupt")
	}
	if !seen[syscall.SIGTERM] {
		t.Error("gracefulSignals must include syscall.SIGTERM")
	}
	if seen[os.Kill] {
		t.Error("gracefulSignals must not include os.Kill because it cannot be trapped")
	}
}
