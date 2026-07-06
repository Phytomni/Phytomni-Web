package base

import (
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
	schedulers = append(schedulers, c)
	return nil
}

// schedulers holds every started cron.Cron so its registered entries can be
// inspected at runtime. Populated by initFromViper; read by Entries.
var schedulers []*cron.Cron

// Entries returns a snapshot of all scheduled entries across every started
// scheduler. Callers (the admin cron-entries endpoint) use this to inspect
// whether background jobs are registered and when they next run.
func Entries() []cron.Entry {
	var out []cron.Entry
	for _, c := range schedulers {
		out = append(out, c.Entries()...)
	}
	return out
}
