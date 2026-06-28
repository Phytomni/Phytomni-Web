package model

import (
	"time"
)

type User struct {
	Id               int64      `json:"id"`
	Email            string     `json:"email"`
	Password         string     `json:"password"`
	Code             string     `json:"code"`
	Description      string     `json:"description"`
	FirstLoginStatus string     `gorm:"column:first_login_status;type:enum('0','1');default:'0';not null;comment:login status" json:"first_login_status"`
	CreatedAt        time.Time  `gorm:"column:created_at;type:datetime;comment:created at;" json:"created_at"`
	UpdatedAt        time.Time  `gorm:"column:updated_at;type:datetime;comment:updated at;" json:"updated_at"`
	DeleteAt         *time.Time `gorm:"column:delete_at;type:datetime;comment:deleted at" json:"delete_at"`
	PasswordChangeAt *time.Time `gorm:"column:password_change_at;type:datetime;comment:password last changed at" json:"password_change_at"`
	LoginFailedCount int        `gorm:"column:login_failed_count;type:int(11);default:0;comment:login failed count" json:"login_failed_count"`
	LockedUntil      *time.Time `gorm:"column:locked_until;type:datetime;comment:locked until" json:"locked_until"`
	LastLoginAt      *time.Time `gorm:"column:last_login_at;type:datetime;comment:last login at" json:"last_login_at"`
	Phone            string     `gorm:"column:phone;type:varchar(20);comment:phone number" json:"phone"`
	Organization     string     `gorm:"column:organization;type:varchar(255);comment:organization" json:"organization"`
	Position         string     `gorm:"column:position;type:varchar(255);comment:position" json:"position"`
	ChatLimit        int        `gorm:"column:chat_limit;type:int(11);default:0;comment:remaining chat count" json:"chat_limit"`
}

func (User) TableName() string {
	return "users"
}

type ToolName struct {
	Id          int64  `gorm:"column:id;type:bigint(20) unsigned;primary_key;AUTO_INCREMENT;comment:primary key ID" json:"id"`
	ToolName    string `json:"tool_name"`
	Description string `json:"description"`
}

func (ToolName) TableName() string {
	return "tool_names"
}

type UserToolName struct {
	Id     int64  `json:"id"`
	Code   string `json:"code"`
	ToolId string `json:"tool_id"`
}

func (UserToolName) TableName() string {
	return "user_tool_names"
}

