package model

import (
	"time"
)

type SUser struct {
	Id               int64      `json:"id"`
	Email            string     `json:"email"`
	Password         string     `json:"password"`
	Code             string     `json:"code"`
	Description      string     `json:"description"`
	FirstLoginStatus string     `gorm:"column:first_login_status;type:enum;comment:登陆状态;NOT NULL" json:"first_login_status"`
	CreatedAt        time.Time  `gorm:"column:created_at;type:datetime;comment:创建时间;" json:"created_at"` // 修改为 datetime 类型
	UpdatedAt        time.Time  `gorm:"column:updated_at;type:datetime;comment:更新时间;" json:"updated_at"` // 修改为 datetime 类型
	DeleteAt         *time.Time `gorm:"column:delete_at;type:datetime;comment:删除时间" json:"delete_at"`    // 修改为 datetime 类型，允许 NULL
	PasswordChangeAt *time.Time `gorm:"column:password_change_at;type:datetime;comment:密码最后修改时间" json:"password_change_at"`
	LoginFailedCount int        `gorm:"column:login_failed_count;type:int(11);default:0;comment:登录失败次数" json:"login_failed_count"`
	LockedUntil      *time.Time `gorm:"column:locked_until;type:datetime;comment:锁定截至时间" json:"locked_until"`
	LastLoginAt      *time.Time `gorm:"column:last_login_at;type:datetime;comment:最后登录时间" json:"last_login_at"`
	Phone            string     `gorm:"column:phone;type:varchar(20);comment:手机号" json:"phone"`
	Organization     string     `gorm:"column:organization;type:varchar(255);comment:所属机构" json:"organization"`
	Position         string     `gorm:"column:position;type:varchar(255);comment:职位" json:"position"`
	ChatLimit        int        `gorm:"column:chat_limit;type:int(11);default:0;comment:剩余对话次数" json:"chat_limit"`
}

func (SUser) TableName() string {
	return "s_user"
}

type SToolName struct {
	Id          int64  `gorm:"column:id;type:bigint(20) unsigned;primary_key;AUTO_INCREMENT;comment:主键ID" json:"id"`
	ToolName    string `json:"tool_name"`
	Description string `json:"description"`
}

func (SToolName) TableName() string {
	return "s_tool_name"
}

type SUserToolName struct {
	Id     int64  `json:"id"`
	Code   string `json:"code"`
	ToolId string `json:"tool_id"`
}

func (SUserToolName) TableName() string {
	return "s_user_tool_name"
}

// 用户问答表
type SQuestionLog struct {
	Id       int64  `gorm:"column:id;type:bigint(20) unsigned;primary_key;AUTO_INCREMENT;comment:主键ID" json:"id"`
	UserId   int64  `gorm:"column:user_id;type:bigint(20) unsigned;default:0;comment:用户ID;NOT NULL" json:"user_id"`
	Question string `gorm:"column:question;type:text;comment:问题;NOT NULL" json:"question"`
	Answer   string `gorm:"column:answer;type:text;comment:答案;NOT NULL" json:"answer"`
	Status   int    `gorm:"column:status;type:tinyint(1);default:1;comment:状态:1成功,2失败;NOT NULL" json:"status"`
}

func (m *SQuestionLog) TableName() string {
	return "s_question_log"
}

type SKooSearchQuestionLog struct {
	Id         int64      `gorm:"column:id;type:bigint(20) unsigned;primary_key;AUTO_INCREMENT;comment:主键ID" json:"id"`
	UserId     int64      `gorm:"column:user_id;type:int(10) ;comment:用户id;NOT NULL" json:"user_id"`
	Question   string     `gorm:"column:question;type:text;comment:问题;NOT NULL" json:"question"`
	ChatId     string     `gorm:"column:chat_id;type:varchar(255);comment:chat_id" json:"chat_id"` //对话id
	Answer     string     `gorm:"column:answer;type:text;comment:答案;NOT NULL" json:"answer"`
	QuestionId string     `gorm:"column:question_id;type:varchar(255);comment:问题ID;NOT NULL" json:"question_id"` //问题id
	Status     int        `gorm:"column:status;type:tinyint(1);default:1;comment:状态:1成功,2失败;NOT NULL" json:"status"`
	CreatedAt  time.Time  `gorm:"column:created_at;type:datetime;comment:创建时间;" json:"created_at"` // 修改为 datetime 类型
	UpdatedAt  time.Time  `gorm:"column:updated_at;type:datetime;comment:更新时间;" json:"updated_at"` // 修改为 datetime 类型
	DeleteAt   *time.Time `gorm:"column:delete_at;type:datetime;comment:删除时间" json:"delete_at"`    // 修改为 datetime 类型，允许 NULL
}

