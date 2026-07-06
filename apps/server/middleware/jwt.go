package middleware

import (
	"net/http"
	rxCache "phytomni-server/cache"
	"phytomni-server/common"
	"phytomni-server/model"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/golang-jwt/jwt"
	"github.com/spf13/viper"
)

// jwtSecret reads jwt.secret_key from viper for HS256 signing/verification of
// this service's user tokens. (Bot does not consume Web user JWTs — it uses a
// ptm_ service key, so this secret has no cross-repo consumer.)
func jwtSecret() []byte {
	return []byte(viper.GetString("jwt.secret_key"))
}

type Claims struct {
	Username string `json:"username"`
	jwt.StandardClaims
}

// TokenLifetime is the user JWT lifetime. GenerateToken uses it for exp and the
// revocation layer uses it as the TTL for the per-user epoch key — sharing one
// constant prevents drift between the two sides.
const TokenLifetime = 24 * time.Hour

// IatSkew is the issuer's backward offset on iat, absorbing multi-instance/NTP
// clock skew. GenerateToken sets iat = now-IatSkew; the revocation layer
// subtracts IatSkew when comparing iat against epoch/floor, so the semantics are
// "revoke if token was genuinely issued before the event" — both sides share the
// same constant to prevent drift.
// Revocation-event writers (logout-all, password change) MUST set epoch to now
// (the real event time) and never add IatSkew — the comparison already subtracts
// IatSkew, so the net effect is "revoke only tokens issued before this moment";
// writing now+IatSkew would double-count skew and wrongly revoke recovery tokens
// issued within 60s after a password change (the C1 lockout epoch-path variant).
const IatSkew = 60 * time.Second

func GenerateToken(username string) (string, error) {
	now := time.Now()
	claims := &Claims{
		Username: username,
		StandardClaims: jwt.StandardClaims{
			// iat = now-iatSkew: absorbs multi-instance/NTP skew and is never in the future
			// (golang-jwt v3 verifyIat has no leeway, strict now>=iat). The revocation layer
			// compares iat against epoch/floor.
			IssuedAt:  now.Add(-IatSkew).Unix(),
			ExpiresAt: now.Add(TokenLifetime).Unix(),
		},
	}

	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	return token.SignedString(jwtSecret())
}

func AuthMiddleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		tokenString := c.GetHeader("Authorization")
		if tokenString == "" {
			c.JSON(http.StatusUnauthorized, gin.H{
				"detail": gin.H{
					"code":  common.FORBID,
					"error": "missing authorization header",
				},
			})
			c.Abort()
			return
		}

		if len(tokenString) < 7 || tokenString[:7] != "Bearer " {
			c.JSON(http.StatusUnauthorized, gin.H{
				"detail": gin.H{
					"code":  common.FORBID,
					"error": "invalid authorization header format",
				},
			})
			c.Abort()
			return
		}

		token := tokenString[7:]
		claims := &Claims{}
		parsedToken, err := jwt.ParseWithClaims(token, claims, func(parsedToken *jwt.Token) (interface{}, error) {
			// Alg-pin: only HS256 is accepted. The keyfunc is the v3 equivalent of
			// WithValidMethods(["HS256"]) (introduced in v4+; this repo pins v3.2.2).
			// Returning nil — never the secret — for a wrong alg means the signature
			// is never verified against an unintended method (alg-confusion defense).
			if parsedToken.Method.Alg() != jwt.SigningMethodHS256.Alg() {
				return nil, jwt.NewValidationError("unexpected signing method", jwt.ValidationErrorSignatureInvalid)
			}
			return jwtSecret(), nil
		})

		if err != nil || !parsedToken.Valid {
			c.JSON(http.StatusUnauthorized, gin.H{
				"detail": gin.H{
					"code":  common.FORBID,
					"error": "invalid token",
				},
			})
			c.Abort()
			return
		}

		// Revocation check (signature+exp already passed): only degrades the "enhancement",
		// never authentication itself. iatSkew matches GenerateToken's backward offset and is
		// subtracted in the comparison so the semantics are "revoke only if the token was
		// genuinely issued before the event" — prevents a 60s lockout on immediate re-login
		// after a password change.
		skewSec := int64(IatSkew / time.Second)
		// 1+2) Pipelined blocklist + per-user epoch (Redis, fail-open): one round-trip
		// instead of two sequential reads. Fail-open per field: Redis down ->
		// (false, 0); an epoch miss (redis.Nil) is a normal 0, not a degrade.
		blocked, epoch := rxCache.CheckRevocation(c.Request.Context(), rxCache.HashToken(token), claims.Username)
		if blocked {
			revokedResponse(c)
			return
		}
		// Per-user epoch: revoke if iat < epoch-skew, including iat=0 legacy.
		// epoch is a ~1.7e9 unix value so epoch-skewSec > 0 always holds, hence iat=0 legacy is revoked.
		if epoch > 0 && claims.IssuedAt < epoch-skewSec {
			revokedResponse(c)
			return
		}
		// 3) Persistent floor (MySQL, still effective when Redis is down): revoke if iat < floor-skew.
		// iat=0 legacy is exempt (deploys do not force a full re-login); NULL/not-found/DB error → skip (fail-open).
		if floor, ok := passwordChangeFloor(c, claims.Username); ok && claims.IssuedAt > 0 && claims.IssuedAt < floor-skewSec {
			revokedResponse(c)
			return
		}

		c.Set("username", claims.Username)
		c.Set("token", token)
		c.Next()
	}
}

// revokedResponse aborts a revoked session with 401 (same shell as an invalid
// token; does not leak the revocation reason).
func revokedResponse(c *gin.Context) {
	c.JSON(http.StatusUnauthorized, gin.H{
		"detail": gin.H{
			"code":  common.FORBID,
			"error": "session expired, please log in again",
		},
	})
	c.Abort()
}

// passwordChangeFloor reads the user's password_change_at as the min-acceptable-iat
// floor. It queries model inline (bypassing the service layer to avoid a
// middleware↔api_service import cycle; mirrors first_login_gate.go). It returns
// (unix, true) only when the row exists and the column is non-NULL; otherwise
// (0, false) and the caller skips the floor (fail-open: NULL/not-found/DB error
// never reject).
func passwordChangeFloor(c *gin.Context, email string) (int64, bool) {
	var user model.User
	if err := model.DB(c).Select("password_change_at").
		Where("email = ?", email).First(&user).Error; err != nil {
		return 0, false
	}
	if user.PasswordChangeAt == nil {
		return 0, false
	}
	return user.PasswordChangeAt.Unix(), true
}
