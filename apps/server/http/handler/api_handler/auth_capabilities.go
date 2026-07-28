package api_handler

import (
	"phytomni-server/utils"
	"phytomni-server/utils/errs"

	"github.com/gin-gonic/gin"
)

func (ph *Handler) AuthCapabilities(ctx *gin.Context) {
	ctx.JSON(errs.SucResp(gin.H{
		"registration_enabled": utils.RegistrationEnabled(),
	}))
}
