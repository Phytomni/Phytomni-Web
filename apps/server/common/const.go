package common

import (
	"github.com/gin-gonic/gin"
	"github.com/go-redis/redis/v8"
)

const MINI_WECHAT = "micromessenger"
const DEFAULT_PAGE = 1
const DEFAULT_LEVEL = 1
const DEFAULT_PAGE_SIZE = 20
const RedisURL_CACHE = 30

const (
	SUCCESS                = 10000
	FAIL                   = 10001
	FORBID                 = 403
	ERR_RES_PARAMS_ILLEGAL = 10002
)

var (
	GVA_REDIS *redis.Client
)

type Response struct {
	Code int         `json:"code"`
	Msg  string      `json:"message"`
	Data interface{} `json:"data"`
}

func ReturnResponse(code int, data interface{}, msg string, c *gin.Context) {
	c.JSON(200, Response{
		code,
		msg,
		data,
	})
}

type Error interface {
	Code() int
	HttpCode() int
	Error() string
}
