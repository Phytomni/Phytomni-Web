package common

import "time"

// 用户结构体
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

type QuestionResquest struct {
	Content string `json:"content"`
}

// Inputs 结构体用于表示 inputs 字段的内容
type Inputs struct {
	ResearchTheme string `json:"Research_Theme"`
}

// DialogueRequestData 结构体用于匹配整个请求数据格式
type DialogueRequestData struct {
	Inputs         Inputs   `json:"inputs"`
	User           string   `json:"user"`
	Query          string   `json:"query"`
	ConversationId string   `json:"conversation_id"`
	MessageId      string   `json:"message_id"`
	Files          []string `json:"files"`
}

type KooSearchQuestionRequest struct {
	RepoID            string             `json:"repo_id"`
	ExtraRepoIDs      []string           `json:"extra_repo_ids"` //引用知识库标识列表，用于支持多个知识库联合检索的场景
	ChatID            string             `json:"chat_id"`
	KooSearchMessages []KooSearchMessage `json:"messages"`
	ChatCreateFlag    int                `json:"chat_create_flag"`
	RefreshFlag       int                `json:"refresh_flag"` //是否清空问答历史，0：不清空，1：清空
	Stream            string             `json:"stream"`
	TopP              float64            `json:"top_p"`            //top_p值越高，候选单词越多，文本多样性越高
	MaxTokens         int                `json:"max_tokens"`       //模型生成最大新词数
	ChatTemperature   float64            `json:"chat_temperature"` //取值接近0表示最低的随机性，1表示最高的随机性。一般来说，temperature越低，适合完成确定性的任务
	SearchTemperature float64            `json:"search_temperature"`
	PresencePenalty   float64            `json:"presence_penalty"` //presence_penalty越小，模型考虑之前生成的Token越少，可能导致文本中出现重复内容。presence_penalty越大，模型会更倾向于生成新的、未出现过的Token，生成的文本会更加多样化
}

type KooSearchMessage struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

type KooSearchSearchRequest struct {
	RepoID       string   `json:"repo_id" binding:"required"`
	Content      string   `json:"content"`
	PageNum      int      `json:"page_num"`       //请求页码
	PageSize     int      `json:"page_size"`      //请求限定响应结果的分页大小，例如5条/页，10条/页。
	Scope        string   `json:"scope"`          //确定搜索范围，目前支持三个配置。取值范围：doc：文档知识，使用query2doc模型。faq：FAQ，常见问答集，使用query2query模型。web：网络来源，来自于web搜索引擎。
	ExtraRepoIds []string `json:"extra_repo_ids"` //引用知识库标识列表，用于支持多个知识库联合检索的场景。
}

type QueryListRequest struct {
	Id         int64     `json:"id"`
	DialogueId string    `json:"dialogue_id"`
	TitleQuery string    `json:"title_query"`
	CreatedAt  time.Time `json:"created_at"`
}
