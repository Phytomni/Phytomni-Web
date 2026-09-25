package graceful

import (
	"context"
	"log"
	"os"
	"os/signal"
	"sync"
	"syscall"
)

var wg sync.WaitGroup
var ctx, cancel = context.WithCancel(context.Background())
var gracefulSignals = []os.Signal{os.Interrupt, syscall.SIGTERM}

type Graceful interface {
	GracefulStart(ctx context.Context)
}

func StartFunc(f func(ctx context.Context)) {
	wg.Add(1)
	go func() {
		defer wg.Done()
		f(ctx)
	}()
}

func Start(srv Graceful) {
	wg.Add(1)
	go func() {
		defer wg.Done()
		srv.GracefulStart(ctx)
	}()
}

func Wait() {
	s := make(chan os.Signal, 1)
	signal.Notify(s, gracefulSignals...)
	<-s
	log.Println("graceful stopping...")
	cancel()
	wg.Wait()
}
