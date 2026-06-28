package common

import "time"

type UserResquest struct {
	Id       int    `json:"id"`
	Email    string `json:"email" binding:"required"`
	Password string `json:"password" binding:"required"`
	Code     string `json:"code"`
}

type UserModifyPasswordRequest struct {
	Password    string `json:"password" binding:"required"`
	NewPassword string `json:"new_password" binding:"required"`
}

type ApiQueryListDeleteRequest struct {
	Id int `json:"id" binding:"required"`
}

type QueryListRequest struct {
	Id         int64     `json:"id"`
	DialogueId string    `json:"dialogue_id"`
	TitleQuery string    `json:"title_query"`
	CreatedAt  time.Time `json:"created_at"`
}
