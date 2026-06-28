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
	FirstLoginStatus string     `gorm:"column:first_login_status;type:enum('0','1');default:'0';not null;comment:登陆状态" json:"first_login_status"`
	CreatedAt        time.Time  `gorm:"column:created_at;type:datetime;comment:创建时间;" json:"created_at"`
	UpdatedAt        time.Time  `gorm:"column:updated_at;type:datetime;comment:更新时间;" json:"updated_at"`
	DeleteAt         *time.Time `gorm:"column:delete_at;type:datetime;comment:删除时间" json:"delete_at"`
	PasswordChangeAt *time.Time `gorm:"column:password_change_at;type:datetime;comment:密码最后修改时间" json:"password_change_at"`
	LoginFailedCount int        `gorm:"column:login_failed_count;type:int(11);default:0;comment:登录失败次数" json:"login_failed_count"`
	LockedUntil      *time.Time `gorm:"column:locked_until;type:datetime;comment:锁定截至时间" json:"locked_until"`
	LastLoginAt      *time.Time `gorm:"column:last_login_at;type:datetime;comment:最后登录时间" json:"last_login_at"`
	Phone            string     `gorm:"column:phone;type:varchar(20);comment:手机号" json:"phone"`
	Organization     string     `gorm:"column:organization;type:varchar(255);comment:所属机构" json:"organization"`
	Position         string     `gorm:"column:position;type:varchar(255);comment:职位" json:"position"`
	ChatLimit        int        `gorm:"column:chat_limit;type:int(11);default:0;comment:剩余对话次数" json:"chat_limit"`
}

func (User) TableName() string {
	return "users"
}

type ToolName struct {
	Id          int64  `gorm:"column:id;type:bigint(20) unsigned;primary_key;AUTO_INCREMENT;comment:主键ID" json:"id"`
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
	Id                int64      `gorm:"column:id;type:bigint(20) unsigned;primary_key;AUTO_INCREMENT;comment:主键ID" json:"id"`
	DialogueId        string     `gorm:"column:dialogue_id;type:varchar(255);comment:状态:对话id;NOT NULL" json:"dialogue_id"`
	FId               int64      `gorm:"column:f_id;type:int(11);comment:状态:父id;NOT NULL" json:"f_id"`
	ServerId          string     `gorm:"column:server_id;type:varchar(255);comment:状态:server_id;NOT NULL" json:"server_id"`
	BotRunId          string     `gorm:"column:bot_run_id;type:varchar(64);comment:Bot run_id 跨服务关联键;NULL" json:"bot_run_id"`
	UserName          string     `gorm:"column:user_name;type:varchar(255);comment:用户名;NOT NULL" json:"user_name"`
	Query             string     `gorm:"column:query;type:text;comment:问题;NOT NULL" json:"query"`
	TitleQuery        string     `gorm:"column:title_query;type:text;comment:title问题;NOT NULL" json:"title_query"`
	Answer            string     `gorm:"column:answer;type:text;comment:答案;NOT NULL" json:"answer"`
	FollowUpQuestions string     `gorm:"column:follow_up_questions;type:text;comment:提示语;NOT NULL" json:"follow_up_questions"`
	TaskId            string     `gorm:"column:task_id;type:varchar(50);comment:任务id;NOT NULL" json:"task_id"`
	TaskLog           string     `gorm:"column:task_log;type:longtext;comment:任务日志;NOT NULL" json:"task_log"`
	FileName          string     `gorm:"column:file_name;type:varchar(255);comment:文件名" json:"file_name"`
	UploadPath        string     `gorm:"column:upload_path;type:varchar(255);comment:上传路径" json:"upload_path"`
	DownloadPath      string     `gorm:"column:download_path;type:varchar(255);comment:下载路径" json:"download_path"`
	ImagePaths        string     `gorm:"column:image_paths;type:text;comment:图廊图片OBS路径(JSON数组);NULL" json:"image_paths"`
	ComputeResource   string     `gorm:"column:compute_resource;type:varchar(50);comment:资源选择" json:"compute_resource"`
	ServerFilePath    string     `gorm:"column:server_file_path;type:varchar(255);comment:server文件路径" json:"server_file_path"`
	ToolName          string     `gorm:"column:tool_name;type:varchar(30);comment:工具类型;NOT NULL" json:"tool_name"`
	Status            string     `gorm:"column:status;type:varchar(30);comment:任务状态;NOT NULL" json:"status"`
	LogStatus         string     `gorm:"column:log_status;type:varchar(30);comment:日志状态;NOT NULL" json:"log_status"`
	ReactionType      string     `gorm:"column:reaction_type;type:enum('0','1','2');default:'0';not null;comment:点赞状态" json:"reaction_type"`
	CollectType       string     `gorm:"column:collect_type;type:enum('0','1');default:'0';not null;comment:收藏状态" json:"collect_type"`
	CreatedAt         time.Time  `gorm:"column:created_at;type:datetime;comment:创建时间;" json:"created_at"`
	UpdatedAt         time.Time  `gorm:"column:updated_at;type:datetime;comment:更新时间;" json:"updated_at"`
	DeleteAt          *time.Time `gorm:"column:delete_at;type:datetime;comment:删除时间" json:"delete_at"`
}

