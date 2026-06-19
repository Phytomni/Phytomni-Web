package api_handler

import (
	"encoding/json"
	"fmt"
	"io"
	"log"
	"mime"
	"net/http"
	"nky_client_go/common"
	rxBot "nky_client_go/external/bot"
	"nky_client_go/middleware"
	"nky_client_go/utils/errs"
	"os"
	"path"
	"path/filepath"

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
	fileName := ctx.Query("file_name")
	if fileName == "" {
		ctx.JSON(http.StatusBadRequest, gin.H{"code": http.StatusBadRequest, "message": "参数 file_name 不能为空"})
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
	// 获取表单参数
	speciesCode := ctx.PostForm("species_code")
	geneId := ctx.PostForm("gene_id")

	// 1. 首先读取doc_list内容（只读一次）
	docListFile, _, err := ctx.Request.FormFile("doc_list")
	if err != nil {
		ctx.JSON(http.StatusBadRequest, gin.H{
			"code":  http.StatusBadRequest,
			"error": "No doc_list uploaded",
		})
		return
	}
	defer docListFile.Close()

	// 读取doc_list文件内容
	docContent, err := io.ReadAll(docListFile)
	if err != nil {
		ctx.JSON(http.StatusInternalServerError, gin.H{
			"code":  http.StatusInternalServerError,
			"error": "Failed to read doc_list content",
		})
		return
	}

	// 解析doc_list JSON内容
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

	// 提取title并添加序号
	var titlesBuilder strings.Builder
	for i, doc := range docList.DocList {
		if doc.Title != "" {
			titlesBuilder.WriteString(fmt.Sprintf("%d. %s\n", i+1, doc.Title))
		}
	}
	titlesStr := titlesBuilder.String()

	// 2. 处理表单数据
	form, err := ctx.MultipartForm()
	if err != nil {
		ctx.JSON(http.StatusBadRequest, gin.H{
			"code":  http.StatusBadRequest,
			"error": "Failed to parse multipart form",
		})
		return
	}
	defer form.RemoveAll()

	// 3. 处理文本文件
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

		// 拼接文件内容和doc_list的titles
		combinedContent := fmt.Sprintf("%s\n\n--- DOC TITLES ---\n%s",
			string(fileContent), titlesStr)

		// 存储到数据库
		err = ph.service.GeneDetailsStorage(ctx, fileHeader.Filename, combinedContent, speciesCode, geneId)
		if err != nil {
			log.Printf("Failed to store file %s: %v", fileHeader.Filename, err)
			continue
		}

		successFiles = append(successFiles, fileHeader.Filename)
	}

	//// 4. 处理图片文件
	imageHeaders := form.File["images"]
	imageSavePath := "/root/project/html/dist/images" // 图片存储路径
	var savedImages []string

	// 确保目录存在
	if err = os.MkdirAll(imageSavePath, 0755); err != nil {
		log.Printf("Failed to create directory %s: %v", imageSavePath, err)
	}

	for _, imageHeader := range imageHeaders {
		// 打开上传的图片文件
		imageFile, err := imageHeader.Open()
		if err != nil {
			log.Printf("Failed to open image %s: %v", imageHeader.Filename, err)
			continue
		}
		defer imageFile.Close()
		fmt.Println(imageHeader.Filename)

		//	// 创建目标文件
		imagePath := filepath.Join(imageSavePath, imageHeader.Filename)
		outFile, err := os.Create(imagePath)
		if err != nil {
			log.Printf("Failed to create file %s: %v", imagePath, err)
			continue
		}
		defer outFile.Close()

		// 复制文件内容
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

	// 返回处理结果
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

	// 简单处理 username，防止 panic
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

// inlineSafeImageTypes 列出可安全内联渲染的位图类型。SVG(image/svg+xml)
// 与任何 *+xml 被刻意排除 —— 它们可携带内嵌脚本,同源 inline 提供即构成
// 存储型 XSS;这些一律强制走附件下载。
var inlineSafeImageTypes = map[string]bool{
	"image/png":  true,
	"image/jpeg": true,
	"image/gif":  true,
	"image/webp": true,
	"image/bmp":  true,
}

// sanitizeFilename 去掉可能撑破 Content-Disposition 引号文件名的字符
// (双引号、CR、LF),避免头注入。
func sanitizeFilename(name string) string {
	return strings.NewReplacer(`"`, "", "\r", "", "\n", "").Replace(name)
}

// GetDownloadObsFile 服务邮件中的下载链接。切流后不再 302 到 OBS 签名
// URL,而是经 Bot 中转把结果 zip 字节流直接写回浏览器。
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

// RelayFileDownload 流式输出一个 OBS 对象(经 Bot 中转)。鉴权走 query
// 短时 token(middleware.ParseDownloadToken):window.open / <img src> /
// 邮件链接均无法携带 Authorization 头,这是浏览器直连下载面的统一入口。
func (ph *Handler) RelayFileDownload(ctx *gin.Context) {
	key, err := middleware.ParseDownloadToken(ctx.Query("t"))
	if err != nil {
		ctx.JSON(http.StatusUnauthorized, gin.H{"code": http.StatusUnauthorized, "message": err.Error()})
		return
	}

	rc, length, err := rxBot.NewClient().GetObsObjectStream(ctx, key)
	if err != nil {
		// 不透传 Bot 内部错误细节给浏览器直连面
		ctx.JSON(http.StatusBadGateway, gin.H{"code": http.StatusBadGateway, "message": "文件获取失败"})
		return
	}
	defer rc.Close()

	filename := path.Base(key)
	contentType := mime.TypeByExtension(path.Ext(filename))
	if contentType == "" {
		contentType = "application/octet-stream"
	}
	// 仅位图图片内联渲染(<img> 场景);SVG/任何 *+xml 强制走附件下载,
	// 杜绝同源存储型 XSS。其余一律附件。
	disposition := "attachment"
	if inlineSafeImageTypes[contentType] {
		disposition = "inline"
	}
	// 浏览器直连面:禁 MIME 嗅探 + 最严 CSP 沙箱,任何内联响应都不执行脚本。
	ctx.Header("X-Content-Type-Options", "nosniff")
	ctx.Header("Content-Security-Policy", "default-src 'none'; sandbox")
	ctx.Header("Content-Disposition", disposition+`; filename="`+sanitizeFilename(filename)+`"`)
	ctx.DataFromReader(http.StatusOK, length, contentType, rc, nil)
}

func (ph *Handler) DownloadObsRenderingFile(ctx *gin.Context) {
	id, _ := strconv.Atoi(ctx.PostForm("id")) //主id
	format := ctx.PostForm("document_format") //文件格式

	if id == 0 || format == "" {
		ctx.JSON(http.StatusBadRequest, gin.H{"code": http.StatusBadRequest, "message": "参数缺失"})
		return
	}
	// 获取文件内容和文件名
	content, filename, err := ph.service.DownloadObsRenderingFile(ctx, id, format)
	if err != nil {
		ctx.JSON(http.StatusInternalServerError, gin.H{"code": http.StatusInternalServerError, "message": err.Error()})
		return
	}

	// 设置响应头
	ctx.Header("Content-Disposition", "attachment; filename="+filename)
	ctx.Header("Content-Type", "application/octet-stream")
	ctx.Header("Content-Length", strconv.Itoa(len(content)))

	ctx.Writer.Write(content)
}