func (m *SKooSearchQuestionLog) TableName() string {
	return "s_koo_search_question_logs"
}

type SQuestionAgentLog struct {
	Id                int64      `gorm:"column:id;type:bigint(20) unsigned;primary_key;AUTO_INCREMENT;comment:主键ID" json:"id"`
	DialogueId        string     `gorm:"column:dialogue_id;type:varchar(255);comment:状态:对话id;NOT NULL" json:"dialogue_id"`
	FId               int64      `gorm:"column:f_id;type:int(11);comment:状态:父id;NOT NULL" json:"f_id"`
	ServerId          string     `gorm:"column:server_id;type:varchar(255);comment:状态:server_id;NOT NULL" json:"server_id"`
	UserName          string     `gorm:"column:user_name;type:varchar(255);comment:用户名;NOT NULL" json:"user_name"`
	Query             string     `gorm:"column:query;type:text;comment:问题;NOT NULL" json:"query"`
	TitleQuery        string     `gorm:"column:title_query;type:text;comment:title问题;NOT NULL" json:"title_query"`
	Answer            string     `gorm:"column:answer;type:text;comment:答案;NOT NULL" json:"answer"`
	FollowUpQuestions string     `gorm:"column:follow_up_questions;type:text;comment:提示语;NOT NULL" json:"follow_up_questions"`
	TaskId            string     `gorm:"column:task_id;type:varchar(50);comment:任务id;NOT NULL" json:"task_id"` //任务id
	TaskLog           string     `gorm:"column:task_log;type:longtext;comment:任务日志;NOT NULL" json:"task_log"`
	FileName          string     `gorm:"column:file_name;type:varchar(255);comment:文件名" json:"file_name"`
	UploadPath        string     `gorm:"column:upload_path;type:varchar(255);comment:上传路径" json:"upload_path"`
	DownloadPath      string     `gorm:"column:download_path;type:varchar(255);comment:下载路径" json:"download_path"`
	ComputeResource   string     `gorm:"column:compute_resource;type:varchar(50);comment:资源选择" json:"compute_resource"`
	ServerFilePath    string     `gorm:"column:server_file_path;type:varchar(255);comment:server文件路径" json:"server_file_path"`
	ToolName          string     `gorm:"column:tool_name;type:varchar(30);comment:工具类型;NOT NULL" json:"tool_name"`
	Status            string     `gorm:"column:status;type:varchar(30);comment:任务状态;NOT NULL" json:"status"`
	LogStatus         string     `gorm:"column:log_status;type:varchar(30);comment:日志状态;NOT NULL" json:"log_status"`
	ReactionType      string     `gorm:"column:reaction_type;type:enum;comment:点赞状态;NOT NULL" json:"reaction_type"`
	CollectType       string     `gorm:"column:collect_type;type:enum;comment:收藏状态;NOT NULL" json:"collect_type"`
	CreatedAt         time.Time  `gorm:"column:created_at;type:datetime;comment:创建时间;" json:"created_at"` // 修改为 datetime 类型
	UpdatedAt         time.Time  `gorm:"column:updated_at;type:datetime;comment:更新时间;" json:"updated_at"` // 修改为 datetime 类型
	DeleteAt          *time.Time `gorm:"column:delete_at;type:datetime;comment:删除时间" json:"delete_at"`    // 修改为 datetime 类型，允许 NULL
}

func (m *SQuestionAgentLog) TableName() string {
	return "s_question_agent_logs"
}

type SGeneList struct {
	Id       int64  `gorm:"column:id;type:int(11) unsigned;primary_key;AUTO_INCREMENT;comment:主键ID" json:"id"`
	Title    string `gorm:"column:title;type:varchar(255);comment:标题;NOT NULL" json:"title"`
	Synopsis string `gorm:"column:synopsis;type:varchar(255);comment:简介;NOT NULL" json:"synopsis"`
	Picture  string `gorm:"column:picture;type:varchar(255);comment:图片;NOT NULL" json:"picture"`
	Content  string `gorm:"column:content;type:longtext;comment:内容;NOT NULL" json:"content"`
}

func (m *SGeneList) TableName() string {
	return "s_gene_list"
}

