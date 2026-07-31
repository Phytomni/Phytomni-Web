package bot

import "encoding/json"

// ChatMessage is one turn in an OpenAI-compatible message array.
type ChatMessage struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

// ChatCompletionRequest is the body for POST /v1/chat/completions. Only
// phyto-chat honors Stream=true; other models reject it with 400. ResolveGeneID
// is honored only by phyto-brief-gene (Bot rejects it with 400 for the other
// chat models), so it stays omitempty and is set for brief_gene alone.
type ChatCompletionRequest struct {
	Model         string                  `json:"model"`
	Messages      []ChatMessage           `json:"messages"`
	Stream        bool                    `json:"stream"`
	OBSFileList   []string                `json:"obs_file_list,omitempty"`
	ResolveGeneID bool                    `json:"resolve_gene_id,omitempty"`
	DialogueID    string                  `json:"dialogue_id,omitempty"`
	Conversation  *ConversationEnvelopeV1 `json:"conversation,omitempty"`
}

// Formatted is the Phytomni-specific envelope Bot returns alongside the
// OpenAI-shaped fields. Answer/FollowUpQuestions are what the Web app renders.
type Formatted struct {
	Answer            string          `json:"answer"`
	FollowUpQuestions json.RawMessage `json:"follow_up_questions"`
	Metadata          json.RawMessage `json:"metadata"`
	References        json.RawMessage `json:"references"`
	Tabular           json.RawMessage `json:"tabular"`
	OutputDirs        json.RawMessage `json:"output_dirs"`
}

// Choice is one OpenAI-style choice. In default (non-debug) mode Bot moves the
// normalized answer into Message.Content and strips formatted.answer, so the
// chat path reads the answer from here (see ChatAnswerText).
type Choice struct {
	Index        int         `json:"index"`
	Message      ChatMessage `json:"message"`
	FinishReason string      `json:"finish_reason"`
}

// ChatCompletionResponse is the non-streaming response for a sync chat model.
type ChatCompletionResponse struct {
	ID                  string                `json:"id"`
	RunID               *string               `json:"run_id"`
	DegradedTracking    bool                  `json:"degraded_tracking,omitempty"`
	ReportRevision      *int64                `json:"report_revision,omitempty"`
	ConversationContext *ContextStageMetadata `json:"conversation_context,omitempty"`
	// Review pauses intentionally return the native agent.run envelope from
	// the chat-completions route. These fields stay optional so ordinary
	// OpenAI-shaped responses remain unchanged and callers never index choices
	// merely to discover a pause.
	Agent     string             `json:"agent,omitempty"`
	Status    string             `json:"status,omitempty"`
	Interrupt *AgentRunInterrupt `json:"interrupt,omitempty"`
	Result    AgentRunResult     `json:"result,omitempty"`
	Object    string             `json:"object"`
	Model     string             `json:"model"`
	Choices   []Choice           `json:"choices"`
	Formatted Formatted          `json:"formatted"`
}

// AgentRunRequest is the body for POST /v1/agents/{slug}/runs.
type AgentRunRequest struct {
	Arguments  map[string]interface{} `json:"arguments"`
	DialogueID string                 `json:"dialogue_id,omitempty"`
	Debug      bool                   `json:"debug,omitempty"`
}

// AgentRunResult carries either a finished formatted payload (sync agents) or
// a dedup-hit marker (analyst re-submit of an identical input fingerprint).
type AgentRunResult struct {
	Formatted      *Formatted `json:"formatted,omitempty"`
	DedupHit       bool       `json:"dedup_hit,omitempty"`
	TaskID         string     `json:"task_id,omitempty"`
	ReportRevision *int64     `json:"report_revision,omitempty"`
}

// AgentRunResponse covers both the 200 sync shape (status=succeeded) and the
// 202 remote shape (status=running, task_ids populated). ID is the native
// umbrella run identity and is a pointer because degraded/dedup responses can
// return id=null. RunID is a compatibility alias; consumers must reject a
// response when both non-null fields disagree.
type AgentRunResponse struct {
	ID                  *string               `json:"id"`
	RunID               *string               `json:"run_id"`
	DegradedTracking    bool                  `json:"degraded_tracking,omitempty"`
	ReportRevision      *int64                `json:"report_revision,omitempty"`
	ConversationContext *ContextStageMetadata `json:"conversation_context,omitempty"`
	Interrupt           *AgentRunInterrupt    `json:"interrupt,omitempty"`
	Object              string                `json:"object"`
	Agent               string                `json:"agent"`
	Status              string                `json:"status"`
	TaskIDs             []string              `json:"task_ids"`
	Result              AgentRunResult        `json:"result"`
}

