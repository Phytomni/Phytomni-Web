package api_service

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/url"
	"os"
	"path"

	"nky_client_go/common/document_format"
	rxBot "nky_client_go/external/bot"
	"nky_client_go/middleware"
	"nky_client_go/model"
	"strings"
	"time"

	"github.com/spf13/viper"
)

func (ps *ApiService) ApiGeneList(ctx context.Context, current, size int) ([]*model.SGeneExample, int64, int, error) {
	return ps.ApiGeneSearch(ctx, current, size, "")
}

func (ps *ApiService) ApiGeneSearch(ctx context.Context, current, size int, title string) ([]*model.SGeneExample, int64, int, error) {
	allData, err := ps.fetchGeneFiles(title)
	if err != nil {
		// 如果目录读取失败，可以记录日志并返回空列表，或者直接返回错误
		// 这里选择返回错误
		return nil, 0, 0, err
	}

	total := int64(len(allData))
	if total == 0 {
		return []*model.SGeneExample{}, 0, 0, nil
	}

	totalPages := int((total + int64(size) - 1) / int64(size))

	start := (current - 1) * size
	if start < 0 {
		start = 0
	}
	end := start + size

	if start > int(total) {
		start = int(total)
	}
	if end > int(total) {
		end = int(total)
	}

	return allData[start:end], total, totalPages, nil
}

// fetchGeneFiles 从指定目录读取文件并封装
func (ps *ApiService) fetchGeneFiles(title string) ([]*model.SGeneExample, error) {
	// main.go initConfig sets a viper.SetDefault for gene_file_path so
	// the lookup never returns ""; if it ever does, the os.ReadDir below
	// will surface a meaningful error instead of falling back to a
	// developer-specific Windows path.
	path := viper.GetString("gene_file_path")

	entries, err := os.ReadDir(path)
	if err != nil {
		return nil, err
	}

	var list []*model.SGeneExample
	for _, entry := range entries {
		if entry.IsDir() {
			continue
		}
		item := parseGeneFile(entry.Name())
		if item != nil {
			if title != "" {
				// 模糊匹配
				if !strings.Contains(item.SpeciesCode, title) && !strings.Contains(item.GeneId, title) {
					continue
				}
			}
			list = append(list, item)
		}
	}
	return list, nil
}

func parseGeneFile(filename string) *model.SGeneExample {
	if !strings.HasSuffix(filename, "_result.md") {
		return nil
	}

	var speciesCode string
	if strings.HasPrefix(filename, "AT") {
		speciesCode = "Ath"
	} else if strings.HasPrefix(filename, "GLYMA") {
		speciesCode = "Gma"
	} else if strings.HasPrefix(filename, "Os") {
		speciesCode = "Osa"
	} else if strings.HasPrefix(filename, "Traes") {
		speciesCode = "tae"
	} else if strings.HasPrefix(filename, "Zm") {
		speciesCode = "zma"
	} else {
		return nil
	}

	geneId := strings.TrimSuffix(filename, "_result.md")

	return &model.SGeneExample{
		FileName:    filename,
		SpeciesCode: speciesCode,
		GeneId:      geneId,
		// Id, CreatedAt, UpdatedAt, Content, DeleteAt 不需要填充
	}
}
func (ps *ApiService) ApiGeneDetails(ctx context.Context, fileName string) (*model.SGeneExample, error) {
	// See fetchGeneFiles — gene_file_path is always defaulted in
	// initConfig, so the empty-string Windows fallback that used to
	// live here is no longer needed.
	path := viper.GetString("gene_file_path")

	fullPath := fmt.Sprintf("%s/%s", path, fileName)

	// 安全检查：确保文件路径在目标目录内，防止目录遍历攻击
	// 这里简化处理，只检查文件名是否包含 ..
	if strings.Contains(fileName, "..") || strings.Contains(fileName, "/") || strings.Contains(fileName, "\\") {
		return nil, errors.New("invalid filename")
	}

	content, err := os.ReadFile(fullPath)
	if err != nil {
		return nil, err
	}

	item := parseGeneFile(fileName)
	if item == nil {
		return nil, errors.New("invalid gene file format")
	}
	item.Content = string(content)

	return item, nil
}

func (ps *ApiService) ApiGeneDetailsStorage(ctx context.Context, fileName, content, speciesCode, geneId string) error {

	gene := &model.SGeneExample{
		FileName:    fileName,
		Content:     content,
		SpeciesCode: speciesCode,
		GeneId:      geneId,
		CreatedAt:   time.Time{},
	}
	err := model.DB(ctx).Model(&model.SGeneExample{}).Create(gene).Error

	return err
}

// findObsKeyBySuffix 在 Bot 中转列出的 keys 中找第一个匹配后缀的对象(忽略大小写)。
func findObsKeyBySuffix(keys []string, suffix string) string {
	for _, k := range keys {
		if strings.HasSuffix(strings.ToLower(k), suffix) {
			return k
		}
	}
	return ""
}

