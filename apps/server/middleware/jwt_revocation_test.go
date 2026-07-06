package middleware

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/alicebob/miniredis/v2"
	"github.com/gin-gonic/gin"
	"github.com/glebarez/sqlite"
	"github.com/golang-jwt/jwt"
	"github.com/spf13/viper"
	"gorm.io/gorm"

	rxCache "phytomni-server/cache"
	"phytomni-server/db"
)

// setupRevocationEnv wires miniredis (for the cache layer) + an in-memory sqlite
// users table (for the floor read) and a gin engine whose only route is guarded by
// AuthMiddleware and echoes 200. Returns the engine + the miniredis handle.
func setupRevocationEnv(t *testing.T) (*gin.Engine, *miniredis.Miniredis, *gorm.DB) {
	t.Helper()
	gin.SetMode(gin.TestMode)
	viper.Set("jwt.secret_key", "test-secret")
	t.Cleanup(func() { viper.Set("jwt.secret_key", "") })

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

	gdb, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatalf("sqlite: %v", err)
	}
	if sqlDB, e := gdb.DB(); e == nil {
		sqlDB.SetMaxOpenConns(1)
	}
	if err := gdb.Exec(`CREATE TABLE users (id INTEGER PRIMARY KEY AUTOINCREMENT, email TEXT, password_change_at DATETIME)`).Error; err != nil {
		t.Fatalf("create users: %v", err)
	}
	db.Set("phytomni-server", gdb)

	r := gin.New()
	r.GET("/probe", AuthMiddleware(), func(c *gin.Context) { c.JSON(200, gin.H{"ok": true}) })
	return r, mr, gdb
}

func bearer(t *testing.T, username string) string {
	t.Helper()
	tok, err := GenerateToken(username)
	if err != nil {
		t.Fatalf("token: %v", err)
	}
	return "Bearer " + tok
}

func do(r *gin.Engine, auth string) int {
	req := httptest.NewRequest(http.MethodGet, "/probe", nil)
	if auth != "" {
		req.Header.Set("Authorization", auth)
	}
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	return w.Code
}

func TestAuthMiddleware_ValidTokenPasses(t *testing.T) {
	r, _, gdb := setupRevocationEnv(t)
	gdb.Exec(`INSERT INTO users (id, email) VALUES (1, 'alice@x.com')`) // NULL password_change_at
	if code := do(r, bearer(t, "alice@x.com")); code != 200 {
		t.Fatalf("valid token: want 200, got %d", code)
	}
}

func TestAuthMiddleware_BlocklistedTokenRejected(t *testing.T) {
	r, _, gdb := setupRevocationEnv(t)
	gdb.Exec(`INSERT INTO users (id, email) VALUES (1, 'alice@x.com')`)
	tok, _ := GenerateToken("alice@x.com")
	if err := rxCache.Block(testCtx(), rxCache.HashToken(tok), time.Hour); err != nil {
		t.Fatalf("block: %v", err)
	}
	if code := do(r, "Bearer "+tok); code != 401 {
		t.Fatalf("blocklisted token: want 401, got %d", code)
	}
}

func TestAuthMiddleware_EpochRevokesOlderToken(t *testing.T) {
	r, _, gdb := setupRevocationEnv(t)
	gdb.Exec(`INSERT INTO users (id, email) VALUES (1, 'alice@x.com')`)
	auth := bearer(t, "alice@x.com") // iat = now-60s
	// Epoch set just after the token's iat → iat < epoch → revoked.
	if err := rxCache.SetUserEpoch(testCtx(), "alice@x.com", time.Now().Add(time.Minute), time.Hour); err != nil {
		t.Fatalf("epoch: %v", err)
	}
	if code := do(r, auth); code != 401 {
		t.Fatalf("epoch-revoked token: want 401, got %d", code)
	}
}

