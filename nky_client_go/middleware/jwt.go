package middleware

import (
	"net/http"
	"nky_client_go/common"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/golang-jwt/jwt"
)

// JWT密钥
const SecretKey = "secret-key:nongke"

// JWT Claims结构体
type Claims struct {
	Username string `json:"username"`
	jwt.StandardClaims
}

// 生成JWT token
func GenerateToken(username string) (string, error) {
	expirationTime := time.Now().Add(24 * time.Hour) //暂时设置1天
	//expirationTime := time.Now().Add(1 * time.Minute) //设置1分钟
	claims := &Claims{
		Username: username,
		StandardClaims: jwt.StandardClaims{
			ExpiresAt: expirationTime.Unix(),
		},
	}

	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	return token.SignedString([]byte(SecretKey))
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
			return []byte(SecretKey), nil
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