// friendlyRelayErr 把 Bot 中转对前缀外/桶外路径的拒绝(切流前历史
// download_path 的特征)翻译成用户可读的提示;其余错误原样透传。
func friendlyRelayErr(err error) error {
	if rxBot.IsLegacyPathErr(err) {
		return errors.New("该结果文件属于切流前的历史数据,已不再提供下载")
	}
	return err
}

// relayDownloadURL 为一个 OBS 对象签出指向本服务流式下载端点的短时 token URL。
// 浏览器侧(window.open / <img src>)无法携带 Authorization 头,鉴权落在
// query token 上;相对路径经前端 /v1 代理回到本服务。
func relayDownloadURL(obsKey string) (string, error) {
	token, err := middleware.GenerateDownloadToken(obsKey, middleware.DownloadTokenTTL)
	if err != nil {
		return "", err
	}
	return "/v1/download/relay_file?t=" + url.QueryEscape(token), nil
}

func (ps *ApiService) ApiDownloadAnalystAgentObsFile(ctx context.Context, username, obsPath string) (string, error) {
	// 判断是否有权限生成下载链接
	var questionAgentLog model.SQuestionAgentLog
	if result := model.DB(ctx).Model(&model.SQuestionAgentLog{}).Where("user_name = ? and download_path = ? and delete_at IS NULL", username, obsPath).
		First(&questionAgentLog).RowsAffected; result == 0 {
		return "", errors.New("没有查找到对应的obs路径数据")
	}

	keys, err := rxBot.NewClient().ListObsKeys(ctx, obsPath)
	if err != nil {
		return "", friendlyRelayErr(err)
	}
	zipKey := findObsKeyBySuffix(keys, ".zip")
	if zipKey == "" {
		return "", errors.New("在指定目录下未找到zip文件")
	}
	return relayDownloadURL(zipKey)
}

func (ps *ApiService) ApiDownloadAnalystAgentObsImages(ctx context.Context, username, obsPath string) ([]string, error) {
	// 归属校验 + 取 reconcile 写入的图片路径(切流后由完成态 reconcile 填充)
	var row model.SQuestionAgentLog
	if result := model.DB(ctx).Model(&model.SQuestionAgentLog{}).
		Where("user_name = ? and download_path = ? and delete_at IS NULL", username, obsPath).
		First(&row).RowsAffected; result == 0 {
		return nil, errors.New("没有查找到对应的obs路径数据")
	}

	var keys []string
	if row.ImagePaths != "" {
		_ = json.Unmarshal([]byte(row.ImagePaths), &keys)
	}
	if len(keys) == 0 {
		// 旧行 / image_paths 为空:退回按前缀列举(保持今日行为)
		var err error
		keys, err = rxBot.NewClient().ListObsKeys(ctx, obsPath)
		if err != nil {
			return nil, friendlyRelayErr(err)
		}
	}

	var imageUrls []string
	for _, k := range keys {
		if strings.HasSuffix(strings.ToLower(k), ".png") {
			u, err := relayDownloadURL(k)
			if err != nil {
				// 单个签发失败跳过,保持原"跳过坏文件"行为
				continue
			}
			imageUrls = append(imageUrls, u)
		}
	}

	if len(imageUrls) == 0 {
		return nil, errors.New("在指定目录下未找到png图片文件")
	}

	return imageUrls, nil
}

// ApiGetDownloadObsFile 服务邮件里的下载链接:校验 obs_path 归属于该用户的
// 消息记录(邮件链接无法携带任何凭据,这层库内归属校验是该入口仅有的访问
// 控制),经 Bot 中转找到结果 zip 并返回字节流,由 handler 直接写回浏览器。
func (ps *ApiService) ApiGetDownloadObsFile(ctx context.Context, username, obsPath string) (io.ReadCloser, string, int64, error) {
	var questionAgentLog model.SQuestionAgentLog
	if result := model.DB(ctx).Model(&model.SQuestionAgentLog{}).Where("user_name = ? and download_path = ? and delete_at IS NULL", username, obsPath).
		First(&questionAgentLog).RowsAffected; result == 0 {
		return nil, "", 0, errors.New("没有查找到对应的obs路径数据")
	}

	client := rxBot.NewClient()
	keys, err := client.ListObsKeys(ctx, obsPath)
	if err != nil {
		return nil, "", 0, friendlyRelayErr(err)
	}
	zipKey := findObsKeyBySuffix(keys, ".zip")
	if zipKey == "" {
		return nil, "", 0, errors.New("在指定目录下未找到zip文件")
	}

	rc, length, err := client.GetObsObjectStream(ctx, zipKey)
	if err != nil {
		return nil, "", 0, friendlyRelayErr(err)
	}
	return rc, path.Base(zipKey), length, nil
}

func (ps *ApiService) ApiDownloadObsRenderingFile(ctx context.Context, id int, format string) ([]byte, string, error) {

	var questionAgentLog *model.SQuestionAgentLog
	db := model.DB(ctx).Model(&model.SQuestionAgentLog{})

	if err := db.Where("id = ?", id).First(&questionAgentLog).Error; err != nil {
		return nil, "", err
	}
	agent, err := document_format.NewAgent(questionAgentLog.ToolName)
	if err != nil {
		return nil, "", err
	}

	return agent.Download(format, questionAgentLog.Answer)
}
