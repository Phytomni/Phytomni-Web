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
	BotProjectionJSON string     `gorm:"column:bot_projection_json;type:longtext;comment:sanitized Bot run projection;NULL" json:"-"`
	BotReportRevision int64      `gorm:"column:bot_report_revision;type:bigint;default:-1;comment:last Bot report revision" json:"-"`
	UserName          string     `gorm:"column:user_name;type:varchar(255);comment:user name;NOT NULL" json:"user_name"`
	Query             string     `gorm:"column:query;type:mediumtext;comment:question;NOT NULL" json:"query"`
	TitleQuery        string     `gorm:"column:title_query;type:text;comment:title question;NOT NULL" json:"title_query"`
	Answer            string     `gorm:"column:answer;type:mediumtext;comment:answer;NOT NULL" json:"answer"`
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
	Mode              string     `gorm:"column:mode;type:varchar(20);default:'instant';NOT NULL" json:"mode"`
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

// QuestionAgentExecutionAdmission is the early owner/correlation anchor for a
// blocking turn. Canonical message and Bot run identities are nullable until
// the synchronous dispatch has allocated and returned them.
type QuestionAgentExecutionAdmission struct {
	UserName             string     `gorm:"column:user_name;type:varchar(255);primaryKey;index:idx_execution_admission_run,priority:1" json:"-"`
	ExecutionID          string     `gorm:"column:execution_id;type:varchar(128);primaryKey" json:"execution_id"`
	RequestFingerprint   string     `gorm:"column:request_fingerprint;type:char(64);not null" json:"-"`
	FingerprintVersion   int        `gorm:"column:fingerprint_version;type:int;not null;default:1" json:"fingerprint_version"`
	DialogueID           *string    `gorm:"column:dialogue_id;type:varchar(255)" json:"dialogue_id,omitempty"`
	TurnID               *int64     `gorm:"column:turn_id;type:bigint;index:idx_execution_admission_turn" json:"turn_id,omitempty"`
	MessageID            *int64     `gorm:"column:message_id;type:bigint" json:"message_id,omitempty"`
	UserMessageID        *string    `gorm:"column:user_message_id;type:varchar(128)" json:"user_message_id,omitempty"`
	AssistantMessageID   *string    `gorm:"column:assistant_message_id;type:varchar(128)" json:"assistant_message_id,omitempty"`
	BotRunID             *string    `gorm:"column:bot_run_id;type:varchar(128);index:idx_execution_admission_run,priority:2" json:"bot_run_id,omitempty"`
	Status               string     `gorm:"column:status;type:varchar(32);not null" json:"status"`
	LatestCursor         int64      `gorm:"column:latest_cursor;type:bigint;not null;default:0" json:"latest_cursor"`
	DispatchRevision     int64      `gorm:"column:dispatch_revision;type:bigint;not null;default:0" json:"dispatch_revision"`
	ProjectionRevision   int64      `gorm:"column:projection_revision;type:bigint;not null;default:0" json:"projection_revision"`
	ContentRevision      int64      `gorm:"column:content_revision;type:bigint;not null;default:0" json:"content_revision"`
	ContentOffset        int64      `gorm:"column:content_offset;type:bigint;not null;default:0" json:"content_offset"`
	ContextRevision      int64      `gorm:"column:context_revision;type:bigint;not null;default:0" json:"context_revision"`
	TerminalStatus       *string    `gorm:"column:terminal_status;type:varchar(32)" json:"terminal_status,omitempty"`
	TerminalAt           *time.Time `gorm:"column:terminal_at;type:datetime" json:"terminal_at,omitempty"`
	LastBotContactAt     *time.Time `gorm:"column:last_bot_contact_at;type:datetime" json:"last_bot_contact_at,omitempty"`
	TrackingHealth       string     `gorm:"column:tracking_health;type:varchar(32);not null;default:'pending'" json:"tracking_health"`
	ProjectionLeaseOwner *string    `gorm:"column:projection_lease_owner;type:varchar(128)" json:"-"`
	ProjectionLeaseUntil *time.Time `gorm:"column:projection_lease_until;type:datetime;index:idx_execution_projection_lease" json:"-"`
	ProjectionAttempts   int        `gorm:"column:projection_attempts;type:int;not null;default:0" json:"projection_attempts"`
	NextProjectionAt     *time.Time `gorm:"column:next_projection_at;type:datetime;index:idx_execution_projection_due" json:"-"`
	ProjectionJSON       string     `gorm:"column:projection_json;type:longtext" json:"-"`
	CreatedAt            time.Time  `gorm:"column:created_at;type:datetime;not null" json:"created_at"`
	UpdatedAt            time.Time  `gorm:"column:updated_at;type:datetime;not null;index:idx_execution_admission_updated" json:"updated_at"`
}