type QuestionAgentLog struct {
	Id                int64      `gorm:"column:id;type:bigint(20) unsigned;primary_key;AUTO_INCREMENT;comment:primary key ID" json:"id"`
	DialogueId        string     `gorm:"column:dialogue_id;type:varchar(255);comment:state: dialogue id;NOT NULL" json:"dialogue_id"`
	FId               int64      `gorm:"column:f_id;type:int(11);comment:state: parent id;NOT NULL" json:"f_id"`
	ServerId          string     `gorm:"column:server_id;type:varchar(255);comment:state: server_id;NOT NULL" json:"server_id"`
	BotRunId          string     `gorm:"column:bot_run_id;type:varchar(64);comment:Bot run_id cross-service join key;NULL" json:"bot_run_id"`
	UserName          string     `gorm:"column:user_name;type:varchar(255);comment:user name;NOT NULL" json:"user_name"`
	Query             string     `gorm:"column:query;type:text;comment:question;NOT NULL" json:"query"`
	TitleQuery        string     `gorm:"column:title_query;type:text;comment:title question;NOT NULL" json:"title_query"`
	Answer            string     `gorm:"column:answer;type:text;comment:answer;NOT NULL" json:"answer"`
	FollowUpQuestions string     `gorm:"column:follow_up_questions;type:text;comment:follow-up prompts;NOT NULL" json:"follow_up_questions"`
	TaskId            string     `gorm:"column:task_id;type:varchar(50);comment:task id;NOT NULL" json:"task_id"`
	TaskLog           string     `gorm:"column:task_log;type:longtext;comment:task log;NOT NULL" json:"task_log"`
	FileName          string     `gorm:"column:file_name;type:varchar(255);comment:file name" json:"file_name"`
	UploadPath        string     `gorm:"column:upload_path;type:varchar(255);comment:upload path" json:"upload_path"`
	DownloadPath      string     `gorm:"column:download_path;type:varchar(255);comment:download path" json:"download_path"`
	ImagePaths        string     `gorm:"column:image_paths;type:text;comment:gallery image OBS paths (JSON array);NULL" json:"image_paths"`
	ComputeResource   string     `gorm:"column:compute_resource;type:varchar(50);comment:compute resource" json:"compute_resource"`
	ServerFilePath    string     `gorm:"column:server_file_path;type:varchar(255);comment:server file path" json:"server_file_path"`
	ToolName          string     `gorm:"column:tool_name;type:varchar(30);comment:tool type;NOT NULL" json:"tool_name"`
	Status            string     `gorm:"column:status;type:varchar(30);comment:task status;NOT NULL" json:"status"`
	LogStatus         string     `gorm:"column:log_status;type:varchar(30);comment:log status;NOT NULL" json:"log_status"`
	ReactionType      string     `gorm:"column:reaction_type;type:enum('0','1','2');default:'0';not null;comment:reaction status" json:"reaction_type"`
	CollectType       string     `gorm:"column:collect_type;type:enum('0','1');default:'0';not null;comment:collect status" json:"collect_type"`
	CreatedAt         time.Time  `gorm:"column:created_at;type:datetime;comment:created at;" json:"created_at"`
	UpdatedAt         time.Time  `gorm:"column:updated_at;type:datetime;comment:updated at;" json:"updated_at"`
	DeleteAt          *time.Time `gorm:"column:delete_at;type:datetime;comment:deleted at" json:"delete_at"`
}

func (m *QuestionAgentLog) TableName() string {
	return "question_agent_logs"
}

type GeneList struct {
	Id       int64  `gorm:"column:id;type:int(11) unsigned;primary_key;AUTO_INCREMENT;comment:primary key ID" json:"id"`
	Title    string `gorm:"column:title;type:varchar(255);comment:title;NOT NULL" json:"title"`
	Synopsis string `gorm:"column:synopsis;type:varchar(255);comment:synopsis;NOT NULL" json:"synopsis"`
	Picture  string `gorm:"column:picture;type:varchar(255);comment:picture;NOT NULL" json:"picture"`
	Content  string `gorm:"column:content;type:longtext;comment:content;NOT NULL" json:"content"`
}

func (m *GeneList) TableName() string {
	return "gene_lists"
}

type GeneExample struct {
	Id          int64      `gorm:"column:id;type:int(11) unsigned;primary_key;AUTO_INCREMENT;comment:primary key ID" json:"id"`
	FileName    string     `gorm:"column:file_name;type:varchar(255);comment:file name;NOT NULL" json:"file_name"`
	Content     string     `gorm:"column:content;type:longtext;comment:content;NOT NULL" json:"content"`
	SpeciesCode string     `gorm:"column:species_code;type:varchar(255);comment:species code;NOT NULL" json:"species_code"`
	GeneId      string     `gorm:"column:gene_id;type:varchar(255);comment:gene id;NOT NULL" json:"gene_id"`
	CreatedAt   time.Time  `gorm:"column:created_at;type:datetime;comment:created at;" json:"created_at"`
	UpdatedAt   time.Time  `gorm:"column:updated_at;type:datetime;comment:updated at;" json:"updated_at"`
	DeleteAt    *time.Time `gorm:"column:delete_at;type:datetime;comment:deleted at" json:"delete_at"`
}

func (m *GeneExample) TableName() string {
	return "gene_examples"
}

type UserPermission struct {
	Id   int64  `gorm:"column:id;type:int(11) unsigned;primary_key;AUTO_INCREMENT;comment:primary key ID" json:"id"`
	Name string `gorm:"column:name;type:varchar(255);comment:permission name;NOT NULL" json:"name"`
}

func (m *UserPermission) TableName() string {
	return "user_permissions"
}

