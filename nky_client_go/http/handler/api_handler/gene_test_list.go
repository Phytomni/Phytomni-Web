package api_handler

import (
	"encoding/json"
	"fmt"
	"github.com/gin-gonic/gin"
	"io"
	"log"
	"net/http"
	"nky_client_go/common"
	"nky_client_go/utils/errs"
	"os"
	"path/filepath"

	"strconv"
	"strings"
)

func (ph *ApiHandler) ApiGeneList(ctx *gin.Context) {
	current, _ := strconv.Atoi(ctx.Query("current"))
	size, _ := strconv.Atoi(ctx.Query("size"))
	title := ctx.Query("title")

	if title != "" {
		list, total, totalPages, err := ph.service.ApiGeneSearch(current, size, title)
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
		list, total, totalPages, err := ph.service.ApiGeneList(current, size)
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
func (ph *ApiHandler) ApiGeneDetails(ctx *gin.Context) {
	id, _ := strconv.Atoi(ctx.Query("id"))

	list, err := ph.service.ApiGeneDetails(id)
	if err != nil {
		ctx.JSON(http.StatusInternalServerError, gin.H{"code": http.StatusInternalServerError, "message": err.Error()})
		return
	}

	ctx.JSON(errs.SucResp(list))
}

func (ph *ApiHandler) ApiGeneDetailsStorage(ctx *gin.Context) {
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
		err = ph.service.ApiGeneDetailsStorage(fileHeader.Filename, combinedContent, speciesCode, geneId)
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

func (ph *ApiHandler) ApiDownloadAnalystAgentObsFile(ctx *gin.Context) {
	obsPath := ctx.Query("obs_path")
	username, _ := ctx.Get("username")

	obsPath, err := ph.service.ApiDownloadAnalystAgentObsFile(username.(string), obsPath)
	if err != nil {
		ctx.JSON(http.StatusInternalServerError, gin.H{"code": http.StatusInternalServerError, "message": err.Error()})
		return
	}

	ctx.JSON(errs.SucResp(obsPath))
}

func (ph *ApiHandler) ApiGetDownloadObsFile(ctx *gin.Context) {
	obsPath := ctx.Query("obs_path")
	username := ctx.Query("username")

	obsPath, err := ph.service.ApiGetDownloadObsFile(username, obsPath)
	if err != nil {
		ctx.JSON(http.StatusInternalServerError, gin.H{"code": http.StatusInternalServerError, "message": err.Error()})
		return
	}

	ctx.Redirect(http.StatusFound, obsPath)
}

func (ph *ApiHandler) ApiDownloadObsRenderingFile(ctx *gin.Context) {
	id, _ := strconv.Atoi(ctx.PostForm("id")) //主id
	format := ctx.PostForm("document_format") //文件格式

	if id == 0 || format == "" {
		ctx.JSON(http.StatusBadRequest, gin.H{"code": http.StatusBadRequest, "message": "参数缺失"})
		return
	}
	// 获取文件内容和文件名
	content, filename, err := ph.service.ApiDownloadObsRenderingFile(id, format)
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