func (QuestionAgentExecutionAdmission) TableName() string {
	return "question_agent_execution_admissions"
}

// ConversationTurnV2 is the canonical owner-scoped conversation turn
// metadata for V2 admissions. Visible content belongs to
// ConversationMessageV2 and execution facts belong to the Bot journal and
// QuestionAgentExecutionAdmission; this row exists only for stable numeric
// threading ids and Web-owned conversation metadata. New V2 executions must
// not synthesize a QuestionAgentLog compatibility row.
type ConversationTurnV2 struct {
	ID           int64      `gorm:"column:id;type:bigint;primaryKey" json:"id"`
	UserName     string     `gorm:"column:user_name;type:varchar(255);not null;uniqueIndex:uniq_conversation_turn_owner_execution,priority:1;index:idx_conversation_turn_dialogue,priority:1" json:"-"`
	ExecutionID  string     `gorm:"column:execution_id;type:varchar(128);not null;uniqueIndex:uniq_conversation_turn_owner_execution,priority:2" json:"execution_id"`
	DialogueID   string     `gorm:"column:dialogue_id;type:varchar(255);not null;index:idx_conversation_turn_dialogue,priority:2" json:"dialogue_id"`
	ParentID     int64      `gorm:"column:parent_id;type:bigint;not null;default:0;index:idx_conversation_turn_parent" json:"parent_id"`
	Operation    string     `gorm:"column:operation;type:varchar(16);not null" json:"operation"`
	Query        string     `gorm:"column:query;type:mediumtext;not null" json:"query"`
	TitleQuery   string     `gorm:"column:title_query;type:text;not null" json:"title_query"`
	ToolName     string     `gorm:"column:tool_name;type:varchar(64);not null" json:"tool_name"`
	Mode         string     `gorm:"column:mode;type:varchar(20);not null" json:"mode"`
	Status       string     `gorm:"column:status;type:varchar(32);not null" json:"status"`
	ReactionType string     `gorm:"column:reaction_type;type:varchar(8);not null;default:'0'" json:"reaction_type"`
	CollectType  string     `gorm:"column:collect_type;type:varchar(8);not null;default:'0'" json:"collect_type"`
	ContextJSON  string     `gorm:"column:context_json;type:longtext" json:"-"`
	CreatedAt    time.Time  `gorm:"column:created_at;type:datetime;not null" json:"created_at"`
	UpdatedAt    time.Time  `gorm:"column:updated_at;type:datetime;not null;index:idx_conversation_turn_updated" json:"updated_at"`
	DeleteAt     *time.Time `gorm:"column:delete_at;type:datetime;index:idx_conversation_turn_retention" json:"-"`
}

func (ConversationTurnV2) TableName() string {
	return "conversation_turns_v2"
}

// ConversationTurnSequenceV2 owns the numeric turn-id namespace shared with
// retained legacy QuestionAgentLog ids. The allocator seeds itself from both
// stores and advances this singleton under a database transaction, so V2 ids
// remain safe for existing numeric REST contracts without writing legacy rows.
type ConversationTurnSequenceV2 struct {
	Name      string    `gorm:"column:name;type:varchar(32);primaryKey" json:"-"`
	LastID    int64     `gorm:"column:last_id;type:bigint;not null" json:"last_id"`
	UpdatedAt time.Time `gorm:"column:updated_at;type:datetime;not null" json:"updated_at"`
}

func (ConversationTurnSequenceV2) TableName() string {
	return "conversation_turn_sequences_v2"
}