func TestAuthMiddleware_FloorRevokesOnPasswordChange_RedisDown(t *testing.T) {
	r, mr, gdb := setupRevocationEnv(t)
	auth := bearer(t, "alice@x.com") // iat = now-60s
	// password_change_at AFTER the token's iat → floor rejects (iat>0 && iat<floor).
	future := time.Now().Add(time.Minute)
	gdb.Exec(`INSERT INTO users (id, email, password_change_at) VALUES (1, 'alice@x.com', ?)`, future)
	mr.Close() // Redis down → blocklist+epoch fail-open, but the DB floor still rejects.
	if code := do(r, auth); code != 401 {
		t.Fatalf("password-change floor (Redis down): want 401, got %d", code)
	}
}

func TestAuthMiddleware_FloorExemptsLegacyIatZero(t *testing.T) {
	r, _, gdb := setupRevocationEnv(t)
	// A legacy token with iat=0 (issued before this feature). Hand-sign it so iat is unset.
	viper.Set("jwt.secret_key", "test-secret")
	claims := &Claims{Username: "alice@x.com"}
	claims.ExpiresAt = time.Now().Add(time.Hour).Unix() // exp set, iat left 0
	legacy := signClaims(t, claims)
	// password_change_at in the past but positive → floor>0; iat=0 is EXEMPT (no mass logout).
	past := time.Now().Add(-24 * time.Hour)
	gdb.Exec(`INSERT INTO users (id, email, password_change_at) VALUES (1, 'alice@x.com', ?)`, past)
	if code := do(r, "Bearer "+legacy); code != 200 {
		t.Fatalf("legacy iat=0 must be exempt from the floor: want 200, got %d", code)
	}
}

// TestAuthMiddleware_EpochRevokesLegacyIatZero locks spec §6 layer-2 invariant:
// a legacy token with iat=0 MUST be revoked when a positive per-user epoch exists.
// The floor (layer 3) is skipped because password_change_at is NULL; only the epoch gate fires.
func TestAuthMiddleware_EpochRevokesLegacyIatZero(t *testing.T) {
	r, _, gdb := setupRevocationEnv(t)
	// NULL password_change_at → floor is skipped; only layer 2 (epoch) can gate this token.
	gdb.Exec(`INSERT INTO users (id, email) VALUES (1, 'alice@x.com')`)

	// Hand-sign a legacy token: IssuedAt left 0, only ExpiresAt set.
	claims := &Claims{Username: "alice@x.com"}
	claims.ExpiresAt = time.Now().Add(time.Hour).Unix()
	legacy := signClaims(t, claims)

	// Set a positive per-user epoch (epoch > 0, and iat=0 < epoch) → must revoke.
	if err := rxCache.SetUserEpoch(testCtx(), "alice@x.com", time.Now(), time.Hour); err != nil {
		t.Fatalf("epoch: %v", err)
	}

	if code := do(r, "Bearer "+legacy); code != 401 {
		t.Fatalf("legacy iat=0 token must be revoked by a positive epoch (layer 2): want 401, got %d", code)
	}
}

// TestAuthMiddleware_FreshTokenAfterPasswordChangeNotRevokedByFloor reproduces C1 bug:
// re-login within 5s of a password change yields a token with iat=now-60s < floor=now-5s;
// the old logic would return 401. After the fix, floor-60s is below iat, so 200 is expected.
func TestAuthMiddleware_FreshTokenAfterPasswordChangeNotRevokedByFloor(t *testing.T) {
	r, _, gdb := setupRevocationEnv(t)
	// password_change_at = 5s ago; no Redis epoch (NULL row).
	changeAt := time.Now().Add(-5 * time.Second)
	gdb.Exec(`INSERT INTO users (id, email, password_change_at) VALUES (1, 'alice@x.com', ?)`, changeAt)
	// fresh token: iat = now-60s (GenerateToken subtracts iatSkew), but issued after changeAt.
	auth := bearer(t, "alice@x.com")
	if code := do(r, auth); code != 200 {
		t.Fatalf("fresh token after password change (floor layer): want 200, got %d — C1 lockout not fixed", code)
	}
}

