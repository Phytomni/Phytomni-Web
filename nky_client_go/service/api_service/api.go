package api_service

import (
	"nky_client_go/common"
	"nky_client_go/server/api"
)

func (ps *ApiService) ApiIndexList(typeId int) (response common.ChineseBookResponse, apiErr api.Error) {

	response.Page = 1
	response.Total = 10

	return
}
