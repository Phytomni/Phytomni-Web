package server

import (
	"github.com/gin-gonic/gin"
)

type HttpOption func(h *Http)

func Addr(addr string) HttpOption {
	return func(h *Http) {
		h.Addr = addr
	}
}

func Router(f func(r *gin.Engine)) HttpOption {
	return func(h *Http) {
		f(h.gin)
	}
}
