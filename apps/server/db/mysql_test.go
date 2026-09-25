package db

import (
	"os"
	"sync"
	"testing"

	"gorm.io/gorm"
)

// unsetEnvForTest ensures key is not set for the duration of the test, restoring
// the original value (if any) in cleanup.
func unsetEnvForTest(t *testing.T, key string) {
	t.Helper()
	old, hadOld := os.LookupEnv(key)
	os.Unsetenv(key)
	t.Cleanup(func() {
		if hadOld {
			_ = os.Setenv(key, old)
		}
	})
}

// TestApplyEnvDSN_EnvSet asserts that when PHYTOMNI_DB_DSN is set, the env
// value overrides the file-loaded DSN.
func TestApplyEnvDSN_EnvSet(t *testing.T) {
	t.Setenv("PHYTOMNI_DB_DSN", "env-dsn-value")
	cfg := Config{Dsn: "file-dsn-value"}
	got := applyEnvDSN(cfg)
	if got.Dsn != "env-dsn-value" {
		t.Fatalf("Dsn = %q, want %q (env must win over file)", got.Dsn, "env-dsn-value")
	}
}

// TestApplyEnvDSN_FileValueWhenEnvUnset is the equivalence test: when
// PHYTOMNI_DB_DSN is unset, the file-loaded DSN is retained — byte-identical
// to today's behavior.
func TestApplyEnvDSN_FileValueWhenEnvUnset(t *testing.T) {
	unsetEnvForTest(t, "PHYTOMNI_DB_DSN")
	cfg := Config{Dsn: "file-dsn-value"}
	got := applyEnvDSN(cfg)
	if got.Dsn != "file-dsn-value" {
		t.Fatalf("Dsn = %q, want %q (file value must win when env unset)", got.Dsn, "file-dsn-value")
	}
}

func TestDBRegistryConcurrentSetGetAndMapSwap(t *testing.T) {
	const name = "task64-race"
	first := &gorm.DB{}
	second := &gorm.DB{}
	third := &gorm.DB{}
	previous := dbs
	t.Cleanup(func() { swapDBs(previous) })
	swapDBs(map[string]*gorm.DB{name: first})

	var wg sync.WaitGroup
	start := make(chan struct{})
	for _, candidate := range []*gorm.DB{first, second, third} {
		candidate := candidate
		wg.Add(1)
		go func() {
			defer wg.Done()
			<-start
			for i := 0; i < 1000; i++ {
				Set(name, candidate)
			}
		}()
	}
	for i := 0; i < 3; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			<-start
			for j := 0; j < 1000; j++ {
				_, _ = Get(name)
			}
		}()
	}
	wg.Add(1)
	go func() {
		defer wg.Done()
		<-start
		for i := 0; i < 1000; i++ {
			if i%2 == 0 {
				swapDBs(map[string]*gorm.DB{name: second})
			} else {
				swapDBs(map[string]*gorm.DB{name: third})
			}
		}
	}()

	close(start)
	wg.Wait()
}