// TestAuthMiddleware_FreshTokenAfterPasswordChangeNotRevokedByEpoch reproduces C1 bug:
// epoch set 5s ago, fresh token iat=now-60s; old logic returned 401.
// After the fix, epoch-60s is below iat, so 200 is expected.
func TestAuthMiddleware_FreshTokenAfterPasswordChangeNotRevokedByEpoch(t *testing.T) {
	r, _, gdb := setupRevocationEnv(t)
	// NULL password_change_at; epoch = 5s ago.
	gdb.Exec(`INSERT INTO users (id, email) VALUES (1, 'alice@x.com')`)
	if err := rxCache.SetUserEpoch(testCtx(), "alice@x.com", time.Now().Add(-5*time.Second), time.Hour); err != nil {
		t.Fatalf("epoch: %v", err)
	}
	auth := bearer(t, "alice@x.com")
	if code := do(r, auth); code != 200 {
		t.Fatalf("fresh token after password change (epoch layer): want 200, got %d — C1 lockout not fixed", code)
	}
}

// TestAuthMiddleware_AlgNoneTokenRejected forges a token with alg=none (signed
// with UnsafeAllowNoneSignatureType, the only way to produce a none token).
// The keyfunc returns []byte, not UnsafeAllowNoneSignatureType, so golang-jwt's
// own type guard already rejects this — but the alg-pin makes the rejection
// explicit so a future library loosening can't silently reopen the hole.
func TestAuthMiddleware_AlgNoneTokenRejected(t *testing.T) {
	r, _, gdb := setupRevocationEnv(t)
	gdb.Exec(`INSERT INTO users (id, email) VALUES (1, 'alice@x.com')`)
	claims := &Claims{Username: "alice@x.com"}
	claims.ExpiresAt = time.Now().Add(time.Hour).Unix()
	claims.IssuedAt = time.Now().Add(-IatSkew).Unix()
	tok := jwt.NewWithClaims(jwt.SigningMethodNone, claims)
	forged, err := tok.SignedString(jwt.UnsafeAllowNoneSignatureType)
	if err != nil {
		t.Fatalf("sign none: %v", err)
	}
	if code := do(r, "Bearer "+forged); code != 401 {
		t.Fatalf("alg=none token: want 401, got %d", code)
	}
}

// TestAuthMiddleware_AlgConfusionHS384Rejected forges a token with alg=HS384
// signed with the HS256 secret. Without WithValidMethods, golang-jwt accepts
// any HMAC variant (HS256/HS384/HS512) with a []byte key, so this token would
// wrongly verify. The alg-pin must reject it (only HS256 is allowed).
func TestAuthMiddleware_AlgConfusionHS384Rejected(t *testing.T) {
	r, _, gdb := setupRevocationEnv(t)
	gdb.Exec(`INSERT INTO users (id, email) VALUES (1, 'alice@x.com')`)
	claims := &Claims{Username: "alice@x.com"}
	claims.ExpiresAt = time.Now().Add(time.Hour).Unix()
	claims.IssuedAt = time.Now().Add(-IatSkew).Unix()
	tok := jwt.NewWithClaims(jwt.SigningMethodHS384, claims)
	forged, err := tok.SignedString([]byte(viper.GetString("jwt.secret_key")))
	if err != nil {
		t.Fatalf("sign hs384: %v", err)
	}
	if code := do(r, "Bearer "+forged); code != 401 {
		t.Fatalf("HS384 alg-confusion token: want 401, got %d", code)
	}
}

func testCtx() context.Context { return context.Background() }

func signClaims(t *testing.T, c *Claims) string {
	t.Helper()
	tok := jwt.NewWithClaims(jwt.SigningMethodHS256, c)
	s, err := tok.SignedString([]byte("test-secret"))
	if err != nil {
		t.Fatalf("sign: %v", err)
	}
	return s
}
