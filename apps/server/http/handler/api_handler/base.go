package api_handler

import "phytomni-server/service/api_service"

func NewHandler() *Handler {
	return &Handler{
		service: api_service.NewService(),
	}
}

type Handler struct {
	service *api_service.Service
}
