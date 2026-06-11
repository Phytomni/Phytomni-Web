package middleware

import (
	"errors"
	"time"

	"github.com/golang-jwt/jwt"
)

// 下载短时 token:浏览器侧的 window.open / <img src> / 邮件链接无法携带
// Authorization 头,所以文件下载端点改用 query 参数里的短时 JWT 鉴权 —
// token 绑定一个具体的 OBS object key,过期即失效,复用 jwt.secret_key 签名。

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
		return "", errors.New("无效或已过期的下载链接")
	}
	return claims.ObsKey, nil
}