// ConversationMessageV2 is Web's ordered, owner-scoped conversation read
// model. Bot remains authoritative for execution facts; the Web projector is
// the sole writer of Bot-derived assistant/tool/summary/result items. The
// legacy question_agent_logs row is retained only as a bounded compatibility
// alias while existing reactions, collections, and history consumers migrate.
type ConversationMessageV2 struct {
	MessageID       string                            `gorm:"column:message_id;type:varchar(128);primaryKey" json:"message_id"`
	UserName        string                            `gorm:"column:user_name;type:varchar(255);not null;uniqueIndex:uniq_conversation_message_owner_index,priority:1;uniqueIndex:uniq_conversation_message_source_event,priority:1;index:idx_conversation_message_execution,priority:1" json:"-"`
	DialogueID      string                            `gorm:"column:dialogue_id;type:varchar(255);not null;uniqueIndex:uniq_conversation_message_owner_index,priority:2;index:idx_conversation_message_dialogue" json:"conversation_id"`
	MessageIndex    int64                             `gorm:"column:message_index;type:bigint;not null;uniqueIndex:uniq_conversation_message_owner_index,priority:3" json:"message_index"`
	ExecutionID     string                            `gorm:"column:execution_id;type:varchar(128);not null;uniqueIndex:uniq_conversation_message_source_event,priority:2;index:idx_conversation_message_execution,priority:2" json:"execution_id"`
	TurnID          *int64                            `gorm:"column:turn_id;type:bigint;index:idx_conversation_message_turn" json:"turn_id,omitempty"`
	LegacyMessageID *int64                            `gorm:"column:legacy_message_id;type:bigint;index:idx_conversation_message_legacy" json:"legacy_message_id,omitempty"`
	SourceMessageID string                            `gorm:"column:source_message_id;type:varchar(128);not null" json:"source_message_id"`
	ParentMessageID *string                           `gorm:"column:parent_message_id;type:varchar(128)" json:"parent_message_id,omitempty"`
	MessageType     string                            `gorm:"column:message_type;type:varchar(32);not null" json:"type"`
	Role            string                            `gorm:"column:role;type:varchar(32);not null" json:"role"`
	Visibility      string                            `gorm:"column:visibility;type:varchar(32);not null;default:'user'" json:"visibility"`
	SourceEventID   *string                           `gorm:"column:source_event_id;type:varchar(128);uniqueIndex:uniq_conversation_message_source_event,priority:3" json:"source_event_id,omitempty"`
	ToolCallID      *string                           `gorm:"column:tool_call_id;type:varchar(128)" json:"tool_call_id,omitempty"`
	ContentRevision int64                             `gorm:"column:content_revision;type:bigint;not null;default:0" json:"content_revision"`
	ContentOffset   int64                             `gorm:"column:content_offset;type:bigint;not null;default:0" json:"content_offset"`
	ContentLength   int64                             `gorm:"column:content_length;type:bigint;not null;default:0" json:"content_length"`
	ContentSHA256   string                            `gorm:"column:content_sha256;type:char(64);not null;default:''" json:"content_sha256,omitempty"`
	Content         string                            `gorm:"column:content;type:mediumtext;not null" json:"content"`
	References      []ConversationCitationReferenceV2 `gorm:"column:references_json;type:longtext;serializer:json" json:"references,omitempty"`
	TargetJSON      string                            `gorm:"column:target_json;type:longtext" json:"-"`
	Status          string                            `gorm:"column:status;type:varchar(32);not null" json:"status"`
	OccurredAt      time.Time                         `gorm:"column:occurred_at;type:datetime;not null" json:"occurred_at"`
	CreatedAt       time.Time                         `gorm:"column:created_at;type:datetime;not null" json:"created_at"`
	UpdatedAt       time.Time                         `gorm:"column:updated_at;type:datetime;not null" json:"updated_at"`
	DeleteAt        *time.Time                        `gorm:"column:delete_at;type:datetime;index:idx_conversation_message_retention" json:"-"`
}

// ConversationCitationReferenceV2 is the finite bibliography persisted with
// one projected assistant message. Resolver URLs are derived by the browser
// from DOI/PMID values and are never stored in the public execution journal.
type ConversationCitationReferenceV2 struct {
	Title      string `json:"title,omitempty"`
	Authors    string `json:"au,omitempty"`
	WorkTitle  string `json:"ti,omitempty"`
	Source     string `json:"so,omitempty"`
	Volume     string `json:"vl,omitempty"`
	BeginPage  string `json:"bp,omitempty"`
	EndPage    string `json:"ep,omitempty"`
	Article    string `json:"ar,omitempty"`
	Year       string `json:"py,omitempty"`
	DOI        string `json:"di,omitempty"`
	PMID       string `json:"pm,omitempty"`
	DOIMissing *bool  `json:"doi_missing,omitempty"`
}

