package api_service

import (
	"errors"
	"fmt"
	"github.com/huaweicloud/huaweicloud-sdk-go-obs/obs"
	"nky_client_go/common/document_format"
	"nky_client_go/model"
	"strings"
	"time"
)

func (ps *ApiService) ApiGeneList(current, size int) ([]*model.SGeneExample, int64, int, error) {
	var geneListData []*model.SGeneExample
	var total int64

	// 计算总记录数
	db := model.Default().Model(&model.SGeneExample{})
	if err := db.Count(&total).Error; err != nil {
		return nil, 0, 0, err
	}

	// 计算总页数
	totalPages := int((total + int64(size) - 1) / int64(size))

	// 执行分页查询
	offset := (current - 1) * size
	if err := db.Offset(offset).Limit(size).Find(&geneListData).Error; err != nil {
		return nil, 0, 0, err
	}

	return geneListData, total, totalPages, nil
}

func (ps *ApiService) ApiGeneSearch(current, size int, title string) ([]*model.SGeneExample, int64, int, error) {
	var geneList []*model.SGeneExample
	var total int64

	// 构建基础查询
	db := model.Default().Model(&model.SGeneExample{})

	// 添加模糊查询条件
	if title != "" {
		db = db.Where("species_code LIKE ? OR gene_id LIKE ?", "%"+title+"%", "%"+title+"%")
	}

	// 计算总记录数
	if err := db.Count(&total).Error; err != nil {
		return nil, 0, 0, err
	}

	// 计算总页数
	totalPages := int((total + int64(size) - 1) / int64(size))

	// 执行分页查询
	offset := (current - 1) * size
	if err := db.Offset(offset).Limit(size).Find(&geneList).Error; err != nil {
		return nil, 0, 0, err
	}

	return geneList, total, totalPages, nil
}
func (ps *ApiService) ApiGeneDetails(id int) (*model.SGeneExample, error) {
	var geneList *model.SGeneExample

	// 构建基础查询
	db := model.Default().Model(&model.SGeneExample{})
	if err := db.Where("id = ?", id).First(&geneList).Error; err != nil {
		return nil, err
	}

	return geneList, nil
}

func (ps *ApiService) ApiGeneDetailsStorage(fileName, content, speciesCode, geneId string) error {

	gene := &model.SGeneExample{
		FileName:    fileName,
		Content:     content,
		SpeciesCode: speciesCode,
		GeneId:      geneId,
		CreatedAt:   time.Time{},
	}
	err := model.Default().Model(&model.SGeneExample{}).Create(gene).Error

	return err
}

func (ps *ApiService) ApiDownloadAnalystAgentObsFile(username, obsPath string) (string, error) {
	// 判断是否有权限生成下载链接
	var questionAgentLog model.SQuestionAgentLog
	if result := model.Default().Model(&model.SQuestionAgentLog{}).Where("user_name = ? and download_path = ? and delete_at IS NULL", username, obsPath).
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

func (ps *ApiService) ApiGetDownloadObsFile(username, obsPath string) (string, error) {
	////1、初始化客户端
	//ak := "HPUATWE0DXL6NVDAXTFU"                     // 替换为你的AK
	//sk := "4eKpT5LPydBHelGqyQB6pAaFKSw0AwHkzJ46eDrT" // 替换为你的SK
	//endpoint := "https://obs.cn-east-3.myhuaweicloud.com"
	//expiration := 3600
	////判断是否有权限生成下载链接
	//var questionAgentLog model.SQuestionAgentLog
	//if result := model.Default().Model(&model.SQuestionAgentLog{}).Where("user_name = ? and download_path = ? and delete_at IS NULL", username, obsPath).
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

func (ps *ApiService) ApiDownloadObsRenderingFile(id int, format string) ([]byte, string, error) {

	var questionAgentLog *model.SQuestionAgentLog
	db := model.Default().Model(&model.SQuestionAgentLog{})

	if err := db.Where("id = ?", id).First(&questionAgentLog).Error; err != nil {
		return nil, "", err
	}
	agent, err := document_format.NewAgent(questionAgentLog.ToolName)
	if err != nil {
		return nil, "", err
	}

	return agent.Download(format, questionAgentLog.Answer)
}
