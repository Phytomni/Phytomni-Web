package common

import (
	"phytomni-server/model"
	"time"
)

type UserResponse struct {
	Id               int64  `gorm:"column:id;type:bigint(20) unsigned;primary_key;AUTO_INCREMENT;comment:primary key ID" json:"id"`
	Email            string `json:"email"`
	Password         string `json:"-"` // never serialized to clients (bcrypt hash; carried internally only)
	FirstLoginStatus string `json:"first_login_status"`
	PasswordWarning  string `json:"password_warning,omitempty"`
}

type DocItem struct {
	Content string  `json:"content"`
	Score   float64 `json:"score"`
}

type LoginResponse struct {
	ToolList       []string `json:"tool_list"`
	PermissionList []string `json:"permission_list"`
	Permission     string   `json:"permission"`
}

type UserListResponse struct {
	Total      int64           `json:"total"`
	TotalPages int             `json:"total_pages"`
	UserList   []*UserLostData `json:"user_list"`
}

type UserLostData struct {
	Id           int64      `json:"id"`
	Email        string     `json:"email"`
	Code         string     `json:"code"`
	Description  string     `json:"description"`
	LockedUntil  *time.Time `json:"locked_until"`
	LastLoginAt  *time.Time `json:"last_login_at"`
	Phone        string     `json:"phone"`
	Organization string     `json:"organization"`
	Position     string     `json:"position"`
	ChatLimit    int        `json:"chat_limit"`
}

type GeneListResponse struct {
	Total      int64                `json:"total"`
	TotalPages int                  `json:"total_pages"`
	GeneList   []*model.GeneExample `json:"gene_list"`
}

type ApiAsyncTaskListResponse struct {
	Id              int64      `gorm:"column:id;type:bigint(20) unsigned;primary_key;AUTO_INCREMENT;comment:primary key ID" json:"id"`
	DialogueId      string     `gorm:"column:dialogue_id;type:varchar(255);comment:state: dialogue id;NOT NULL" json:"dialogue_id"`
	FId             int64      `gorm:"column:f_id;type:int(11);comment:state: parent id;NOT NULL" json:"f_id"`
	ServerId        string     `gorm:"column:server_id;type:varchar(255);comment:state: server_id;NOT NULL" json:"server_id"`
	UserName        string     `gorm:"column:user_name;type:varchar(255);comment:user name;NOT NULL" json:"user_name"`
	Query           string     `gorm:"column:query;type:longtext;comment:question;NOT NULL" json:"query"`
	Answer          string     `gorm:"column:answer;type:text;comment:answer;NOT NULL" json:"answer"`
	TaskId          string     `gorm:"column:task_id;type:varchar(50);comment:task id;NOT NULL" json:"task_id"`
	TaskLog         string     `gorm:"column:task_log;type:longtext;comment:task log;NOT NULL" json:"task_log"`
	FileName        string     `gorm:"column:file_name;type:varchar(255);comment:file name" json:"file_name"`
	UploadPath      string     `gorm:"column:upload_path;type:varchar(255);comment:upload path" json:"upload_path"`
	DownloadPath    string     `gorm:"column:download_path;type:varchar(255);comment:download path" json:"download_path"`
	ComputeResource string     `gorm:"column:compute_resource;type:varchar(50);comment:compute resource" json:"compute_resource"`
	ServerFilePath  string     `gorm:"column:server_file_path;type:varchar(255);comment:server file path" json:"server_file_path"`
	ToolName        string     `gorm:"column:tool_name;type:varchar(30);comment:tool type;NOT NULL" json:"tool_name"`
	Status          string     `gorm:"column:status;type:varchar(30);comment:task status;NOT NULL" json:"status"`
	LogStatus       string     `gorm:"column:log_status;type:varchar(30);comment:log status;NOT NULL" json:"log_status"`
	ReactionType    string     `gorm:"column:reaction_type;type:enum('0','1','2');default:'0';not null;comment:reaction status" json:"reaction_type"`
	CreatedAt       time.Time  `gorm:"column:created_at;type:datetime;comment:created at;" json:"created_at"`
	UpdatedAt       time.Time  `gorm:"column:updated_at;type:datetime;comment:updated at;" json:"updated_at"`
	DeleteAt        *time.Time `gorm:"column:delete_at;type:datetime;comment:deleted at" json:"delete_at"`
	FDialogueId     string     `gorm:"-" json:"f_dialogue_id"`
}

type ApiAsyncTaskListResponsePages struct {
	Total      int64                       `json:"total"`
	TotalPages int                         `json:"total_pages"`
	GeneList   []*ApiAsyncTaskListResponse `json:"gene_list"`
}

type ApiQueryCollectListResponse struct {
	Id         int64     `json:"id"`
	DialogueId string    `json:"dialogue_id"`
	Query      string    `json:"query"`
	CreatedAt  time.Time `json:"created_at"`
}

type UserProfileResponse struct {
	UserLostData
	DialogueCount int64 `json:"dialogue_count"`
}
