package api_handler

import (
	"encoding/json"
	"fmt"
	"io"
	"log"
	"mime"
	"net/http"
	"os"
	"path"
	"path/filepath"
	"phytomni-server/common"
	rxBot "phytomni-server/external/bot"
	"phytomni-server/middleware"
	"phytomni-server/utils/errs"

	"github.com/gin-gonic/gin"

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
			ctx.JSON(http.StatusInternalServerError, gin.H{"code": http.StatusInternalServerError, "message": err.Error()})
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
			ctx.JSON(http.StatusInternalServerError, gin.H{"code": http.StatusInternalServerError, "message": err.Error()})
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
		ctx.JSON(http.StatusBadRequest, gin.H{"code": http.StatusBadRequest, "message": "parameter file_name cannot be empty"})
		return
	}

	list, err := ph.service.GeneDetails(ctx, fileName)
	if err != nil {
		ctx.JSON(http.StatusInternalServerError, gin.H{"code": http.StatusInternalServerError, "message": err.Error()})
		return
	}

	ctx.JSON(errs.SucResp(list))
}

func (ph *Handler) GeneDetailsStorage(ctx *gin.Context) {
	speciesCode := ctx.PostForm("species_code")
	geneId := ctx.PostForm("gene_id")

	docListFile, _, err := ctx.Request.FormFile("doc_list")
	if err != nil {
		ctx.JSON(http.StatusBadRequest, gin.H{
			"code":  http.StatusBadRequest,
			"error": "No doc_list uploaded",
		})
		return
	}
	defer docListFile.Close()

	docContent, err := io.ReadAll(docListFile)
	if err != nil {
		ctx.JSON(http.StatusInternalServerError, gin.H{
			"code":  http.StatusInternalServerError,
			"error": "Failed to read doc_list content",
		})
		return
	}

	var docList struct {
		DocList []struct {
			Title string `json:"title"`
		} `json:"doc_list"`
	}
	if err = json.Unmarshal(docContent, &docList); err != nil {
		ctx.JSON(http.StatusInternalServerError, gin.H{
			"code":  http.StatusInternalServerError,
			"error": "Failed to parse doc_list JSON",
		})
		return
	}

	var titlesBuilder strings.Builder
	for i, doc := range docList.DocList {
		if doc.Title != "" {
			titlesBuilder.WriteString(fmt.Sprintf("%d. %s\n", i+1, doc.Title))
		}
	}
	titlesStr := titlesBuilder.String()

	form, err := ctx.MultipartForm()
	if err != nil {
		ctx.JSON(http.StatusBadRequest, gin.H{
			"code":  http.StatusBadRequest,
			"error": "Failed to parse multipart form",
		})
		return
	}
	defer form.RemoveAll()

	var successFiles []string
	fileHeaders := form.File["files"]
	for _, fileHeader := range fileHeaders {
		file, err := fileHeader.Open()
		if err != nil {
			log.Printf("Failed to open file %s: %v", fileHeader.Filename, err)
			continue
		}

		fileContent, err := io.ReadAll(file)
		file.Close()
		if err != nil {
			log.Printf("Failed to read file %s: %v", fileHeader.Filename, err)
			continue
		}

		combinedContent := fmt.Sprintf("%s\n\n--- DOC TITLES ---\n%s",
			string(fileContent), titlesStr)

		err = ph.service.GeneDetailsStorage(ctx, fileHeader.Filename, combinedContent, speciesCode, geneId)
		if err != nil {
			log.Printf("Failed to store file %s: %v", fileHeader.Filename, err)
			continue
		}

		successFiles = append(successFiles, fileHeader.Filename)
	}

	imageHeaders := form.File["images"]
	imageSavePath := "/root/project/html/dist/images"
	var savedImages []string

	if err = os.MkdirAll(imageSavePath, 0755); err != nil {
		log.Printf("Failed to create directory %s: %v", imageSavePath, err)
	}

	for _, imageHeader := range imageHeaders {
		imageFile, err := imageHeader.Open()
		if err != nil {
			log.Printf("Failed to open image %s: %v", imageHeader.Filename, err)
			continue
		}
		defer imageFile.Close()
		fmt.Println(imageHeader.Filename)

		imagePath := filepath.Join(imageSavePath, imageHeader.Filename)
		outFile, err := os.Create(imagePath)
		if err != nil {
			log.Printf("Failed to create file %s: %v", imagePath, err)
			continue
		}
		defer outFile.Close()

		if _, err := io.Copy(outFile, imageFile); err != nil {
			log.Printf("Failed to save image %s: %v", imagePath, err)
			continue
		}

		savedImages = append(savedImages, imageHeader.Filename)
		log.Printf("Successfully saved image: %s", imagePath)
	}

	if len(successFiles) == 0 && len(savedImages) == 0 {
		ctx.JSON(http.StatusInternalServerError, gin.H{
			"code":  http.StatusInternalServerError,
			"error": "Failed to process all files and images",
		})
		return
	}

	ctx.JSON(errs.SucResp(successFiles))
}

