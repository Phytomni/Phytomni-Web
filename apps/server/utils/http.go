package utils

import (
	"bytes"
	"io/ioutil"
	"net/http"
)

func HttpPostRequestJson(httpUrl string, jsonData []byte) (string, error) {
	req, err := http.NewRequest("POST", httpUrl, bytes.NewBuffer(jsonData))
	if err != nil {
		return "", err
	}

	// 设置请求头，指定内容类型为application/json
	req.Header.Set("Content-Type", "application/json")

	// 发送请求
	client := &http.Client{}
	resp, err := client.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()

	body, err := ioutil.ReadAll(resp.Body)
	if err != nil {
		return "", err
	}

	return string(body), nil
}
