package server

import (
	"github.com/getsentry/sentry-go"
	"github.com/gin-gonic/gin"
)

type HttpOption func(h *Http)

func TracesSampler(s sentry.TracesSampler) HttpOption {
	return func(h *Http) {
		h.TracesSampler = s
	}
}

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