func (ph *Handler) DownloadAnalystAgentObsFile(ctx *gin.Context) {
	obsPath := ctx.Query("obs_path")
	username, _ := ctx.Get("username")

	obsPath, err := ph.service.DownloadAnalystAgentObsFile(ctx, username.(string), obsPath)
	if err != nil {
		ctx.JSON(http.StatusInternalServerError, gin.H{"code": http.StatusInternalServerError, "message": err.Error()})
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
		ctx.JSON(http.StatusInternalServerError, gin.H{"code": http.StatusInternalServerError, "message": err.Error()})
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

// GetDownloadObsFile serves email download links. After the cutover it no
// longer 302-redirects to an OBS signed URL; instead it streams the result
// zip bytes back through the Bot relay.
func (ph *Handler) GetDownloadObsFile(ctx *gin.Context) {
	obsPath := ctx.Query("obs_path")
	username := ctx.Query("username")

	rc, filename, length, err := ph.service.GetDownloadObsFile(ctx, username, obsPath)
	if err != nil {
		ctx.JSON(http.StatusInternalServerError, gin.H{"code": http.StatusInternalServerError, "message": err.Error()})
		return
	}
	defer rc.Close()

	ctx.Header("X-Content-Type-Options", "nosniff")
	ctx.Header("Content-Disposition", `attachment; filename="`+sanitizeFilename(filename)+`"`)
	ctx.DataFromReader(http.StatusOK, length, "application/octet-stream", rc, nil)
}

// RelayFileDownload streams an OBS object through the Bot relay. Auth is via
// a short-lived query token (middleware.ParseDownloadToken): window.open,
// <img src>, and email links cannot carry an Authorization header, so this
// is the unified browser-direct download entry point.
func (ph *Handler) RelayFileDownload(ctx *gin.Context) {
	key, err := middleware.ParseDownloadToken(ctx.Query("t"))
	if err != nil {
		ctx.JSON(http.StatusUnauthorized, gin.H{"code": http.StatusUnauthorized, "message": err.Error()})
		return
	}

	rc, length, err := rxBot.NewClient().GetObsObjectStream(ctx, key)
	if err != nil {
		// Do not expose Bot internal error details to the browser-direct surface.
		ctx.JSON(http.StatusBadGateway, gin.H{"code": http.StatusBadGateway, "message": "failed to fetch file"})
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

func (ph *Handler) DownloadObsRenderingFile(ctx *gin.Context) {
	id, _ := strconv.Atoi(ctx.PostForm("id"))
	format := ctx.PostForm("document_format")

	if id == 0 || format == "" {
		ctx.JSON(http.StatusBadRequest, gin.H{"code": http.StatusBadRequest, "message": "missing parameter"})
		return
	}
	content, filename, err := ph.service.DownloadObsRenderingFile(ctx, id, format)
	if err != nil {
		ctx.JSON(http.StatusInternalServerError, gin.H{"code": http.StatusInternalServerError, "message": err.Error()})
		return
	}

	ctx.Header("Content-Disposition", "attachment; filename="+filename)
	ctx.Header("Content-Type", "application/octet-stream")
	ctx.Header("Content-Length", strconv.Itoa(len(content)))

	ctx.Writer.Write(content)
}
