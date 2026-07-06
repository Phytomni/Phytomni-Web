package base

import (
	"sync"

	"github.com/robfig/cron/v3"
	"github.com/spf13/viper"
	rxLog "phytomni-server/log"
)

type Cron interface {
	Spec() string
	Run()
}

// cronLog adapts the zap sugared logger to cron's Printf-style logger interface.
// cron.PrintfLogger wraps a Printf method; zap's SugaredLogger has Infof but no
// Printf, so this thin shim bridges the two.
type cronLog struct{}

func (cronLog) Printf(format string, args ...interface{}) { rxLog.Sugar().Infof(format, args...) }

// chainOpt returns a cron.Option that decorates every job with panic recovery
// and an overlap guard. Recover logs a panicking job instead of crashing the
// scheduler goroutine; SkipIfStillRunning drops a tick whose previous Run has
// not returned yet, so the reconciler's zero-value-sensitive map Updates never
// races two concurrent Runs over the same QuestionAgentLog rows.
func chainOpt() cron.Option {
	logger := cron.PrintfLogger(cronLog{})
	return cron.WithChain(cron.Recover(logger), cron.SkipIfStillRunning(logger))
}

// InitFromSecond runs cron jobs at second-level granularity.
func InitFromSecond(cronList []Cron) error {
	if !viper.GetBool("cron.switch") {
		return nil
	}
	if err := initFromViper(cron.New(cron.WithSeconds(), chainOpt()), cronList); err != nil {
		return err
	}
	return nil
}

// InitFromMinute runs cron jobs at minute-level granularity.
func InitFromMinute(cronList []Cron) error {
	if !viper.GetBool("cron.switch") {
		return nil
	}
	if err := initFromViper(cron.New(chainOpt()), cronList); err != nil {
		return err
	}
	return nil
}

func initFromViper(c *cron.Cron, cronList []Cron) error {
	for _, task := range cronList {
		if _, err := c.AddFunc(task.Spec(), task.Run); err != nil {
			return err
		}
	}
	c.Start()
	schedulersMu.Lock()
	schedulers = append(schedulers, c)
	schedulersMu.Unlock()
	return nil
}

// schedulers holds every started cron.Cron so its registered entries can be
// inspected at runtime. Populated by initFromViper; read by Entries.
// schedulersMu guards every access so cross-package parallel tests (go test
// ./... runs packages concurrently) cannot race a base-package test mutating
// the slice against a service-package test reading it via Entries. Production
// code only touches the slice during boot (single goroutine), but the mutex
// future-proofs any runtime re-init path and keeps the race detector honest.
var schedulers []*cron.Cron
var schedulersMu sync.RWMutex

// Entries returns a snapshot of all scheduled entries across every started
// scheduler. Callers (the admin cron-entries endpoint) use this to inspect
// whether background jobs are registered and when they next run.
func Entries() []cron.Entry {
	schedulersMu.RLock()
	defer schedulersMu.RUnlock()
	var out []cron.Entry
	for _, c := range schedulers {
		out = append(out, c.Entries()...)
	}
	return out
}

// resetSchedulersForTest stops every started scheduler and clears the slice
// under the write lock. Test-only: production never resets schedulers after
// boot. Exists so cross-package parallel tests don't race this cleanup write
// against a service-package test's Entries() read.
func resetSchedulersForTest() {
	schedulersMu.Lock()
	defer schedulersMu.Unlock()
	for _, c := range schedulers {
		c.Stop()
	}
	schedulers = nil
}
