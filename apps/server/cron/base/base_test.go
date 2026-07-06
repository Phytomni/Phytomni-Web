package base

import (
	"sync/atomic"
	"testing"
	"time"

	"github.com/robfig/cron/v3"
)

// jobCron adapts a func to the Cron interface for testing.
type testJob struct {
	spec string
	run  func()
}

func (j testJob) Spec() string { return j.spec }
func (j testJob) Run()         { j.run() }

// TestChain_SkipIfStillRunning: a job whose Run outlasts the tick interval must
// NOT start a second concurrent Run — SkipIfStillRunning drops the overlap.
func TestChain_SkipIfStillRunning(t *testing.T) {
	var concurrent int32
	var maxConcurrent int32
	logger := cron.PrintfLogger(testLogf(t))
	c := cron.New(cron.WithSeconds(), cron.WithChain(cron.Recover(logger), cron.SkipIfStillRunning(logger)))
	_, err := c.AddFunc("* * * * * *", func() { // every second
		n := atomic.AddInt32(&concurrent, 1)
		if n > atomic.LoadInt32(&maxConcurrent) {
			atomic.StoreInt32(&maxConcurrent, n)
		}
		time.Sleep(2500 * time.Millisecond) // outlast 2+ ticks
		atomic.AddInt32(&concurrent, -1)
	})
	if err != nil {
		t.Fatalf("add: %v", err)
	}
	c.Start()
	defer c.Stop()
	time.Sleep(3500 * time.Millisecond)
	if got := atomic.LoadInt32(&maxConcurrent); got > 1 {
		t.Fatalf("SkipIfStillRunning failed: max concurrent runs = %d, want 1", got)
	}
}

// TestChain_Recover: a panicking job must not kill the scheduler — a later tick
// of a second job still fires.
func TestChain_Recover(t *testing.T) {
	var survivorRan int32
	logger := cron.PrintfLogger(testLogf(t))
	c := cron.New(cron.WithSeconds(), cron.WithChain(cron.Recover(logger)))
	if _, err := c.AddFunc("* * * * * *", func() { panic("boom") }); err != nil {
		t.Fatalf("add panic job: %v", err)
	}
	if _, err := c.AddFunc("* * * * * *", func() { atomic.AddInt32(&survivorRan, 1) }); err != nil {
		t.Fatalf("add survivor: %v", err)
	}
	c.Start()
	defer c.Stop()
	time.Sleep(2500 * time.Millisecond)
	if atomic.LoadInt32(&survivorRan) == 0 {
		t.Fatal("Recover failed: survivor job never ran after a panic killed the scheduler")
	}
}

// testLogf adapts *testing.T to a Printf-style logger for cron.
type tLogf func(format string, args ...interface{})

func (f tLogf) Printf(format string, args ...interface{}) { f(format, args...) }
func testLogf(t *testing.T) tLogf {
	return func(format string, args ...interface{}) { t.Logf(format, args...) }
}
