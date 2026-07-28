package api_handler

import (
	"errors"
	"net/http"
	"strconv"

	"phytomni-server/common/i18n"
	"phytomni-server/service/api_service"
	"phytomni-server/utils/errs"

	"github.com/gin-gonic/gin"
)

// ConversationArtifactDownloadURL resolves and signs one artifact only for an
// authenticated click. The browser supplies identity, never an OBS path.
func (ph *Handler) ConversationArtifactDownloadURL(ctx *gin.Context) {
	usernameValue, _ := ctx.Get("username")
	username, ok := usernameValue.(string)
	if !ok || username == "" {
		ctx.JSON(http.StatusUnauthorized, gin.H{"code": http.StatusUnauthorized, "message": i18n.T(ctx, "conversation_artifact.unauthorized")})
		return
	}
	messageID, err := strconv.ParseInt(ctx.Param("message_id"), 10, 64)
	if err != nil || messageID <= 0 {
		ctx.JSON(http.StatusNotFound, gin.H{"code": http.StatusNotFound, "message": i18n.T(ctx, "conversation_artifact.not_found")})
		return
	}

	url, err := ph.service.ConversationArtifactDownloadURL(
		ctx,
		username,
		ctx.Param("id"),
		messageID,
		ctx.Param("artifact_id"),
	)
	if errors.Is(err, api_service.ErrConversationArtifactOwnership) {
		ctx.JSON(http.StatusNotFound, gin.H{"code": http.StatusNotFound, "message": i18n.T(ctx, "conversation_artifact.not_found")})
		return
	}
	if err != nil {
		ctx.JSON(http.StatusInternalServerError, gin.H{"code": http.StatusInternalServerError, "message": i18n.T(ctx, "conversation_artifact.unavailable")})
		return
	}
	ctx.JSON(errs.SucResp(url))
}
