package api_service

import (
	"context"
	"testing"
	"time"

	"github.com/alicebob/miniredis/v2"
	"github.com/spf13/viper"

	rxCache "phytomni-server/cache"
	"phytomni-server/utils"
)

func startCacheForService(t *testing.T) *miniredis.Miniredis {
	t.Helper()
	mr, err := miniredis.Run()
	if err != nil {
		t.Fatalf("miniredis: %v", err)
	}
	t.Cleanup(mr.Close)
	viper.Set("redis.default", "web")
	viper.Set("redis.clients", map[string]interface{}{
		"web": map[string]interface{}{"type": "single-node", "addrs": []string{mr.Addr()}, "db": 0},
	})
	t.Cleanup(func() { viper.Set("redis.clients", nil); viper.Set("redis.default", "") })
	if err := rxCache.InitFromViper(); err != nil {
		t.Fatalf("cache init: %v", err)
	}
	return mr
}

// Self password change sets the per-user epoch (online session kill).
// The epoch must be approximately now (the real event time), NOT now+60s.
// A now+IatSkew epoch would double-count the skew and wrongly revoke recovery
// tokens issued up to 60s after the password change (C1 lockout, epoch path).
func TestModifyPassword_SetsEpoch(t *testing.T) {
	gdb := setupUserTestDB(t)
	startCacheForService(t)
	if err := gdb.Exec(`INSERT INTO users (id, email, password, code) VALUES (1, 'a@x.com', ?, 'user')`,
		utils.MD5String("oldpass")).Error; err != nil {
		t.Fatalf("seed: %v", err)
	}
	ps := NewService()
	before := time.Now().Unix()
	if _, err := ps.ModifyPassword(context.Background(), "a@x.com", "oldpass", "newpass"); err != nil {
		t.Fatalf("ModifyPassword: %v", err)
	}
	after := time.Now().Unix()
	epoch := rxCache.GetUserEpoch(context.Background(), "a@x.com")
	if epoch == 0 {
		t.Error("self password change must set the per-user revocation epoch")
	}
	// Guard: epoch must be ~now, not ~now+60. With now+IatSkew the epoch would be
	// ~now+60 and fail this band — this catches re-adding IatSkew at the SET site.
	if epoch < before-2 || epoch > after+2 {
		t.Errorf("epoch must be approximately now (the real event time), got %d; want in [%d, %d] — re-adding IatSkew at the SET site produces ~now+60 which fails this band", epoch, before-2, after+2)
	}
}

// Admin reset (id-keyed) resolves the target email and sets THAT user's epoch.
// The epoch must be approximately now (the real event time), NOT now+60s.
// A now+IatSkew epoch would double-count the skew and wrongly revoke recovery
// tokens issued up to 60s after the password reset (C1 lockout, epoch path).
func TestUpdateUserPassWord_SetsTargetEpoch(t *testing.T) {
	gdb := setupUserTestDB(t)
	startCacheForService(t)
	if err := gdb.Exec(`INSERT INTO users (id, email, password, code) VALUES (7, 'victim@x.com', ?, 'user')`,
		utils.MD5String("old")).Error; err != nil {
		t.Fatalf("seed: %v", err)
	}
	ps := NewService()
	before := time.Now().Unix()
	if ok := ps.UpdateUserPassWord(context.Background(), "Secret12!", 7); !ok {
		t.Fatal("admin reset returned false")
	}
	after := time.Now().Unix()
	epoch := rxCache.GetUserEpoch(context.Background(), "victim@x.com")
	if epoch == 0 {
		t.Error("admin password reset must set the TARGET user's epoch")
	}
	// Guard: epoch must be ~now, not ~now+60. With now+IatSkew the epoch would be
	// ~now+60 and fail this band — this catches re-adding IatSkew at the SET site.
	if epoch < before-2 || epoch > after+2 {
		t.Errorf("epoch must be approximately now (the real event time), got %d; want in [%d, %d] — re-adding IatSkew at the SET site produces ~now+60 which fails this band", epoch, before-2, after+2)
	}
}