type ServerToolLogs struct {
	Id             int        `gorm:"column:id;type:bigint(20) unsigned;primary_key;AUTO_INCREMENT;comment:primary key ID" json:"id"`
	ServerId       string     `gorm:"column:server_id;type:varchar(255);comment:server_id;NOT NULL" json:"server_id"`
	ToolResult     string     `gorm:"column:tool_result;type:longtext;comment:tool execution result;NOT NULL" json:"tool_result"`
	ToolName       string     `gorm:"column:tool_name;type:varchar(30);comment:tool type;NOT NULL" json:"tool_name"`
	ServerFilePath string     `gorm:"column:server_file_path;type:varchar(255);comment:server file path" json:"server_file_path"`
	ServerStatus   string     `gorm:"column:server_status;type:varchar(30);comment:server status;NOT NULL" json:"server_status"`
	SyncStatus     int        `gorm:"column:sync_status;type:int(1);comment:sync status: 0-unsynced, 1-synced;NOT NULL" json:"sync_status"`
	CreatedAt      time.Time  `gorm:"column:created_at;type:datetime;comment:created at;" json:"created_at"`
	UpdatedAt      time.Time  `gorm:"column:updated_at;type:datetime;comment:updated at;" json:"updated_at"`
	DeleteAt       *time.Time `gorm:"column:delete_at;type:datetime;comment:deleted at" json:"delete_at"`
}

func (m *ServerToolLogs) TableName() string {
	return "server_tool_logs"
}

type UserFeedback struct {
	Id              int        `gorm:"column:id;type:int(10) unsigned;primary_key;AUTO_INCREMENT;comment:primary key ID" json:"id"`
	UserId          int        `gorm:"column:user_id;type:int(10);comment:user id;NOT NULL" json:"user_id"`
	FeedbackType    string     `gorm:"column:feedback_type;type:varchar(255);comment:feedback type;NOT NULL" json:"feedback_type"`
	FeedbackContent string     `gorm:"column:feedback_content;type:text;comment:feedback content;NOT NULL" json:"feedback_content"`
	CreatedAt       time.Time  `gorm:"column:created_at;type:datetime;comment:created at;" json:"created_at"`
	UpdatedAt       time.Time  `gorm:"column:updated_at;type:datetime;comment:updated at;" json:"updated_at"`
	DeleteAt        *time.Time `gorm:"column:delete_at;type:datetime;comment:deleted at" json:"delete_at"`
}

func (m *UserFeedback) TableName() string {
	return "user_feedback"
}

type UserOperationLog struct {
	Id           int64     `gorm:"column:id;type:bigint(20) unsigned;primary_key;AUTO_INCREMENT;comment:primary key ID" json:"id"`
	UserId       int64     `gorm:"column:user_id;type:bigint(20);default:0;comment:user ID (0 if not logged in);index" json:"user_id"`
	UserEmail    string    `gorm:"column:user_email;type:varchar(255);comment:user email;index" json:"user_email"`
	Method       string    `gorm:"column:method;type:varchar(10);comment:request method" json:"method"`
	Path         string    `gorm:"column:path;type:varchar(255);comment:request path;index" json:"path"`
	QueryParams  string    `gorm:"column:query_params;type:text;comment:URL params" json:"query_params"`
	BodyParams   string    `gorm:"column:body_params;type:longtext;comment:request body (redacted)" json:"body_params"`
	ClientIp     string    `gorm:"column:client_ip;type:varchar(50);comment:client IP" json:"client_ip"`
	UserAgent    string    `gorm:"column:user_agent;type:varchar(500);comment:user agent" json:"user_agent"`
	StatusCode   int       `gorm:"column:status_code;type:int(11);comment:HTTP status code" json:"status_code"`
	Latency      int64     `gorm:"column:latency;type:bigint(20);comment:latency (ms)" json:"latency"`
	ErrorMessage string    `gorm:"column:error_message;type:text;comment:error message" json:"error_message"`
	CreatedAt    time.Time `gorm:"column:created_at;type:datetime;comment:created at;index" json:"created_at"`
}

func (m *UserOperationLog) TableName() string {
	return "user_operation_logs"
}
