package api_service

import (
	"context"
	"errors"
	"fmt"
	"os"

	"nky_client_go/common/document_format"
	"nky_client_go/model"
	"strings"
	"time"

	"github.com/huaweicloud/huaweicloud-sdk-go-obs/obs"
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
	path := viper.GetString("gene_file_path")
	if path == "" {
		// 默认路径
		path = `E:\桌面\1228\20251228\nky_client_python\mcp_server_phytomni\.out`
	}

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
	path := viper.GetString("gene_file_path")
	if path == "" {
		// 默认路径
		path = `E:\桌面\1228\20251228\nky_client_python\mcp_server_phytomni\.out`
	}

	fullPath := fmt.Sprintf("%s\\%s", path, fileName)

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

func (ps *ApiService) ApiDownloadAnalystAgentObsFile(ctx context.Context, username, obsPath string) (string, error) {
	// 判断是否有权限生成下载链接
	var questionAgentLog model.SQuestionAgentLog
	if result := model.DB(ctx).Model(&model.SQuestionAgentLog{}).Where("user_name = ? and download_path = ? and delete_at IS NULL", username, obsPath).
		First(&questionAgentLog).RowsAffected; result == 0 {
		fmt.Println("questionAgentLog.Id", questionAgentLog.Id)
		return "", errors.New("没有查找到对应的obs路径数据")
	}

	// 1、初始化客户端
	ak := "HPUATWE0DXL6NVDAXTFU"                     // 替换为你的AK
	sk := "4eKpT5LPydBHelGqyQB6pAaFKSw0AwHkzJ46eDrT" // 替换为你的SK
	endpoint := "https://obs.cn-east-3.myhuaweicloud.com"
	expiration := 3600

	obsClient, err := obs.New(ak, sk, endpoint)
	if err != nil {
		return "", err
	}

	newObsPath := convertPath(obsPath)

	// 2、解析obs路径（得到桶名和目录路径）
	bucketName, directoryKey, err := ParseObsPath(newObsPath)
	if err != nil {
		return "", fmt.Errorf("解析OBS路径失败: %v", err)
	}

	// 3、列出目录下的所有文件
	listInput := &obs.ListObjectsInput{
		ListObjsInput: obs.ListObjsInput{
			Prefix: directoryKey,
		},
		Bucket: bucketName, // 桶名
	}
	listOutput, err := obsClient.ListObjects(listInput)
	if err != nil {
		return "", fmt.Errorf("列出目录文件失败: %v", err)
	}

	// 4、筛选出zip文件
	var zipObjectKey string
	for _, obj := range listOutput.Contents {
		// 检查文件是否以.zip结尾（区分大小写）
		if strings.HasSuffix(obj.Key, ".zip") {
			zipObjectKey = obj.Key
			// 如果有多个zip文件，这里取第一个，可根据需求调整
			break
		}
	}

	if zipObjectKey == "" {
		return "", errors.New("在指定目录下未找到zip文件")
	}

	// 5、生成zip文件的1小时临时下载URL
	input := &obs.CreateSignedUrlInput{
		Method:  "GET", // 下载使用GET方法
		Bucket:  bucketName,
		Key:     zipObjectKey, // 使用找到的zip文件路径
		Expires: expiration,   // 过期时间（秒）
	}

	output, err := obsClient.CreateSignedUrl(input)
	if err != nil {
		return "", fmt.Errorf("生成临时下载链接失败: %v", err)
	}

	fmt.Println("zip文件临时下载URL:", output.SignedUrl)
	return output.SignedUrl, nil
}

func (ps *ApiService) ApiDownloadAnalystAgentObsImages(ctx context.Context, username, obsPath string) ([]string, error) {
	// 1、初始化客户端
	ak := "HPUATWE0DXL6NVDAXTFU"                     // 替换为你的AK
	sk := "4eKpT5LPydBHelGqyQB6pAaFKSw0AwHkzJ46eDrT" // 替换为你的SK
	endpoint := "https://obs.cn-east-3.myhuaweicloud.com"
	expiration := 3600

	obsClient, err := obs.New(ak, sk, endpoint)
	if err != nil {
		return nil, err
	}

	newObsPath := convertPath(obsPath)

	// 2、解析obs路径（得到桶名和目录路径）
	bucketName, directoryKey, err := ParseObsPath(newObsPath)
	if err != nil {
		return nil, fmt.Errorf("解析OBS路径失败: %v", err)
	}

	// 3、列出目录下的所有文件
	listInput := &obs.ListObjectsInput{
		ListObjsInput: obs.ListObjsInput{
			Prefix: directoryKey,
		},
		Bucket: bucketName, // 桶名
	}
	listOutput, err := obsClient.ListObjects(listInput)
	if err != nil {
		return nil, fmt.Errorf("列出目录文件失败: %v", err)
	}

	// 4、筛选出png文件并生成下载链接
	var imageUrls []string
	for _, obj := range listOutput.Contents {
		// 检查文件是否以.png结尾（不区分大小写，这里为了稳健转为小写判断）
		if strings.HasSuffix(strings.ToLower(obj.Key), ".png") {
			// 5、生成文件的1小时临时下载URL
			input := &obs.CreateSignedUrlInput{
				Method:  "GET", // 下载使用GET方法
				Bucket:  bucketName,
				Key:     obj.Key,
				Expires: expiration, // 过期时间（秒）
			}

			output, err := obsClient.CreateSignedUrl(input)
			if err != nil {
				// 如果生成单个文件失败，可以选择跳过或报错，这里选择打印日志继续
				fmt.Printf("生成图片下载链接失败 [%s]: %v\n", obj.Key, err)
				continue
			}
			imageUrls = append(imageUrls, output.SignedUrl)
		}
	}

	if len(imageUrls) == 0 {
		return nil, errors.New("在指定目录下未找到png图片文件")
	}

	return imageUrls, nil
}

func convertPath(path string) string {
	// 去除开头的斜杠
	path = strings.TrimPrefix(path, "/")

	// 如果路径以 "obs/" 开头，去掉这部分
	if strings.HasPrefix(path, "obs/") {
		path = strings.TrimPrefix(path, "obs/")
	}

	// 添加 obs:// 前缀
	return "obs://" + path
}

func ParseObsPath(obsPath string) (bucketName, objectKey string, err error) {
	if !strings.HasPrefix(obsPath, "obs://") {
		return "", "", errors.New("invalid OBS path, must start with 'obs://'")
	}

	// 去掉 "obs://"
	pathWithoutScheme := strings.TrimPrefix(obsPath, "obs://")

	// 分割 bucket 和 objectKey
	parts := strings.SplitN(pathWithoutScheme, "/", 2)
	if len(parts) < 1 {
		return "", "", errors.New("invalid OBS path, missing bucket name")
	}

	bucketName = parts[0]
	if len(parts) == 2 {
		objectKey = parts[1]
	}

	return bucketName, objectKey, nil
}

func (ps *ApiService) ApiGetDownloadObsFile(ctx context.Context, username, obsPath string) (string, error) {
	////1、初始化客户端
	//ak := "HPUATWE0DXL6NVDAXTFU"                     // 替换为你的AK
	//sk := "4eKpT5LPydBHelGqyQB6pAaFKSw0AwHkzJ46eDrT" // 替换为你的SK
	//endpoint := "https://obs.cn-east-3.myhuaweicloud.com"
	//expiration := 3600
	////判断是否有权限生成下载链接
	//var questionAgentLog model.SQuestionAgentLog
	//if result := model.DB(ctx).Model(&model.SQuestionAgentLog{}).Where("user_name = ? and download_path = ? and delete_at IS NULL", username, obsPath).
	//	First(&questionAgentLog).RowsAffected; result == 0 {
	//	return "", errors.New("没有查找到对应的obs路径数据")
	//}
	//
	//obsClient, err := obs.New(ak, sk, endpoint)
	//if err != nil {
	//	return "", err
	//}
	////2、解析obs路径
	//
	//bucketName, objectKey, err := ParseObsPath(obsPath)
	//if err != nil {
	//	return "", fmt.Errorf("failed to parse OBS path: %v", err)
	//}
	//
	//// 3. 生成1小时后过期的临时URL
	//input := &obs.CreateSignedUrlInput{
	//	Method:  "GET", // 允许GET请求（下载）
	//	Bucket:  bucketName,
	//	Key:     objectKey,
	//	Expires: expiration,
	//}
	//
	//output, err := obsClient.CreateSignedUrl(input)
	//if err != nil {
	//	return "", err
	//}
	//
	//// 4. 打印临时URL
	//fmt.Println("临时下载URL:", output.SignedUrl)
	//
	//return output.SignedUrl, nil
	// 1、初始化客户端
	ak := "HPUATWE0DXL6NVDAXTFU"                     // 替换为你的AK
	sk := "4eKpT5LPydBHelGqyQB6pAaFKSw0AwHkzJ46eDrT" // 替换为你的SK
	endpoint := "https://obs.cn-east-3.myhuaweicloud.com"
	expiration := 3600

	obsClient, err := obs.New(ak, sk, endpoint)
	if err != nil {
		return "", err
	}

	newObsPath := convertPath(obsPath)

	// 2、解析obs路径（得到桶名和目录路径）
	bucketName, directoryKey, err := ParseObsPath(newObsPath)
	if err != nil {
		return "", fmt.Errorf("解析OBS路径失败: %v", err)
	}

	// 3、列出目录下的所有文件
	listInput := &obs.ListObjectsInput{
		ListObjsInput: obs.ListObjsInput{
			Prefix: directoryKey,
		},
		Bucket: bucketName, // 桶名
	}
	listOutput, err := obsClient.ListObjects(listInput)
	if err != nil {
		return "", fmt.Errorf("列出目录文件失败: %v", err)
	}

	// 4、筛选出zip文件
	var zipObjectKey string
	for _, obj := range listOutput.Contents {
		// 检查文件是否以.zip结尾（区分大小写）
		if strings.HasSuffix(obj.Key, ".zip") {
			zipObjectKey = obj.Key
			// 如果有多个zip文件，这里取第一个，可根据需求调整
			break
		}
	}

	if zipObjectKey == "" {
		return "", errors.New("在指定目录下未找到zip文件")
	}

	// 5、生成zip文件的1小时临时下载URL
	input := &obs.CreateSignedUrlInput{
		Method:  "GET", // 下载使用GET方法
		Bucket:  bucketName,
		Key:     zipObjectKey, // 使用找到的zip文件路径
		Expires: expiration,   // 过期时间（秒）
	}

	output, err := obsClient.CreateSignedUrl(input)
	if err != nil {
		return "", fmt.Errorf("生成临时下载链接失败: %v", err)
	}

	fmt.Println("zip文件临时下载URL:", output.SignedUrl)
	return output.SignedUrl, nil
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
