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

	"phytomni-server/common/document_format"
	rxBot "phytomni-server/external/bot"
	rxLog "phytomni-server/log"
	"phytomni-server/middleware"
	"phytomni-server/model"
	"strings"
	"time"

	"github.com/spf13/viper"
)

func (ps *Service) GeneList(ctx context.Context, current, size int) ([]*model.GeneExample, int64, int, error) {
	return ps.GeneSearch(ctx, current, size, "")
}

func (ps *Service) GeneSearch(ctx context.Context, current, size int, title string) ([]*model.GeneExample, int64, int, error) {
	allData, err := ps.fetchGeneFiles(title)
	if err != nil {
		// 如果目录读取失败，可以记录日志并返回空列表，或者直接返回错误
		// 这里选择返回错误
		return nil, 0, 0, err
	}

	total := int64(len(allData))
	if total == 0 {
		return []*model.GeneExample{}, 0, 0, nil
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
func (ps *Service) fetchGeneFiles(title string) ([]*model.GeneExample, error) {
	// main.go initConfig sets a viper.SetDefault for gene_file_path so
	// the lookup never returns ""; if it ever does, the os.ReadDir below
	// will surface a meaningful error instead of falling back to a
	// developer-specific Windows path.
	path := viper.GetString("gene_file_path")

	entries, err := os.ReadDir(path)
	if err != nil {
		return nil, err
	}

	var list []*model.GeneExample
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

func parseGeneFile(filename string) *model.GeneExample {
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

	return &model.GeneExample{
		FileName:    filename,
		SpeciesCode: speciesCode,
		GeneId:      geneId,
		// Id, CreatedAt, UpdatedAt, Content, DeleteAt 不需要填充
	}
}
func (ps *Service) GeneDetails(ctx context.Context, fileName string) (*model.GeneExample, error) {
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

func (ps *Service) GeneDetailsStorage(ctx context.Context, fileName, content, speciesCode, geneId string) error {

	gene := &model.GeneExample{
		FileName:    fileName,
		Content:     content,
		SpeciesCode: speciesCode,
		GeneId:      geneId,
		CreatedAt:   time.Time{},
	}
	err := model.DB(ctx).Model(&model.GeneExample{}).Create(gene).Error

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
// query token 上;相对路径经前端 /api/v1 代理回到本服务。
func relayDownloadURL(obsKey string) (string, error) {
	token, err := middleware.GenerateDownloadToken(obsKey, middleware.DownloadTokenTTL)
	if err != nil {
		return "", err
	}
	return "/api/v1/downloads/relay-file?t=" + url.QueryEscape(token), nil
}

func (ps *Service) DownloadAnalystAgentObsFile(ctx context.Context, username, obsPath string) (string, error) {
	// 判断是否有权限生成下载链接
	var questionAgentLog model.QuestionAgentLog
	if result := model.DB(ctx).Model(&model.QuestionAgentLog{}).Where("user_name = ? and download_path = ? and delete_at IS NULL", username, obsPath).
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

func (ps *Service) DownloadAnalystAgentObsImages(ctx context.Context, username, obsPath string) ([]string, error) {
	// 归属校验 + 取 reconcile 写入的图片路径(切流后由完成态 reconcile 填充)
	var row model.QuestionAgentLog
	if result := model.DB(ctx).Model(&model.QuestionAgentLog{}).
		Where("user_name = ? and download_path = ? and delete_at IS NULL", username, obsPath).
		First(&row).RowsAffected; result == 0 {
		return nil, errors.New("没有查找到对应的obs路径数据")
	}

	var keys []string
	if row.ImagePaths != "" {
		if err := json.Unmarshal([]byte(row.ImagePaths), &keys); err != nil {
			// 非空但非法 JSON:DB 损坏 / Bot 契约漂移 —— 报警后退回列举(保可用),
			// 不静默把损坏状态当作正常的旧行(legacy)处理。
			rxLog.Sugar().Warnw("image_paths 非法 JSON,退回 OBS 前缀列举", "download_path", obsPath, "err", err)
			keys = nil
		}
	}
	if len(keys) == 0 {
		// 旧行 / image_paths 为空:退回按前缀列举(保持今日行为)
		var err error
		keys, err = rxBot.NewClient().ListObsKeys(ctx, obsPath)
		if err != nil {
			return nil, friendlyRelayErr(err)
		}
	}

	// containment 锚点 = run 根(path.Dir(download_path))。写入侧 download_path 只存
	// dirs[0],但 image_paths 跨同一 run 的多个 sibling output_dir 扁平存放,故锚点
	// 不能是 download_path 本身(会误杀 sibling 图),取其父目录。download token 对
	// 任意 key 签名、无前缀绑定,签发循环是该 object 唯一授权闸,越界路径在此丢弃。
	anchor := path.Dir(obsPath)
	var imageUrls []string
	for _, k := range keys {
		if !strings.HasSuffix(strings.ToLower(k), ".png") {
			continue
		}
		if anchor != "" && anchor != "." && !strings.HasPrefix(k, anchor+"/") {
			// 越界路径:跳过 + 报警(fail-safe:丢可疑、服务其余、可观测)
			rxLog.Sugar().Warnw("图片路径越出 run 根,跳过签发", "key", k, "anchor", anchor)
			continue
		}
		u, err := relayDownloadURL(k)
		if err != nil {
			// 单个签发失败跳过,保持原"跳过坏文件"行为;加 warn 以可观测。
			rxLog.Sugar().Warnw("图片签发失败,跳过", "key", k, "err", err)
			continue
		}
		imageUrls = append(imageUrls, u)
	}

	if len(imageUrls) == 0 {
		return nil, errors.New("在指定目录下未找到png图片文件")
	}

	return imageUrls, nil
}

// GetDownloadObsFile 服务邮件里的下载链接:校验 obs_path 归属于该用户的
// 消息记录(邮件链接无法携带任何凭据,这层库内归属校验是该入口仅有的访问
// 控制),经 Bot 中转找到结果 zip 并返回字节流,由 handler 直接写回浏览器。
func (ps *Service) GetDownloadObsFile(ctx context.Context, username, obsPath string) (io.ReadCloser, string, int64, error) {
	var questionAgentLog model.QuestionAgentLog
	if result := model.DB(ctx).Model(&model.QuestionAgentLog{}).Where("user_name = ? and download_path = ? and delete_at IS NULL", username, obsPath).
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

func (ps *Service) DownloadObsRenderingFile(ctx context.Context, id int, format string) ([]byte, string, error) {

	var questionAgentLog *model.QuestionAgentLog
	db := model.DB(ctx).Model(&model.QuestionAgentLog{})

	if err := db.Where("id = ?", id).First(&questionAgentLog).Error; err != nil {
		return nil, "", err
	}
	agent, err := document_format.NewAgent(questionAgentLog.ToolName)
	if err != nil {
		return nil, "", err
	}

	return agent.Download(format, questionAgentLog.Answer)
}