type SGeneExample struct {
	Id          int64      `gorm:"column:id;type:int(11) unsigned;primary_key;AUTO_INCREMENT;comment:主键ID" json:"id"`
	FileName    string     `gorm:"column:file_name;type:varchar(255);comment:文件名;NOT NULL" json:"file_name"`
	Content     string     `gorm:"column:content;type:longtext;comment:内容;NOT NULL" json:"content"`
	SpeciesCode string     `gorm:"column:species_code;type:varchar(255);comment:物种代码;NOT NULL" json:"species_code"`
	GeneId      string     `gorm:"column:gene_id;type:varchar(255);comment:基因id;NOT NULL" json:"gene_id"`
	CreatedAt   time.Time  `gorm:"column:created_at;type:datetime;comment:创建时间;" json:"created_at"` // 修改为 datetime 类型
	UpdatedAt   time.Time  `gorm:"column:updated_at;type:datetime;comment:更新时间;" json:"updated_at"` // 修改为 datetime 类型
	DeleteAt    *time.Time `gorm:"column:delete_at;type:datetime;comment:删除时间" json:"delete_at"`    // 修改为 datetime 类型，允许 NULL
}

func (m *SGeneExample) TableName() string {
	return "s_gene_example"
}

type SUserPermission struct {
	Id   int64  `gorm:"column:id;type:int(11) unsigned;primary_key;AUTO_INCREMENT;comment:主键ID" json:"id"`
	Name string `gorm:"column:name;type:varchar(255);comment:权限名;NOT NULL" json:"name"`
}

func (m *SUserPermission) TableName() string {
	return "s_user_permission"
}

type SServerToolLogs struct {
	Id             int        `gorm:"column:id;type:bigint(20) unsigned;primary_key;AUTO_INCREMENT;comment:主键ID" json:"id"`
	ServerId       string     `gorm:"column:server_id;type:varchar(255);comment:server_id;NOT NULL" json:"server_id"`
	ToolResult     string     `gorm:"column:tool_result;type:longtext;comment:工具执行结果;NOT NULL" json:"tool_result"`
	ToolName       string     `gorm:"column:tool_name;type:varchar(30);comment:工具类型;NOT NULL" json:"tool_name"`
	ServerFilePath string     `gorm:"column:server_file_path;type:varchar(255);comment:server文件路径" json:"server_file_path"`
	ServerStatus   string     `gorm:"column:server_status;type:varchar(30);comment:server状态;NOT NULL" json:"server_status"`
	SyncStatus     int        `gorm:"column:sync_status;type:int(1);comment:同步状态:0-未同步，1-已同步;NOT NULL" json:"sync_status"`
	CreatedAt      time.Time  `gorm:"column:created_at;type:datetime;comment:创建时间;" json:"created_at"` // 修改为 datetime 类型
	UpdatedAt      time.Time  `gorm:"column:updated_at;type:datetime;comment:更新时间;" json:"updated_at"` // 修改为 datetime 类型
	DeleteAt       *time.Time `gorm:"column:delete_at;type:datetime;comment:删除时间" json:"delete_at"`    // 修改为 datetime 类型，允许 NULL
}

func (m *SServerToolLogs) TableName() string {
	return "s_server_tool_logs"
}

type SUserFeedback struct {
	Id              int        `gorm:"column:id;type:int(10) unsigned;primary_key;AUTO_INCREMENT;comment:主键ID" json:"id"`
	UserId          int        `gorm:"column:user_id;type:int(10);comment:用户id;NOT NULL" json:"user_id"`
	FeedbackType    string     `gorm:"column:feedback_type;type:varchar(255);comment:反馈类型;NOT NULL" json:"feedback_type"`
	FeedbackContent string     `gorm:"column:feedback_content;type:text;comment:反馈内容;NOT NULL" json:"feedback_content"`
	CreatedAt       time.Time  `gorm:"column:created_at;type:datetime;comment:创建时间;" json:"created_at"` // 修改为 datetime 类型
	UpdatedAt       time.Time  `gorm:"column:updated_at;type:datetime;comment:更新时间;" json:"updated_at"` // 修改为 datetime 类型
	DeleteAt        *time.Time `gorm:"column:delete_at;type:datetime;comment:删除时间" json:"delete_at"`    // 修改为 datetime 类型，允许 NULL
}

func (m *SUserFeedback) TableName() string {
	return "s_user_feedback"
}

type SUserOperationLog struct {
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

func (m *SUserOperationLog) TableName() string {
	return "s_user_operation_logs"
}
