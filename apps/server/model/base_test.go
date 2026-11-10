package model

import (
	"context"
	"errors"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/glebarez/sqlite"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"

	"phytomni-server/db"
	"phytomni-server/utils"
)

func setupContextDB(t *testing.T) {
	t.Helper()
	mode := gin.Mode()
	gin.SetMode(gin.TestMode)
	t.Cleanup(func() { gin.SetMode(mode) })
	gdb, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{Logger: logger.Discard})
	if err != nil {
		t.Fatal(err)
	}
	sqlDB, err := gdb.DB()
	if err != nil {
		t.Fatal(err)
	}
	sqlDB.SetMaxOpenConns(1)
	previous, _ := db.Get("phytomni-server")
	db.Set("phytomni-server", gdb)
	t.Cleanup(func() {
		db.Set("phytomni-server", previous)
		if err := sqlDB.Close(); err != nil {
			t.Error(err)
		}
	})
}

func TestDBPreservesRequestLifetimeAndSnapshotsGinMetadata(t *testing.T) {
	setupContextDB(t)
	for _, fallback := range []bool{false, true} {
		name := "fallback_disabled"
		if fallback {
			name = "fallback_enabled"
		}
		t.Run(name, func(t *testing.T) {
			deadline := time.Now().Add(time.Hour)
			parent, cancel := context.WithDeadline(utils.WithRequestID(context.Background(), "request-one"), deadline)
			defer cancel()
			c, engine := gin.CreateTestContext(httptest.NewRecorder())
			engine.ContextWithFallback = fallback
			c.Request = httptest.NewRequest("GET", "/first", nil).WithContext(parent)
			c.Set("username", "first@example.test")
			c.Set("user_id", int64(17))
			c.Set("x-request-id", "http-request-one")
			scoped := DB(c)
			stable := scoped.Statement.Context

			// Gin may recycle this object immediately after ServeHTTP returns.
			c.Request = httptest.NewRequest("GET", "/next", nil)
			c.Set("username", "next@example.test")
			c.Set("user_id", int64(99))
			c.Set("x-request-id", "http-request-next")
			for key, want := range map[string]interface{}{
				"username": "first@example.test", "user_id": int64(17), "x-request-id": "http-request-one",
			} {
				if got := stable.Value(key); got != want {
					t.Errorf("database metadata %s = %v, want %v", key, got, want)
				}
			}
			if id, ok := utils.RequestID(stable); !ok || id != "request-one" {
				t.Errorf("request context metadata = %q/%v", id, ok)
			}
			if got, ok := stable.Deadline(); !ok || !got.Equal(deadline) {
				t.Errorf("deadline = %v/%v, want %v", got, ok, deadline)
			}
			if stable.Done() != parent.Done() {
				t.Error("database context lost original request cancellation")
			}
			cancel()
			if !errors.Is(stable.Err(), context.Canceled) {
				t.Errorf("context error = %v, want canceled", stable.Err())
			}
			var value int
			if err := scoped.Raw("SELECT 1").Scan(&value).Error; !errors.Is(err, context.Canceled) {
				t.Errorf("canceled database query = %v, want context.Canceled", err)
			}
		})
	}
}

func TestDBPreservesPlainContext(t *testing.T) {
	setupContextDB(t)
	ctx := utils.WithRequestID(context.Background(), "background-job")
	if DB(ctx).Statement.Context != ctx {
		t.Fatal("non-HTTP database context must remain unchanged")
	}
}

func TestDBSnapshotsGinMetadataWithoutRequest(t *testing.T) {
	setupContextDB(t)
	c, _ := gin.CreateTestContext(httptest.NewRecorder())
	c.Set("username", "synthetic@example.test")
	stable := DB(c).Statement.Context
	c.Set("username", "another@example.test")
	if got := stable.Value("username"); got != "synthetic@example.test" {
		t.Fatalf("metadata = %v, want original synthetic account", got)
	}
	if stable.Done() != nil || stable.Err() != nil {
		t.Fatal("request-less context must retain its uncanceled background lifetime")
	}
}