func (ConversationMessageV2) TableName() string {
	return "conversation_messages_v2"
}

// QuestionAgentExecutionOutbox is the durable dispatch intent created in the
// same transaction as the assistant shell and admission. Workers lease rows;
// HTTP request goroutines never call Bot for V2 executions.
type QuestionAgentExecutionOutbox struct {
	ID               int64      `gorm:"column:id;type:bigint;primaryKey;autoIncrement" json:"id"`
	UserName         string     `gorm:"column:user_name;type:varchar(255);not null;uniqueIndex:uniq_execution_outbox_owner_execution" json:"-"`
	ExecutionID      string     `gorm:"column:execution_id;type:varchar(128);not null;uniqueIndex:uniq_execution_outbox_owner_execution" json:"execution_id"`
	CommandJSON      string     `gorm:"column:command_json;type:longtext;not null" json:"-"`
	State            string     `gorm:"column:state;type:varchar(32);not null;default:'pending';index:idx_execution_outbox_due,priority:1" json:"state"`
	Attempts         int        `gorm:"column:attempts;type:int;not null;default:0" json:"attempts"`
	Revision         int64      `gorm:"column:revision;type:bigint;not null;default:0" json:"revision"`
	NextAttemptAt    time.Time  `gorm:"column:next_attempt_at;type:datetime;not null;index:idx_execution_outbox_due,priority:2" json:"next_attempt_at"`
	LeaseOwner       *string    `gorm:"column:lease_owner;type:varchar(128)" json:"-"`
	LeaseUntil       *time.Time `gorm:"column:lease_until;type:datetime;index:idx_execution_outbox_lease" json:"-"`
	Classification   *string    `gorm:"column:classification;type:varchar(16)" json:"classification,omitempty"`
	BoundaryState    *string    `gorm:"column:boundary_state;type:varchar(32)" json:"boundary_state,omitempty"`
	FirstErrorCode   *string    `gorm:"column:first_error_code;type:varchar(64)" json:"first_error_code,omitempty"`
	LastErrorCode    *string    `gorm:"column:last_error_code;type:varchar(64)" json:"last_error_code,omitempty"`
	NextReconcileAt  *time.Time `gorm:"column:next_reconcile_at;type:datetime;index:idx_execution_outbox_reconcile" json:"next_reconcile_at,omitempty"`
	LastErrorMessage *string    `gorm:"column:last_error_message;type:varchar(512)" json:"-"`
	AcknowledgedAt   *time.Time `gorm:"column:acknowledged_at;type:datetime" json:"acknowledged_at,omitempty"`
	DeadLetterAt     *time.Time `gorm:"column:dead_letter_at;type:datetime" json:"dead_letter_at,omitempty"`
	CreatedAt        time.Time  `gorm:"column:created_at;type:datetime;not null" json:"created_at"`
	UpdatedAt        time.Time  `gorm:"column:updated_at;type:datetime;not null" json:"updated_at"`
}

func (QuestionAgentExecutionOutbox) TableName() string {
	return "question_agent_execution_outbox"
}

// QuestionAgentExecutionEventV2 is the bounded Web cache of Bot-committed
// public facts. It exists for conversation history/offline UI only; Bot's
// journal remains the source of truth.
type QuestionAgentExecutionEventV2 struct {
	UserName    string    `gorm:"column:user_name;type:varchar(255);primaryKey" json:"-"`
	ExecutionID string    `gorm:"column:execution_id;type:varchar(128);primaryKey" json:"execution_id"`
	Seq         int64     `gorm:"column:seq;type:bigint;primaryKey" json:"seq"`
	EventID     string    `gorm:"column:event_id;type:varchar(128);not null;uniqueIndex:uniq_execution_event_owner_id" json:"event_id"`
	EventType   string    `gorm:"column:event_type;type:varchar(64);not null;index:idx_execution_event_type" json:"event_type"`
	EventJSON   string    `gorm:"column:event_json;type:longtext;not null" json:"-"`
	OccurredAt  time.Time `gorm:"column:occurred_at;type:datetime;not null" json:"occurred_at"`
	CreatedAt   time.Time `gorm:"column:created_at;type:datetime;not null" json:"created_at"`
}

func (QuestionAgentExecutionEventV2) TableName() string {
	return "question_agent_execution_events_v2"
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
