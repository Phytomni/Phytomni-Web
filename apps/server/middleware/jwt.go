package middleware

import (
	"net/http"
	"phytomni-server/common"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/golang-jwt/jwt"
	"github.com/spf13/viper"
)

// jwtSecret 从 viper 读取 jwt.secret_key,用于 HS256 签发/校验本服务的用户 token。
// (Bot 不消费 Web 用户 JWT——它用 ptm_ 服务密钥,故此密钥无跨仓共享方。)
func jwtSecret() []byte {
	return []byte(viper.GetString("jwt.secret_key"))
}

// JWT Claims结构体
type Claims struct {
	Username string `json:"username"`
	jwt.StandardClaims
}

// TokenLifetime 是用户 JWT 的有效期。GenerateToken 用它算 exp,撤销层用它做
// per-user epoch 键的 TTL——共用一个常量防止两边漂移。
const TokenLifetime = 24 * time.Hour

// 生成JWT token
func GenerateToken(username string) (string, error) {
	now := time.Now()
	claims := &Claims{
		Username: username,
		StandardClaims: jwt.StandardClaims{
			// iat = now-60s:吸收多实例/NTP 偏移、永不未来时(golang-jwt v3 的
			// verifyIat 无 leeway,严格 now>=iat)。撤销层按 iat 与 epoch/floor 比较。
			IssuedAt:  now.Add(-60 * time.Second).Unix(),
			ExpiresAt: now.Add(TokenLifetime).Unix(),
		},
	}

	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	return token.SignedString(jwtSecret())
}

// JWT中间件
func AuthMiddleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		tokenString := c.GetHeader("Authorization")
		if tokenString == "" {
			c.JSON(http.StatusUnauthorized, gin.H{
				"detail": gin.H{
					"code":  common.FORBID,
					"error": "缺少授权头",
				},
			})
			c.Abort()
			return
		}
		// 检查Authorization头是否以"Bearer "开头
		if len(tokenString) < 7 || tokenString[:7] != "Bearer " {
			c.JSON(http.StatusUnauthorized, gin.H{
				"detail": gin.H{
					"code":  common.FORBID,
					"error": "无效的授权头格式",
				},
			})
			c.Abort()
			return
		}
		// 提取出token
		token := tokenString[7:]
		claims := &Claims{}
		parsedToken, err := jwt.ParseWithClaims(token, claims, func(parsedToken *jwt.Token) (interface{}, error) {
			return jwtSecret(), nil
		})

		if err != nil || !parsedToken.Valid {
			c.JSON(http.StatusUnauthorized, gin.H{
				"detail": gin.H{
					"code":  common.FORBID,
					"error": "无效的token",
				},
			})
			c.Abort()
			return
		}

		c.Set("username", claims.Username)
		c.Set("token", token) // 将token存储到context中
		c.Next()
	}
}
