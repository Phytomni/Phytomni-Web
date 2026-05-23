package api_service

import (
	"bytes"
	"crypto/tls"
	"encoding/json"
	"fmt"
	"github.com/spf13/viper"
	"io"
	"net/http"
	"nky_client_go/common"
	"sort"
	"strings"
)

type SearchRequest struct {
	RepoID   string `json:"repo_id"`
	Content  string `json:"content"`
	PageNum  int    `json:"page_num"`
	PageSize int    `json:"page_size"`
}

type SearchResult struct {
	Content string  `json:"content"`
	Score   float64 `json:"score"`
}

type SearchResponse struct {
	DocList []SearchResult `json:"doc_list"`
}

type RAGConfig struct {
	QuestionUrl string `json:"question_url" yaml:"question_url"  mapstructure:"question_url"`
	SearchUrl   string `json:"search_url" yaml:"search_url" mapstructure:"search_url"`
}

var RConfig *RAGConfig

func InitViperRAG() error {
	var cfg *RAGConfig
	err := viper.UnmarshalKey("koosearch.url", &cfg)
	if err != nil {
		return err
	}
	RConfig = cfg
	return nil
}

func RunRAG(repoID, query string, pageNum, pageSize int) (string, error) {
	prompt := fmt.Sprintf(`[Question]: %s
    [Guidelines]: You will need to find the bioinformatics analysis methods that are most relevant to 
    the question above, and return the analysis methods section.`, query)

	requestBody := SearchRequest{
		RepoID:   repoID,
		Content:  prompt,
		PageNum:  pageNum,
		PageSize: pageSize,
	}

	jsonData, err := json.Marshal(requestBody)
	if err != nil {
		return "", fmt.Errorf("error marshaling request: %v", err)
	}

	// 创建跳过 TLS 验证的 HTTP 客户端
	tr := &http.Transport{
		TLSClientConfig: &tls.Config{InsecureSkipVerify: true},
	}
	client := &http.Client{Transport: tr}

	resp, err := client.Post(
		RConfig.SearchUrl,
		"application/json",
		bytes.NewBuffer(jsonData),
	)
	if err != nil {
		return "", fmt.Errorf("request failed: %v", err)
	}
	defer func(Body io.ReadCloser) {
		err = Body.Close()
		if err != nil {

		}
	}(resp.Body)

	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("unexpected status code: %d", resp.StatusCode)
	}

	var response SearchResponse
	if err = json.NewDecoder(resp.Body).Decode(&response); err != nil {
		return "", fmt.Errorf("error decoding response: %v", err)
	}

	// 按分数降序排序
	sort.Slice(response.DocList, func(i, j int) bool {
		return response.DocList[i].Score > response.DocList[j].Score
	})

	var contents []string
	for _, doc := range response.DocList {
		contents = append(contents, doc.Content)
	}
	return strings.Join(contents, "\n\n"), nil
}

func RunKooSearchQuestion(request common.KooSearchQuestionRequest) (*common.KooSearchQuestionResponse, error) {

	requestBody := &common.KooSearchQuestionRequest{
		RepoID:            request.RepoID,
		ExtraRepoIDs:      request.ExtraRepoIDs,
		ChatID:            request.ChatID,
		KooSearchMessages: request.KooSearchMessages,
		ChatCreateFlag:    request.ChatCreateFlag,
		RefreshFlag:       request.RefreshFlag,
		Stream:            request.Stream,
		TopP:              request.TopP,
		MaxTokens:         request.MaxTokens,
		ChatTemperature:   request.ChatTemperature,
		SearchTemperature: request.SearchTemperature,
		PresencePenalty:   request.PresencePenalty,
	}
	fmt.Println(requestBody)
	jsonData, err := json.Marshal(requestBody)
	if err != nil {
		return nil, fmt.Errorf("error marshaling request: %v", err)
	}

	// 创建跳过 TLS 验证的 HTTP 客户端
	tr := &http.Transport{
		TLSClientConfig: &tls.Config{InsecureSkipVerify: true},
	}
	client := &http.Client{Transport: tr}

	resp, err := client.Post(
		RConfig.QuestionUrl,
		"application/json",
		bytes.NewBuffer(jsonData),
	)
	if err != nil {
		return nil, fmt.Errorf("request failed: %v", err)
	}
	defer func(Body io.ReadCloser) {
		err = Body.Close()
		if err != nil {
			return
		}
	}(resp.Body)

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("unexpected status code: %d", resp.StatusCode)
	}

	var response *common.KooSearchQuestionResponse
	if err = json.NewDecoder(resp.Body).Decode(&response); err != nil {
		return nil, fmt.Errorf("error decoding response: %v", err)
	}

	return response, nil
}

func RunKooSearchSearch(request common.KooSearchSearchRequest) (*common.KooSearchSearchResponse, error) {

	requestBody := &common.KooSearchSearchRequest{
		RepoID:       request.RepoID,
		Content:      request.Content,
		PageNum:      request.PageNum,
		PageSize:     request.PageSize,
		Scope:        request.Scope,
		ExtraRepoIds: request.ExtraRepoIds,
	}

	jsonData, err := json.Marshal(requestBody)
	if err != nil {
		return nil, fmt.Errorf("error marshaling request: %v", err)
	}

	// 创建跳过 TLS 验证的 HTTP 客户端
	tr := &http.Transport{
		TLSClientConfig: &tls.Config{InsecureSkipVerify: true},
	}
	client := &http.Client{Transport: tr}

	resp, err := client.Post(
		RConfig.SearchUrl,
		"application/json",
		bytes.NewBuffer(jsonData),
	)
	if err != nil {
		return nil, fmt.Errorf("request failed: %v", err)
	}
	defer func(Body io.ReadCloser) {
		err = Body.Close()
		if err != nil {
			return
		}
	}(resp.Body)

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("unexpected status code: %d", resp.StatusCode)
	}

	var response *common.KooSearchSearchResponse
	if err = json.NewDecoder(resp.Body).Decode(&response); err != nil {
		return nil, fmt.Errorf("error decoding response: %v", err)
	}

	return response, nil
}
