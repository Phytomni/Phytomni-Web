package api_handler

import (
	"mime"
	"net/http"
	"os"
	"path"
	"path/filepath"
	"phytomni-server/common"
	"phytomni-server/common/i18n"
	rxBot "phytomni-server/external/bot"
	"phytomni-server/middleware"
	"phytomni-server/utils"
	"phytomni-server/utils/errs"

	"github.com/gin-gonic/gin"
	"github.com/spf13/viper"

	"strconv"
	"strings"
)

func (ph *Handler) GeneList(ctx *gin.Context) {
	current, _ := strconv.Atoi(ctx.Query("current"))
	size, _ := strconv.Atoi(ctx.Query("size"))
	title := ctx.Query("title")

	if title != "" {
		list, total, totalPages, err := ph.service.GeneSearch(ctx, current, size, title)
		if err != nil {
			ctx.JSON(http.StatusInternalServerError, gin.H{"code": http.StatusInternalServerError, "message": i18n.TMaybe(ctx, err.Error())})
			return
		}

		data := &common.GeneListResponse{
			Total:      total,
			TotalPages: totalPages,
			GeneList:   list,
		}

		ctx.JSON(errs.SucResp(data))
	} else {
		list, total, totalPages, err := ph.service.GeneList(ctx, current, size)
		if err != nil {
			ctx.JSON(http.StatusInternalServerError, gin.H{"code": http.StatusInternalServerError, "message": i18n.TMaybe(ctx, err.Error())})
		}

		data := &common.GeneListResponse{
			Total:      total,
			TotalPages: totalPages,
			GeneList:   list,
		}

		ctx.JSON(errs.SucResp(data))
	}
}
func (ph *Handler) GeneDetails(ctx *gin.Context) {
	fileName := ctx.Param("id")
	if fileName == "" {
		ctx.JSON(http.StatusBadRequest, gin.H{"code": http.StatusBadRequest, "message": i18n.T(ctx, "gene.file_name_required")})
		return
	}

	list, err := ph.service.GeneDetails(ctx, fileName)
	if err != nil {
		ctx.JSON(http.StatusInternalServerError, gin.H{"code": http.StatusInternalServerError, "message": i18n.TMaybe(ctx, err.Error())})
		return
	}

	ctx.JSON(errs.SucResp(list))
}

func (ph *Handler) DownloadAnalystAgentObsFile(ctx *gin.Context) {
	obsPath := ctx.Query("obs_path")
	username, _ := ctx.Get("username")

	obsPath, err := ph.service.DownloadAnalystAgentObsFile(ctx, username.(string), obsPath)
	if err != nil {
		ctx.JSON(http.StatusInternalServerError, gin.H{"code": http.StatusInternalServerError, "message": i18n.TMaybe(ctx, err.Error())})
		return
	}

	ctx.JSON(errs.SucResp(obsPath))
}

func (ph *Handler) DownloadAnalystAgentObsImages(ctx *gin.Context) {
	obsPath := ctx.Query("obs_path")
	username, _ := ctx.Get("username")

	// Guard nil username before type-asserting to avoid a panic.
	uStr := ""
	if username != nil {
		uStr = username.(string)
	}

	imageUrls, err := ph.service.DownloadAnalystAgentObsImages(ctx, uStr, obsPath)
	if err != nil {
		ctx.JSON(http.StatusInternalServerError, gin.H{"code": http.StatusInternalServerError, "message": i18n.TMaybe(ctx, err.Error())})
		return
	}

	ctx.JSON(errs.SucResp(imageUrls))
}

// inlineSafeImageTypes lists raster MIME types that are safe to serve inline.
// SVG (image/svg+xml) and any *+xml are intentionally excluded — they can
// carry embedded scripts and serving them inline same-origin would constitute
// stored XSS. Those are always forced to attachment download.
var inlineSafeImageTypes = map[string]bool{
	"image/png":  true,
	"image/jpeg": true,
	"image/gif":  true,
	"image/webp": true,
	"image/bmp":  true,
}

// sanitizeFilename strips characters that could break a quoted Content-Disposition
// filename (double-quote, CR, LF) to prevent header injection.
func sanitizeFilename(name string) string {
	return strings.NewReplacer(`"`, "", "\r", "", "\n", "").Replace(name)
}

// GetDownloadObsFile is the legacy email-link download endpoint. Email links
// are currently disabled; keep the route present so old links fail predictably
// with 410 Gone instead of a confusing 404.
func (ph *Handler) GetDownloadObsFile(ctx *gin.Context) {
	ctx.JSON(http.StatusGone, gin.H{
		"code":    http.StatusGone,
		"message": i18n.T(ctx, "gene.email_download_unavailable"),
	})
}

