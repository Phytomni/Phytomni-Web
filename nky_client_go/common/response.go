package common

import (
	"nky_client_go/model"
	"time"
)

type ChineseBookResponse struct {
	Page  int `json:"page"`
	Total int `json:"total"`
}

type UserInfo struct {
	UserName string `json:"user_name"`
}

type FreshTokenResponse struct {
	AccessToken string `json:"access_token"`
	ExpiresIn   int    `json:"expires_in"`
}

type UserResponse struct {
	Id               int64  `gorm:"column:id;type:bigint(20) unsigned;primary_key;AUTO_INCREMENT;comment:主键ID" json:"id"`
	Email            string `json:"email"`
	Password         string `json:"password"`
	FirstLoginStatus string `json:"first_login_status"`
}

type QuestionListResponse struct {
	Page  int            `json:"page"`
	Total int64          `json:"total"`
	List  []QuestionInfo `json:"list"`
}

type QuestionInfo struct {
	Id       int64  `json:"id"`
	Question string `json:"question"`
}

type QuestionInfoResponse struct {
	Info QuestionItem `json:"info"`
}
type QuestionItem struct {
	Id       int64  `json:"id"`
	Question string `json:"question"`
	Answer   string `json:"answer"`
}

type QuestionHWResponse struct {
	UserName string `json:"username"`
	Question string `json:"question"`
	Answer   string `json:"answer"`
}

// 定义文档列表项结构体
type DocItem struct {
	Content string  `json:"content"`
	Score   float64 `json:"score"`
}

type DialogueResponse struct {
	MessageId      string `json:"message_id"`      //父id
	ConversationId string `json:"conversation_id"` //对话id
	Answer         string `json:"answer"`          //回答
}

type ChatResult struct {
	//Index      int    `json:"index"`
	Message    string `json:"message"`
	QuestionID string `json:"question_id"`
}

// Reference 定义 references 数组中的单个元素结构体
type Reference struct {
	FileID string `json:"file_id"`
	//ChunkID        string  `json:"chunk_id"` //当前参考文档分片的ID
	Title    string `json:"title"`
	Subtitle string `json:"subtitle"`
	Content  string `json:"content"`
	//FilePath       string  `json:"file_path"` //文件地址
	//Category       string  `json:"category"` //当未命中配置的类型时，先使用知识库检索再进行大模型总结
	//UpdateDateTime string  `json:"update_date_time"` //更新时间
	//RepoID         string  `json:"repo_id"`
	PageNum      int     `json:"page_num"`      //请求页码
	ComponentNum int     `json:"component_num"` //当前参考分片位于文档内的第几个分 片
	Score        float64 `json:"score"`         //分片的相关度打分，分值越高代表越相关
}

// KooSearchQuestionResponse 定义根结构体，包含整个 JSON 数据的结构
type KooSearchQuestionResponse struct {
	ChatID         string      `json:"chat_id"`
	Category       string      `json:"category"`
	ChatResult     ChatResult  `json:"chat_result"`
	SubQueries     []string    `json:"sub_queries"`
	References     []Reference `json:"references"`
	Rac            interface{} `json:"rac"`
	ReferenceTotal int         `json:"reference_total"` //参考来源总个数
}

type KooSearchSearchResponse struct {
	DocList []KooSearchSearchResponseDoc `json:"doc_list"`
	Total   int                          `json:"total"`
}

type KooSearchSearchResponseDoc struct {
	FileID string `json:"file_id"`
	//ChunkID        string    `json:"chunk_id"`
	Title    string `json:"title"`
	Subtitle string `json:"subtitle"`
	Content  string `json:"content"`
	//FilePath       string    `json:"file_path"`
	//Category       string    `json:"category"`
	//UpdateDateTime time.Time `json:"update_date_time"`
	//RepoID         string    `json:"repo_id"`
	PageNum      int     `json:"page_num"`
	ComponentNum int     `json:"component_num"`
	Score        float64 `json:"score"`
	//FileName     string  `json:"fileName"`
	//IndexID string `json:"indexId"`
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
	Id          int64  `json:"id"`
	Email       string `json:"email"`
	Code        string `json:"code"`
	Description string `json:"description"`
}

type GeneListResponse struct {
	Total      int64                 `json:"total"`
	TotalPages int                   `json:"total_pages"`
	GeneList   []*model.SGeneExample `json:"gene_list"`
}

type ApiAsyncTaskListResponse struct {
	Id              int64      `gorm:"column:id;type:bigint(20) unsigned;primary_key;AUTO_INCREMENT;comment:主键ID" json:"id"`
	DialogueId      string     `gorm:"column:dialogue_id;type:varchar(255);comment:状态:对话id;NOT NULL" json:"dialogue_id"`
	FId             int64      `gorm:"column:f_id;type:int(11);comment:状态:父id;NOT NULL" json:"f_id"`
	ServerId        string     `gorm:"column:server_id;type:varchar(255);comment:状态:server_id;NOT NULL" json:"server_id"`
	UserName        string     `gorm:"column:user_name;type:varchar(255);comment:用户名;NOT NULL" json:"user_name"`
	Query           string     `gorm:"column:query;type:longtext;comment:问题;NOT NULL" json:"query"`
	Answer          string     `gorm:"column:answer;type:text;comment:答案;NOT NULL" json:"answer"`
	TaskId          string     `gorm:"column:task_id;type:varchar(50);comment:任务id;NOT NULL" json:"task_id"` //任务id
	TaskLog         string     `gorm:"column:task_log;type:longtext;comment:任务日志;NOT NULL" json:"task_log"`
	FileName        string     `gorm:"column:file_name;type:varchar(255);comment:文件名" json:"file_name"`
	UploadPath      string     `gorm:"column:upload_path;type:varchar(255);comment:上传路径" json:"upload_path"`
	DownloadPath    string     `gorm:"column:download_path;type:varchar(255);comment:下载路径" json:"download_path"`
	ComputeResource string     `gorm:"column:compute_resource;type:varchar(50);comment:资源选择" json:"compute_resource"`
	ServerFilePath  string     `gorm:"column:server_file_path;type:varchar(255);comment:server文件路径" json:"server_file_path"`
	ToolName        string     `gorm:"column:tool_name;type:varchar(30);comment:工具类型;NOT NULL" json:"tool_name"`
	Status          string     `gorm:"column:status;type:varchar(30);comment:任务状态;NOT NULL" json:"status"`
	LogStatus       string     `gorm:"column:log_status;type:varchar(30);comment:日志状态;NOT NULL" json:"log_status"`
	ReactionType    string     `gorm:"column:reaction_type;type:enum;comment:点赞状态;NOT NULL" json:"reaction_type"`
	CreatedAt       time.Time  `gorm:"column:created_at;type:datetime;comment:创建时间;" json:"created_at"` // 修改为 datetime 类型
	UpdatedAt       time.Time  `gorm:"column:updated_at;type:datetime;comment:更新时间;" json:"updated_at"` // 修改为 datetime 类型
	DeleteAt        *time.Time `gorm:"column:delete_at;type:datetime;comment:删除时间" json:"delete_at"`    // 修改为 datetime 类型，允许 NULL
	FDialogueId     string     `gorm:"-" json:"f_dialogue_id"`                                          // 不映射到数据库
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
