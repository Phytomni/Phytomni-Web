package api_handler

import "nky_client_go/service/api_service"

func NewHandler() *Handler {
	return &Handler{
		service: api_service.NewService(),
	}
}

type Handler struct {
	service *api_service.Service
}
