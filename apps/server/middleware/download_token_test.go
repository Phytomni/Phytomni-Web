package middleware

import (
	"strings"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/spf13/viper"
)

func setTestSecret(t *testing.T) {
	t.Helper()
	prev := viper.GetString("jwt.secret_key")
	viper.Set("jwt.secret_key", "unit-test-secret")
	t.Cleanup(func() { viper.Set("jwt.secret_key", prev) })
}

func TestDownloadTokenRoundTrip(t *testing.T) {
	setTestSecret(t)
	tok, err := GenerateDownloadToken("agent_data/user_data/web/runs/r1/out.zip", DownloadTokenTTL)
	if err != nil {
		t.Fatalf("generate: %v", err)
	}
	key, err := ParseDownloadToken(tok)
	if err != nil {
		t.Fatalf("parse: %v", err)
	}
	if key != "agent_data/user_data/web/runs/r1/out.zip" {
		t.Errorf("key = %q", key)
	}
}

func TestDownloadTokenRejectsEmptyKey(t *testing.T) {
	setTestSecret(t)
	if _, err := GenerateDownloadToken("", DownloadTokenTTL); err == nil {
		t.Error("empty key must not be signable")
	}
}

func TestDownloadTokenExpiry(t *testing.T) {
	setTestSecret(t)
	tok, err := GenerateDownloadToken("k.zip", -1*time.Minute)
	if err != nil {
		t.Fatalf("generate: %v", err)
	}
	if _, err := ParseDownloadToken(tok); err == nil {
		t.Error("expired token must fail")
	}
}

func TestDownloadTokenTamper(t *testing.T) {
	setTestSecret(t)
	tok, _ := GenerateDownloadToken("k.zip", DownloadTokenTTL)
	parts := strings.Split(tok, ".")
	if len(parts) != 3 {
		t.Fatalf("unexpected token shape")
	}
	tampered := parts[0] + "." + parts[1] + "x." + parts[2]
	if _, err := ParseDownloadToken(tampered); err == nil {
		t.Error("tampered token must fail")
	}
	if _, err := ParseDownloadToken(""); err == nil {
		t.Error("empty token must fail")
	}
}

func TestDownloadTokenWrongSecret(t *testing.T) {
	setTestSecret(t)
	tok, _ := GenerateDownloadToken("k.zip", DownloadTokenTTL)
	viper.Set("jwt.secret_key", "rotated-secret")
	if _, err := ParseDownloadToken(tok); err == nil {
		t.Error("token signed with old secret must fail after rotation")
	}
}

func TestDownloadTokenRejectsNonHS256Algorithm(t *testing.T) {
	setTestSecret(t)
	claims := &downloadClaims{
		ObsKey: "k.zip",
		RegisteredClaims: jwt.RegisteredClaims{
			ExpiresAt: jwt.NewNumericDate(time.Now().Add(DownloadTokenTTL)),
		},
	}
	tok, err := jwt.NewWithClaims(jwt.SigningMethodHS384, claims).SignedString(jwtSecret())
	if err != nil {
		t.Fatalf("sign HS384 token: %v", err)
	}
	if _, err := ParseDownloadToken(tok); err == nil {
		t.Error("download token signed with HS384 must fail")
	}
}
