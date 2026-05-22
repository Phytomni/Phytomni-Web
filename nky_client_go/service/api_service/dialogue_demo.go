package api_service

import (
	"bytes"
	"crypto/tls"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"nky_client_go/common"

	"github.com/spf13/viper"
)

func RunDialogue(ResearchTheme, user, query, conversationId, messageId string, files []string) (response *common.DialogueResponse, err error) {
	dialogueData := &common.DialogueRequestData{
		Inputs: common.Inputs{
			ResearchTheme: ResearchTheme,
		},
		User:           user,
		Query:          query,
		ConversationId: conversationId,
		MessageId:      messageId,
		Files:          files,
	}
	jsonData, err := json.Marshal(dialogueData)
	if err != nil {
		return nil, fmt.Errorf("error marshaling request: %v", err)
	}

	// 创建跳过 TLS 验证的 HTTP 客户端
	tr := &http.Transport{
		TLSClientConfig: &tls.Config{InsecureSkipVerify: true},
	}
	client := &http.Client{Transport: tr}

	difyURL := viper.GetString("dify.chat_messages_url")
	difyKey := viper.GetString("dify.api_key")
	if difyURL == "" || difyKey == "" {
		return nil, errors.New("dify.chat_messages_url 或 dify.api_key 未配置")
	}

	req, err := http.NewRequest("POST", difyURL, bytes.NewBuffer(jsonData))
	if err != nil {
		return nil, fmt.Errorf("error creating request: %v", err)
	}
	req.Header.Set("Authorization", "Bearer "+difyKey)
	req.Header.Set("Content-Type", "application/json")

	resp, err := client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("request failed: %v", err)
	}
	if resp != nil {
		defer func() {
			closeErr := resp.Body.Close()
			if closeErr != nil && err == nil {
				err = fmt.Errorf("error closing response body: %v", closeErr)
			}
		}()
	}

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("unexpected status code: %d", resp.StatusCode)
	}

	if err = json.NewDecoder(resp.Body).Decode(&response); err != nil {
		return nil, fmt.Errorf("error decoding response: %v", err)
	}

	return response, nil
}
