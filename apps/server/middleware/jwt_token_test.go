package middleware

import (
	"testing"
	"time"

	"github.com/golang-jwt/jwt"
	"github.com/spf13/viper"
)

func TestGenerateToken_SetsIatAndExp(t *testing.T) {
	viper.Set("jwt.secret_key", "test-secret")
	t.Cleanup(func() { viper.Set("jwt.secret_key", "") })

	before := time.Now()
	tokenStr, err := GenerateToken("alice@x.com")
	if err != nil {
		t.Fatalf("GenerateToken: %v", err)
	}

	claims := &Claims{}
	if _, err := jwt.ParseWithClaims(tokenStr, claims, func(*jwt.Token) (interface{}, error) {
		return []byte("test-secret"), nil
	}); err != nil {
		t.Fatalf("parse: %v", err)
	}

	if claims.IssuedAt == 0 {
		t.Fatal("IssuedAt must be set (revocation floor compares against it)")
	}
	// iat = now-60s: must be <= now and within ~65s below `before`.
	if claims.IssuedAt > before.Unix() {
		t.Errorf("IssuedAt %d must not be in the future (>%d)", claims.IssuedAt, before.Unix())
	}
	if diff := before.Unix() - claims.IssuedAt; diff < 55 || diff > 70 {
		t.Errorf("IssuedAt should be ~60s before now, got %ds before", diff)
	}
	// exp - iat must equal TokenLifetime + 60s (exp=now+lifetime, iat=now-60s).
	wantSpan := int64(TokenLifetime/time.Second) + 60
	if span := claims.ExpiresAt - claims.IssuedAt; span != wantSpan {
		t.Errorf("exp-iat = %ds, want %ds (TokenLifetime+60s)", span, wantSpan)
	}
}
