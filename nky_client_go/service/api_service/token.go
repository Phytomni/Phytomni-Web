package api_service

import (
	"bytes"
	"context"
	"fmt"
	"io/ioutil"
	"net/http"
	rxRedis "nky_client_go/cache"
	"nky_client_go/common"
	"nky_client_go/core"
	rxLog "nky_client_go/log"
	"nky_client_go/server/api"
	"os"

	"github.com/spf13/viper"
)

func (ps *ApiService) GetFreshToken() (response common.FreshTokenResponse, apiErr api.Error) {

	fmt.Println("获取token")

	// 认证用的ak和sk硬编码到代码中或者明文存储都有很大的安全风险，建议在配置文件或者环境变量中密文存放，使用时解密，确保安全；
	// 本示例以ak和sk保存在环境变量中为例，运行本示例前请先在本地环境中设置环境变量HUAWEICLOUD_SDK_AK和HUAWEICLOUD_SDK_SK。
	s := core.Signer{
		Key:    os.Getenv("HUAWEICLOUD_SDK_AK"),
		Secret: os.Getenv("HUAWEICLOUD_SDK_SK"),
	}
	r, err := http.NewRequest("POST", viper.GetString("huawei.apigw.app1_url"),
		ioutil.NopCloser(bytes.NewBuffer([]byte("foo=bar"))))
	if err != nil {
		fmt.Println(err)
		rxLog.Sugar().Info("发送华为获取token请求: ", err)
		return
	}

	r.Header.Add("content-type", "application/json; charset=utf-8")
	r.Header.Add("x-stage", "RELEASE")
	s.Sign(r)
	fmt.Println(r.Header)
	client := http.DefaultClient
	resp, err := client.Do(r)
	if err != nil {
		fmt.Println(err)
	}

	defer resp.Body.Close()
	body, err := ioutil.ReadAll(resp.Body)
	if err != nil {
		fmt.Println(err)
	}

	token := string(body)
	rxLog.Sugar().Info("请求token结果: ", token)

	// 缓存token
	rxRedis.ClientDefault("web").Set(context.Background(), common.RedisHWTokenKey, token, common.RedisHWTokenKeyEX-10).Result()
	return
}

func (ps *ApiService) GetCacheToken() (token string) {

	token, _ = rxRedis.ClientDefault("web").Get(context.Background(), common.RedisHWTokenKey).Result()

	if token == "" {
		//重新请求token，并缓存
		tokenResponse, _ := ps.GetFreshToken()
		token = tokenResponse.AccessToken
		if token != "" {
			rxRedis.ClientDefault("web").Set(context.Background(), common.RedisHWTokenKey, token, common.RedisHWTokenKeyEX-10).Result()
		}
	}

	return
}