// RelayFileDownload streams an OBS object through the Bot relay. Auth is via
// a short-lived query token (middleware.ParseDownloadToken), allowing browser
// downloads without placing the OBS key in the URL.
func (ph *Handler) RelayFileDownload(ctx *gin.Context) {
	key, err := middleware.ParseDownloadToken(ctx.Query("token"))
	if err != nil {
		ctx.JSON(http.StatusUnauthorized, gin.H{"code": http.StatusUnauthorized, "message": i18n.TMaybe(ctx, err.Error())})
		return
	}

	rc, length, err := rxBot.NewClient().GetObsObjectStream(ctx, key)
	if err != nil {
		// Do not expose Bot internal error details to the browser-direct surface.
		ctx.JSON(http.StatusBadGateway, gin.H{"code": http.StatusBadGateway, "message": i18n.T(ctx, "gene.fetch_failed")})
		return
	}
	defer rc.Close()

	filename := path.Base(key)
	contentType := mime.TypeByExtension(path.Ext(filename))
	if contentType == "" {
		contentType = "application/octet-stream"
	}
	// Only raster images are served inline (<img> scenario); SVG and any *+xml
	// are forced to attachment to prevent same-origin stored XSS.
	disposition := "attachment"
	if inlineSafeImageTypes[contentType] {
		disposition = "inline"
	}
	// Browser-direct surface: no MIME sniffing + strictest CSP sandbox so no
	// script executes even for inline responses.
	ctx.Header("X-Content-Type-Options", "nosniff")
	ctx.Header("Content-Security-Policy", "default-src 'none'; sandbox")
	ctx.Header("Content-Disposition", disposition+`; filename="`+sanitizeFilename(filename)+`"`)
	ctx.DataFromReader(http.StatusOK, length, contentType, rc, nil)
}

// GeneImage serves a public gene-example image from the obsfs mount. The URL is
// /api/v1/gene-images/:gene/:file (emitted into the md by the data pipeline).
// Both path segments are validated (CleanUploadFilename) and the join is
// containment-checked (SafeJoinUploadPath), so no request can read outside
// <mount>/img/<gene>/. Gene data is public, so there is no per-user auth.
func (ph *Handler) GeneImage(ctx *gin.Context) {
	gene, err := utils.CleanUploadFilename(ctx.Param("gene"))
	if err != nil {
		ctx.JSON(http.StatusBadRequest, gin.H{"code": http.StatusBadRequest, "message": i18n.T(ctx, "gene.file_name_required")})
		return
	}
	file, err := utils.CleanUploadFilename(ctx.Param("file"))
	if err != nil {
		ctx.JSON(http.StatusBadRequest, gin.H{"code": http.StatusBadRequest, "message": i18n.T(ctx, "gene.file_name_required")})
		return
	}

	mount := viper.GetString("gene_obsfs_path")
	if mount == "" {
		// Relay image fallback is a Bot-handoff follow-up; the obsfs mount is the
		// production path for images.
		ctx.JSON(http.StatusNotFound, gin.H{"code": http.StatusNotFound, "message": i18n.T(ctx, "gene.fetch_failed")})
		return
	}

	base := filepath.Join(mount, "img", gene)
	fullPath, err := utils.SafeJoinUploadPath(base, file)
	if err != nil {
		ctx.JSON(http.StatusBadRequest, gin.H{"code": http.StatusBadRequest, "message": i18n.T(ctx, "gene.file_name_required")})
		return
	}

	data, err := os.ReadFile(fullPath)
	if err != nil {
		ctx.JSON(http.StatusNotFound, gin.H{"code": http.StatusNotFound, "message": i18n.T(ctx, "gene.fetch_failed")})
		return
	}

	contentType := mime.TypeByExtension(path.Ext(file))
	if contentType == "" {
		contentType = "application/octet-stream"
	}
	disposition := "attachment"
	if inlineSafeImageTypes[contentType] {
		disposition = "inline"
	}
	ctx.Header("X-Content-Type-Options", "nosniff")
	ctx.Header("Content-Security-Policy", "default-src 'none'; sandbox")
	ctx.Header("Content-Disposition", disposition+`; filename="`+sanitizeFilename(file)+`"`)
	ctx.Data(http.StatusOK, contentType, data)
}

func (ph *Handler) DownloadObsRenderingFile(ctx *gin.Context) {
	id, _ := strconv.Atoi(ctx.PostForm("id"))
	format := ctx.PostForm("document_format")

	if id == 0 || format == "" {
		ctx.JSON(http.StatusBadRequest, gin.H{"code": http.StatusBadRequest, "message": i18n.T(ctx, "gene.missing_parameter")})
		return
	}
	content, filename, err := ph.service.DownloadObsRenderingFile(ctx, id, format)
	if err != nil {
		ctx.JSON(http.StatusInternalServerError, gin.H{"code": http.StatusInternalServerError, "message": i18n.TMaybe(ctx, err.Error())})
		return
	}

	ctx.Header("Content-Disposition", "attachment; filename="+filename)
	ctx.Header("Content-Type", "application/octet-stream")
	ctx.Header("Content-Length", strconv.Itoa(len(content)))

	ctx.Writer.Write(content)
}
