package middleware

import (
	"errors"
	"time"

	"github.com/golang-jwt/jwt"
)

// Short-lived download token: the browser's window.open / <img src> / email
// links cannot carry an Authorization header, so file-download endpoints
// authenticate via a short-lived JWT in a query parameter — the token is bound
// to one specific OBS object key, expires automatically, and is signed with the
// shared jwt.secret_key.

// DownloadTokenTTL is the lifetime of a chat-surface download URL. The
// frontend opens/renders the URL immediately after fetching it, so a short
// window is enough; a page reload re-fetches fresh URLs.
const DownloadTokenTTL = 10 * time.Minute

type downloadClaims struct {
	ObsKey string `json:"obs_key"`
	jwt.StandardClaims
}

// GenerateDownloadToken signs a short-lived token bound to one OBS object key.
func GenerateDownloadToken(obsKey string, ttl time.Duration) (string, error) {
	if obsKey == "" {
		return "", errors.New("empty obs key")
	}
	claims := &downloadClaims{
		ObsKey: obsKey,
		StandardClaims: jwt.StandardClaims{
			ExpiresAt: time.Now().Add(ttl).Unix(),
		},
	}
	return jwt.NewWithClaims(jwt.SigningMethodHS256, claims).SignedString(jwtSecret())
}

// ParseDownloadToken verifies a download token and returns the bound OBS key.
func ParseDownloadToken(token string) (string, error) {
	claims := &downloadClaims{}
	parsed, err := jwt.ParseWithClaims(token, claims, func(*jwt.Token) (interface{}, error) {
		return jwtSecret(), nil
	})
	if err != nil || !parsed.Valid || claims.ObsKey == "" {
		return "", errors.New("invalid or expired download link")
	}
	return claims.ObsKey, nil
}