func (m *QuestionAgentLog) TableName() string {
	return "question_agent_logs"
}

type GeneList struct {
	Id       int64  `gorm:"column:id;type:int(11) unsigned;primary_key;AUTO_INCREMENT;comment:主键ID" json:"id"`
	Title    string `gorm:"column:title;type:varchar(255);comment:标题;NOT NULL" json:"title"`
	Synopsis string `gorm:"column:synopsis;type:varchar(255);comment:简介;NOT NULL" json:"synopsis"`
	Picture  string `gorm:"column:picture;type:varchar(255);comment:图片;NOT NULL" json:"picture"`
	Content  string `gorm:"column:content;type:longtext;comment:内容;NOT NULL" json:"content"`
}

func (m *GeneList) TableName() string {
	return "gene_lists"
}

type GeneExample struct {
	Id          int64      `gorm:"column:id;type:int(11) unsigned;primary_key;AUTO_INCREMENT;comment:主键ID" json:"id"`
	FileName    string     `gorm:"column:file_name;type:varchar(255);comment:文件名;NOT NULL" json:"file_name"`
	Content     string     `gorm:"column:content;type:longtext;comment:内容;NOT NULL" json:"content"`
	SpeciesCode string     `gorm:"column:species_code;type:varchar(255);comment:物种代码;NOT NULL" json:"species_code"`
	GeneId      string     `gorm:"column:gene_id;type:varchar(255);comment:基因id;NOT NULL" json:"gene_id"`
	CreatedAt   time.Time  `gorm:"column:created_at;type:datetime;comment:创建时间;" json:"created_at"`
	UpdatedAt   time.Time  `gorm:"column:updated_at;type:datetime;comment:更新时间;" json:"updated_at"`
	DeleteAt    *time.Time `gorm:"column:delete_at;type:datetime;comment:删除时间" json:"delete_at"`
}

func (m *GeneExample) TableName() string {
	return "gene_examples"
}

type UserPermission struct {
	Id   int64  `gorm:"column:id;type:int(11) unsigned;primary_key;AUTO_INCREMENT;comment:主键ID" json:"id"`
	Name string `gorm:"column:name;type:varchar(255);comment:权限名;NOT NULL" json:"name"`
}

func (m *UserPermission) TableName() string {
	return "user_permissions"
}