// RouteQueryRequest is the body for POST /v1/query/route — Bot's MCP semantic
// router. AllowedTools preserves its caller-provided order; ForcedTool=nil
// means autonomous routing (the v1 Expert contract).
type RouteQueryRequest struct {
	UserQuery    string                  `json:"user_query"`
	History      []ChatMessage           `json:"history,omitempty"`
	OBSFileList  []string                `json:"obs_file_list,omitempty"`
	DialogueID   string                  `json:"dialogue_id,omitempty"`
	AllowedTools []string                `json:"allowed_tools,omitempty"`
	ForcedTool   *string                 `json:"forced_tool"`
	Conversation *ConversationEnvelopeV1 `json:"conversation,omitempty"`
}

// RouteQueryResponse mirrors AgentRunResponse exactly: Bot's route endpoint
// MUST return the same envelope (resolved `agent` slug + result.formatted +
// status/task_ids) so ShapeAnswer and SyncBotRuns reconcile correctly.
type RouteQueryResponse = AgentRunResponse

// RunRecord is one row from GET /v1/runs / GET /v1/runs/{id}. The top-level
// query/answer/tool_name/model/status are lifted by Bot from the result so
// the read path (answer-check) can merge them without parsing result JSON.
type RunRecord struct {
	RunID      string          `json:"run_id"`
	Agent      string          `json:"agent"`
	Origin     string          `json:"origin"`
	UserID     string          `json:"user_id"`
	Status     string          `json:"status"`
	Result     json.RawMessage `json:"result"`
	Error      string          `json:"error"`
	CreatedAt  string          `json:"created_at"`
	UpdatedAt  string          `json:"updated_at"`
	ExpiresAt  string          `json:"expires_at"`
	TaskIDs    []string        `json:"task_ids"`
	DialogueID string          `json:"dialogue_id"`
	Query      string          `json:"query"`
	ToolName   string          `json:"tool_name"`
	Model      string          `json:"model"`
	Answer     string          `json:"answer"`
}

// RunsListResponse is the GET /v1/runs envelope.
type RunsListResponse struct {
	Object string      `json:"object"`
	Data   []RunRecord `json:"data"`
}

// RunLogsResponse is the GET /v1/runs/{id}/logs envelope.
type RunLogsResponse struct {
	RunID    string                   `json:"run_id"`
	TaskIDs  []string                 `json:"task_ids"`
	TaskLogs []map[string]interface{} `json:"task_logs"`
}

// FileUploadResponse is the 201 body from POST /v1/files. Path is the
// obs://… reference Web Go feeds back into obs_file_list.
type FileUploadResponse struct {
	ID       string `json:"id"`
	Object   string `json:"object"`
	Bytes    int64  `json:"bytes"`
	Filename string `json:"filename"`
	Purpose  string `json:"purpose"`
	OBSPath  string `json:"obs_path"`
	Path     string `json:"path"`
}

// AgentDescriptor is one row of GET /v1/agents. LegacyAliases is advisory
// metadata only; Web Go maintains its own alias->slug table (see agent_map).
type AgentDescriptor struct {
	Slug          string   `json:"slug"`
	Tool          string   `json:"tool"`
	Origin        string   `json:"origin"`
	LegacyAliases []string `json:"legacy_aliases"`
}

// AgentsListResponse is the GET /v1/agents envelope.
type AgentsListResponse struct {
	Object    string            `json:"object"`
	Data      []AgentDescriptor `json:"data"`
	Protocols map[string][]int  `json:"protocols,omitempty"`
}

// BotError is the uniform error envelope every non-2xx Bot response carries.
type BotError struct {
	Error struct {
		Type      string `json:"type"`
		Code      int    `json:"code"`
		Message   string `json:"message"`
		RequestID string `json:"request_id"`
	} `json:"error"`
}