type ServerToolLogs struct {
	Id             int        `gorm:"column:id;type:bigint(20) unsigned;primary_key;AUTO_INCREMENT;comment:主键ID" json:"id"`
	ServerId       string     `gorm:"column:server_id;type:varchar(255);comment:server_id;NOT NULL" json:"server_id"`
	ToolResult     string     `gorm:"column:tool_result;type:longtext;comment:工具执行结果;NOT NULL" json:"tool_result"`
	ToolName       string     `gorm:"column:tool_name;type:varchar(30);comment:工具类型;NOT NULL" json:"tool_name"`
	ServerFilePath string     `gorm:"column:server_file_path;type:varchar(255);comment:server文件路径" json:"server_file_path"`
	ServerStatus   string     `gorm:"column:server_status;type:varchar(30);comment:server状态;NOT NULL" json:"server_status"`
	SyncStatus     int        `gorm:"column:sync_status;type:int(1);comment:同步状态:0-未同步，1-已同步;NOT NULL" json:"sync_status"`
	CreatedAt      time.Time  `gorm:"column:created_at;type:datetime;comment:创建时间;" json:"created_at"`
	UpdatedAt      time.Time  `gorm:"column:updated_at;type:datetime;comment:更新时间;" json:"updated_at"`
	DeleteAt       *time.Time `gorm:"column:delete_at;type:datetime;comment:删除时间" json:"delete_at"`
}

func (m *ServerToolLogs) TableName() string {
	return "server_tool_logs"
}

type UserFeedback struct {
	Id              int        `gorm:"column:id;type:int(10) unsigned;primary_key;AUTO_INCREMENT;comment:主键ID" json:"id"`
	UserId          int        `gorm:"column:user_id;type:int(10);comment:用户id;NOT NULL" json:"user_id"`
	FeedbackType    string     `gorm:"column:feedback_type;type:varchar(255);comment:反馈类型;NOT NULL" json:"feedback_type"`
	FeedbackContent string     `gorm:"column:feedback_content;type:text;comment:反馈内容;NOT NULL" json:"feedback_content"`
	CreatedAt       time.Time  `gorm:"column:created_at;type:datetime;comment:创建时间;" json:"created_at"`
	UpdatedAt       time.Time  `gorm:"column:updated_at;type:datetime;comment:更新时间;" json:"updated_at"`
	DeleteAt        *time.Time `gorm:"column:delete_at;type:datetime;comment:删除时间" json:"delete_at"`
}

func (m *UserFeedback) TableName() string {
	return "user_feedback"
}

type UserOperationLog struct {
	Id           int64     `gorm:"column:id;type:bigint(20) unsigned;primary_key;AUTO_INCREMENT;comment:主键ID" json:"id"`
	UserId       int64     `gorm:"column:user_id;type:bigint(20);default:0;comment:用户ID(未登录为0);index" json:"user_id"`
	UserEmail    string    `gorm:"column:user_email;type:varchar(255);comment:用户邮箱;index" json:"user_email"`
	Method       string    `gorm:"column:method;type:varchar(10);comment:请求方法" json:"method"`
	Path         string    `gorm:"column:path;type:varchar(255);comment:请求路径;index" json:"path"`
	QueryParams  string    `gorm:"column:query_params;type:text;comment:URL参数" json:"query_params"`
	BodyParams   string    `gorm:"column:body_params;type:longtext;comment:请求体(已脱敏)" json:"body_params"`
	ClientIp     string    `gorm:"column:client_ip;type:varchar(50);comment:客户端IP" json:"client_ip"`
	UserAgent    string    `gorm:"column:user_agent;type:varchar(500);comment:用户代理" json:"user_agent"`
	StatusCode   int       `gorm:"column:status_code;type:int(11);comment:HTTP状态码" json:"status_code"`
	Latency      int64     `gorm:"column:latency;type:bigint(20);comment:耗时(毫秒)" json:"latency"`
	ErrorMessage string    `gorm:"column:error_message;type:text;comment:错误信息" json:"error_message"`
	CreatedAt    time.Time `gorm:"column:created_at;type:datetime;comment:创建时间;index" json:"created_at"`
}

func (m *UserOperationLog) TableName() string {
	return "user_operation_logs"
}
