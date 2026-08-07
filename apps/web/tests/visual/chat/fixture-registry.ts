/** Typed closed registry for the Chat visual fixture harness (test-only). */

export const CHAT_VISUAL_FIXTURE_KEYS = [
  "instant-empty",
  "expert-auto-empty",
  "expert-selected-empty",
  "expert-selected-populated",
  "empty",
  "empty-cases",
  "populated",
  "attachment",
  "upload-queued",
  "upload-uploading",
  "upload-paused",
  "upload-failed",
  "upload-completed",
  "uploading-detail-open",
  "mixed-ready-failed-expired",
  "ten-files-overflow",
  "incompatible-agent-blocked",
  "sending",
  "picker-open",
  "picker-search",
  "picker-selected",
  "sidebar-expanded",
  "sidebar-compact",
  "sidebar-mobile-closed",
  "sidebar-mobile-open",
  "agent-preview",
  "sidebar-compact-explore-open",
  "history-title-only",
  "history-loading",
  "history-empty",
  "history-error",
  // Phase 3B message-content states (shared fixtures → ChatMessageContent path)
  "short-generic",
  "long-generic",
  "cited",
  "deep-genome",
  "table",
  "steps",
  "image",
  "streaming",
  "interleaved-streaming",
  // Phase 3C Activity / log / progress / A2UI / transfer / parallel states
  "activity-closed",
  "activity-open",
  "log-loading",
  "log-populated",
  "log-error",
  "log-missing-task",
  "progress-fast",
  "progress-slow",
  "progress-completing",
  "transfer-real",
  "a2ui-required",
  "a2ui-lifecycle",
  "send-stop",
  "parallel-a",
  "parallel-b",
] as const;

export const AGENT_LIFECYCLE_VISUAL_FIXTURE_KEYS = [
  "agent-preparing",
  "agent-running-partial",
  "agent-succeeded-artifacts",
  "agent-succeeded-empty",
  "agent-failed",
  "agent-delivery-pending",
  "agent-delivery-ready",
  "agent-delivery-retryable",
  "agent-delivery-nonretryable",
  "review-confirm-fallback",
  "analyst-log-pending",
  "analyst-log-available",
  "deep-genome-preparing",
  "deep-genome-running-partial",
  "deep-genome-succeeded",
] as const;

export type AgentLifecycleVisualFixtureKey =
  (typeof AGENT_LIFECYCLE_VISUAL_FIXTURE_KEYS)[number];
export type ChatVisualFixtureKey =
  (typeof CHAT_VISUAL_FIXTURE_KEYS)[number] | AgentLifecycleVisualFixtureKey;

export const CHAT_VISUAL_LOCALES = ["en-US", "zh-CN"] as const;
export type ChatVisualLocale = (typeof CHAT_VISUAL_LOCALES)[number];

export const CHAT_VISUAL_THEMES = ["light", "dark"] as const;
export type ChatVisualTheme = (typeof CHAT_VISUAL_THEMES)[number];

export type ChatVisualChatState = "empty" | "populated";

export type ChatVisualHistoryState =
  "title-only" | "loading" | "empty" | "error";

export type ChatRoutingFixtureMode = "instant" | "expert";

export interface ChatRoutingFixture {
  id: string;
  mode: ChatRoutingFixtureMode;
  selectedAgent: string;
  populated: boolean;
  permissionsLoading: boolean;
  allowedTools: readonly string[];
}

/**
 * Deterministic routing snapshots for the test-only Chat visual harness.
 * They model authorization already resolved by the gateway; they do not enable
 * a production capability or change the authenticated Chat defaults.
 */
export const routingFixtures: readonly ChatRoutingFixture[] = [
  {
    id: "instant-empty",
    mode: "instant",
    selectedAgent: "",
    populated: false,
    permissionsLoading: false,
    allowedTools: ["ChatAgent", "DataAgent", "AnalystAgent"],
  },
  {
    id: "expert-auto-empty",
    mode: "expert",
    selectedAgent: "",
    populated: false,
    permissionsLoading: false,
    allowedTools: ["ChatAgent", "DataAgent", "AnalystAgent"],
  },
  {
    id: "expert-selected-empty",
    mode: "expert",
    selectedAgent: "DataAgent",
    populated: false,
    permissionsLoading: false,
    allowedTools: ["ChatAgent", "DataAgent", "AnalystAgent"],
  },
  {
    id: "expert-selected-populated",
    mode: "expert",
    selectedAgent: "AnalystAgent",
    populated: true,
    permissionsLoading: false,
    allowedTools: ["ChatAgent", "DataAgent", "AnalystAgent"],
  },
  {
    id: "incompatible-agent-blocked",
    mode: "expert",
    selectedAgent: "DeepGenomeAgent",
    populated: false,
    permissionsLoading: false,
    allowedTools: ["ChatAgent", "DeepGenomeAgent"],
  },
];

export type ChatVisualFixtureDefinition = {
  key: ChatVisualFixtureKey;
  /** Root `data-chat-state` for geometry measurement. */
  chatState: ChatVisualChatState;
  sidebarCollapsed: boolean;
  drawerOpen: boolean;
  /** Header mobile trigger — only for closed-mobile fixtures. */
  showSidebarTrigger: boolean;
  /** Force ChatSidebarNav off-canvas identity/primary semantics. */
  offCanvas: boolean;
  isSending: boolean;
  hasAttachment: boolean;
  /** Optional resumable-upload lifecycle state rendered by AttachmentChipStrip. */
  uploadStatus?: import("@/views/chat/upload/types").UploadStatus;
  /** Open the production chip detail surface after the fixture is mounted. */
  attachmentDetailOpen?: boolean;
  /** Sanitized capability snapshot for the attachment target. */
  attachmentTargetAvailable?: boolean;
  attachmentTargetBlocked?: boolean;
  selectedAgent: string;
  pickerOpen: boolean;
  pickerSearchQuery: string;
  /** Real rendered `chat-message-row` count (empty ⇒ 0, no hidden fakes). */
  messageCount: number;
  /** Test-only Agent capability preview state. */
  agentPreview?: boolean;
  /** Test-only compact Explore Agents disclosure state. */
  compactExploreOpen?: boolean;
  /** Explicit persisted-history recovery state, when applicable. */
  historyState?: ChatVisualHistoryState;
};

const uploadFixture = (
  key: ChatVisualFixtureKey,
  uploadStatus: import("@/views/chat/upload/types").UploadStatus,
  options: Pick<ChatVisualFixtureDefinition, "attachmentDetailOpen"> = {}
): ChatVisualFixtureDefinition => ({
  key,
  chatState: "empty",
  sidebarCollapsed: false,
  drawerOpen: false,
  showSidebarTrigger: false,
  offCanvas: false,
  isSending: false,
  hasAttachment: true,
  uploadStatus,
  ...options,
  selectedAgent: "",
  pickerOpen: false,
  pickerSearchQuery: "",
  messageCount: 0,
});

const multiAttachmentFixture = (
  key: ChatVisualFixtureKey,
  options: Partial<
    Pick<
      ChatVisualFixtureDefinition,
      "selectedAgent" | "attachmentTargetAvailable" | "attachmentTargetBlocked"
    >
  > = {}
): ChatVisualFixtureDefinition => ({
  key,
  chatState: "empty",
  sidebarCollapsed: false,
  drawerOpen: false,
  showSidebarTrigger: false,
  offCanvas: false,
  isSending: false,
  hasAttachment: true,
  selectedAgent: "",
  pickerOpen: false,
  pickerSearchQuery: "",
  messageCount: 0,
  ...options,
});

const agentLifecycleFixture = (
  key: AgentLifecycleVisualFixtureKey
): ChatVisualFixtureDefinition => ({
  key,
  chatState: "populated",
  sidebarCollapsed: false,
  drawerOpen: false,
  showSidebarTrigger: false,
  offCanvas: false,
  isSending: false,
  hasAttachment: false,
  selectedAgent: "",
  pickerOpen: false,
  pickerSearchQuery: "",
  messageCount: 1,
});

const DEFINITIONS: Record<ChatVisualFixtureKey, ChatVisualFixtureDefinition> = {
  "instant-empty": {
    key: "instant-empty",
    chatState: "empty",
    sidebarCollapsed: false,
    drawerOpen: false,
    showSidebarTrigger: false,
    offCanvas: false,
    isSending: false,
    hasAttachment: false,
    selectedAgent: "",
    pickerOpen: false,
    pickerSearchQuery: "",
    messageCount: 0,
  },
  "expert-auto-empty": {
    key: "expert-auto-empty",
    chatState: "empty",
    sidebarCollapsed: false,
    drawerOpen: false,
    showSidebarTrigger: false,
    offCanvas: false,
    isSending: false,
    hasAttachment: false,
    selectedAgent: "",
    pickerOpen: false,
    pickerSearchQuery: "",
    messageCount: 0,
  },
  "expert-selected-empty": {
    key: "expert-selected-empty",
    chatState: "empty",
    sidebarCollapsed: false,
    drawerOpen: false,
    showSidebarTrigger: false,
    offCanvas: false,
    isSending: false,
    hasAttachment: false,
    selectedAgent: "DataAgent",
    pickerOpen: false,
    pickerSearchQuery: "",
    messageCount: 0,
  },
  "expert-selected-populated": {
    key: "expert-selected-populated",
    chatState: "populated",
    sidebarCollapsed: false,
    drawerOpen: false,
    showSidebarTrigger: false,
    offCanvas: false,
    isSending: false,
    hasAttachment: false,
    selectedAgent: "AnalystAgent",
    pickerOpen: false,
    pickerSearchQuery: "",
    messageCount: 2,
  },
  empty: {
    key: "empty",
    chatState: "empty",
    sidebarCollapsed: false,
    drawerOpen: false,
    showSidebarTrigger: false,
    offCanvas: false,
    isSending: false,
    hasAttachment: false,
    selectedAgent: "",
    pickerOpen: false,
    pickerSearchQuery: "",
    messageCount: 0,
  },
  "empty-cases": {
    key: "empty-cases",
    chatState: "empty",
    sidebarCollapsed: false,
    drawerOpen: false,
    showSidebarTrigger: false,
    offCanvas: false,
    isSending: false,
    hasAttachment: false,
    selectedAgent: "",
    pickerOpen: false,
    pickerSearchQuery: "",
    messageCount: 0,
  },
  populated: {
    key: "populated",
    chatState: "populated",
    sidebarCollapsed: false,
    drawerOpen: false,
    showSidebarTrigger: false,
    offCanvas: false,
    isSending: false,
    hasAttachment: false,
    selectedAgent: "",
    pickerOpen: false,
    pickerSearchQuery: "",
    messageCount: 2,
  },
  attachment: {
    key: "attachment",
    chatState: "empty",
    sidebarCollapsed: false,
    drawerOpen: false,
    showSidebarTrigger: false,
    offCanvas: false,
    isSending: false,
    hasAttachment: true,
    selectedAgent: "",
    pickerOpen: false,
    pickerSearchQuery: "",
    messageCount: 0,
  },
  "upload-queued": uploadFixture("upload-queued", "queued"),
  "upload-uploading": uploadFixture("upload-uploading", "uploading"),
  "upload-paused": uploadFixture("upload-paused", "paused"),
  "upload-failed": uploadFixture("upload-failed", "failed"),
  "upload-completed": uploadFixture("upload-completed", "completed"),
  "uploading-detail-open": uploadFixture("uploading-detail-open", "uploading", {
    attachmentDetailOpen: true,
  }),
  "mixed-ready-failed-expired": multiAttachmentFixture(
    "mixed-ready-failed-expired"
  ),
  "ten-files-overflow": multiAttachmentFixture("ten-files-overflow"),
  "incompatible-agent-blocked": multiAttachmentFixture(
    "incompatible-agent-blocked",
    {
      selectedAgent: "DeepGenomeAgent",
      attachmentTargetAvailable: false,
      attachmentTargetBlocked: true,
    }
  ),
  sending: {
    key: "sending",
    chatState: "populated",
    sidebarCollapsed: false,
    drawerOpen: false,
    showSidebarTrigger: false,
    offCanvas: false,
    isSending: true,
    hasAttachment: false,
    selectedAgent: "",
    pickerOpen: false,
    pickerSearchQuery: "",
    messageCount: 2,
  },
  "picker-open": {
    key: "picker-open",
    chatState: "empty",
    sidebarCollapsed: false,
    drawerOpen: false,
    showSidebarTrigger: false,
    offCanvas: false,
    isSending: false,
    hasAttachment: false,
    selectedAgent: "",
    pickerOpen: true,
    pickerSearchQuery: "",
    messageCount: 0,
  },
  "picker-search": {
    key: "picker-search",
    chatState: "empty",
    sidebarCollapsed: false,
    drawerOpen: false,
    showSidebarTrigger: false,
    offCanvas: false,
    isSending: false,
    hasAttachment: false,
    selectedAgent: "",
    pickerOpen: true,
    pickerSearchQuery: "Knowledge",
    messageCount: 0,
  },
  "picker-selected": {
    key: "picker-selected",
    chatState: "empty",
    sidebarCollapsed: false,
    drawerOpen: false,
    showSidebarTrigger: false,
    offCanvas: false,
    isSending: false,
    hasAttachment: false,
    selectedAgent: "KnowledgeAgent",
    pickerOpen: false,
    pickerSearchQuery: "",
    messageCount: 0,
  },
  "sidebar-expanded": {
    key: "sidebar-expanded",
    chatState: "empty",
    sidebarCollapsed: false,
    drawerOpen: false,
    showSidebarTrigger: false,
    offCanvas: false,
    isSending: false,
    hasAttachment: false,
    selectedAgent: "",
    pickerOpen: false,
    pickerSearchQuery: "",
    messageCount: 0,
  },
  "sidebar-compact": {
    key: "sidebar-compact",
    chatState: "empty",
    sidebarCollapsed: true,
    drawerOpen: false,
    showSidebarTrigger: false,
    offCanvas: false,
    isSending: false,
    hasAttachment: false,
    selectedAgent: "",
    pickerOpen: false,
    pickerSearchQuery: "",
    messageCount: 0,
  },
  "sidebar-mobile-closed": {
    key: "sidebar-mobile-closed",
    chatState: "empty",
    sidebarCollapsed: false,
    drawerOpen: false,
    showSidebarTrigger: true,
    offCanvas: true,
    isSending: false,
    hasAttachment: false,
    selectedAgent: "",
    pickerOpen: false,
    pickerSearchQuery: "",
    messageCount: 0,
  },
  "sidebar-mobile-open": {
    key: "sidebar-mobile-open",
    chatState: "empty",
    sidebarCollapsed: false,
    drawerOpen: true,
    showSidebarTrigger: false,
    offCanvas: false,
    isSending: false,
    hasAttachment: false,
    selectedAgent: "",
    pickerOpen: false,
    pickerSearchQuery: "",
    messageCount: 0,
  },
  "agent-preview": {
    key: "agent-preview",
    chatState: "empty",
    sidebarCollapsed: false,
    drawerOpen: false,
    showSidebarTrigger: false,
    offCanvas: false,
    isSending: false,
    hasAttachment: false,
    selectedAgent: "",
    pickerOpen: false,
    pickerSearchQuery: "",
    messageCount: 0,
    agentPreview: true,
  },
  "sidebar-compact-explore-open": {
    key: "sidebar-compact-explore-open",
    chatState: "empty",
    sidebarCollapsed: true,
    drawerOpen: false,
    showSidebarTrigger: false,
    offCanvas: false,
    isSending: false,
    hasAttachment: false,
    selectedAgent: "",
    pickerOpen: false,
    pickerSearchQuery: "",
    messageCount: 0,
    compactExploreOpen: true,
  },
  "history-title-only": {
    key: "history-title-only",
    chatState: "populated",
    sidebarCollapsed: false,
    drawerOpen: false,
    showSidebarTrigger: false,
    offCanvas: false,
    isSending: false,
    hasAttachment: false,
    selectedAgent: "",
    pickerOpen: false,
    pickerSearchQuery: "",
    messageCount: 1,
    historyState: "title-only",
  },
  "history-loading": {
    key: "history-loading",
    chatState: "empty",
    sidebarCollapsed: false,
    drawerOpen: false,
    showSidebarTrigger: false,
    offCanvas: false,
    isSending: false,
    hasAttachment: false,
    selectedAgent: "",
    pickerOpen: false,
    pickerSearchQuery: "",
    messageCount: 0,
    historyState: "loading",
  },
  "history-empty": {
    key: "history-empty",
    chatState: "empty",
    sidebarCollapsed: false,
    drawerOpen: false,
    showSidebarTrigger: false,
    offCanvas: false,
    isSending: false,
    hasAttachment: false,
    selectedAgent: "",
    pickerOpen: false,
    pickerSearchQuery: "",
    messageCount: 0,
    historyState: "empty",
  },
  "history-error": {
    key: "history-error",
    chatState: "empty",
    sidebarCollapsed: false,
    drawerOpen: false,
    showSidebarTrigger: false,
    offCanvas: false,
    isSending: false,
    hasAttachment: false,
    selectedAgent: "",
    pickerOpen: false,
    pickerSearchQuery: "",
    messageCount: 0,
    historyState: "error",
  },
  "short-generic": {
    key: "short-generic",
    chatState: "populated",
    sidebarCollapsed: false,
    drawerOpen: false,
    showSidebarTrigger: false,
    offCanvas: false,
    isSending: false,
    hasAttachment: false,
    selectedAgent: "",
    pickerOpen: false,
    pickerSearchQuery: "",
    messageCount: 2,
  },
  "long-generic": {
    key: "long-generic",
    chatState: "populated",
    sidebarCollapsed: false,
    drawerOpen: false,
    showSidebarTrigger: false,
    offCanvas: false,
    isSending: false,
    hasAttachment: false,
    selectedAgent: "",
    pickerOpen: false,
    pickerSearchQuery: "",
    messageCount: 2,
  },
  cited: {
    key: "cited",
    chatState: "populated",
    sidebarCollapsed: false,
    drawerOpen: false,
    showSidebarTrigger: false,
    offCanvas: false,
    isSending: false,
    hasAttachment: false,
    selectedAgent: "",
    pickerOpen: false,
    pickerSearchQuery: "",
    messageCount: 2,
  },
  "deep-genome": {
    key: "deep-genome",
    chatState: "populated",
    sidebarCollapsed: false,
    drawerOpen: false,
    showSidebarTrigger: false,
    offCanvas: false,
    isSending: false,
    hasAttachment: false,
    selectedAgent: "",
    pickerOpen: false,
    pickerSearchQuery: "",
    messageCount: 2,
  },
  table: {
    key: "table",
    chatState: "populated",
    sidebarCollapsed: false,
    drawerOpen: false,
    showSidebarTrigger: false,
    offCanvas: false,
    isSending: false,
    hasAttachment: false,
    selectedAgent: "",
    pickerOpen: false,
    pickerSearchQuery: "",
    messageCount: 2,
  },
  steps: {
    key: "steps",
    chatState: "populated",
    sidebarCollapsed: false,
    drawerOpen: false,
    showSidebarTrigger: false,
    offCanvas: false,
    isSending: false,
    hasAttachment: false,
    selectedAgent: "",
    pickerOpen: false,
    pickerSearchQuery: "",
    messageCount: 2,
  },
  image: {
    key: "image",
    chatState: "populated",
    sidebarCollapsed: false,
    drawerOpen: false,
    showSidebarTrigger: false,
    offCanvas: false,
    isSending: false,
    hasAttachment: false,
    selectedAgent: "",
    pickerOpen: false,
    pickerSearchQuery: "",
    messageCount: 2,
  },
  streaming: {
    key: "streaming",
    chatState: "populated",
    sidebarCollapsed: false,
    drawerOpen: false,
    showSidebarTrigger: false,
    offCanvas: false,
    isSending: false,
    hasAttachment: false,
    selectedAgent: "",
    pickerOpen: false,
    pickerSearchQuery: "",
    messageCount: 2,
  },
  "interleaved-streaming": {
    key: "interleaved-streaming",
    chatState: "populated",
    sidebarCollapsed: false,
    drawerOpen: false,
    showSidebarTrigger: false,
    offCanvas: false,
    isSending: false,
    hasAttachment: false,
    selectedAgent: "",
    pickerOpen: false,
    pickerSearchQuery: "",
    messageCount: 2,
  },
  "activity-closed": {
    key: "activity-closed",
    chatState: "populated",
    sidebarCollapsed: false,
    drawerOpen: false,
    showSidebarTrigger: false,
    offCanvas: false,
    isSending: false,
    hasAttachment: false,
    selectedAgent: "",
    pickerOpen: false,
    pickerSearchQuery: "",
    messageCount: 2,
  },
  "activity-open": {
    key: "activity-open",
    chatState: "populated",
    sidebarCollapsed: false,
    drawerOpen: false,
    showSidebarTrigger: false,
    offCanvas: false,
    isSending: false,
    hasAttachment: false,
    selectedAgent: "",
    pickerOpen: false,
    pickerSearchQuery: "",
    messageCount: 2,
  },
  "log-loading": {
    key: "log-loading",
    chatState: "populated",
    sidebarCollapsed: false,
    drawerOpen: false,
    showSidebarTrigger: false,
    offCanvas: false,
    isSending: false,
    hasAttachment: false,
    selectedAgent: "",
    pickerOpen: false,
    pickerSearchQuery: "",
    messageCount: 2,
  },
  "log-populated": {
    key: "log-populated",
    chatState: "populated",
    sidebarCollapsed: false,
    drawerOpen: false,
    showSidebarTrigger: false,
    offCanvas: false,
    isSending: false,
    hasAttachment: false,
    selectedAgent: "",
    pickerOpen: false,
    pickerSearchQuery: "",
    messageCount: 2,
  },
  "log-error": {
    key: "log-error",
    chatState: "populated",
    sidebarCollapsed: false,
    drawerOpen: false,
    showSidebarTrigger: false,
    offCanvas: false,
    isSending: false,
    hasAttachment: false,
    selectedAgent: "",
    pickerOpen: false,
    pickerSearchQuery: "",
    messageCount: 2,
  },
  "log-missing-task": {
    key: "log-missing-task",
    chatState: "populated",
    sidebarCollapsed: false,
    drawerOpen: false,
    showSidebarTrigger: false,
    offCanvas: false,
    isSending: false,
    hasAttachment: false,
    selectedAgent: "",
    pickerOpen: false,
    pickerSearchQuery: "",
    messageCount: 2,
  },
  "progress-fast": {
    key: "progress-fast",
    chatState: "populated",
    sidebarCollapsed: false,
    drawerOpen: false,
    showSidebarTrigger: false,
    offCanvas: false,
    isSending: true,
    hasAttachment: false,
    selectedAgent: "",
    pickerOpen: false,
    pickerSearchQuery: "",
    messageCount: 2,
  },
  "progress-slow": {
    key: "progress-slow",
    chatState: "populated",
    sidebarCollapsed: false,
    drawerOpen: false,
    showSidebarTrigger: false,
    offCanvas: false,
    isSending: true,
    hasAttachment: false,
    selectedAgent: "",
    pickerOpen: false,
    pickerSearchQuery: "",
    messageCount: 2,
  },
  "progress-completing": {
    key: "progress-completing",
    chatState: "populated",
    sidebarCollapsed: false,
    drawerOpen: false,
    showSidebarTrigger: false,
    offCanvas: false,
    isSending: true,
    hasAttachment: false,
    selectedAgent: "",
    pickerOpen: false,
    pickerSearchQuery: "",
    messageCount: 2,
  },
  "transfer-real": {
    key: "transfer-real",
    chatState: "populated",
    sidebarCollapsed: false,
    drawerOpen: false,
    showSidebarTrigger: false,
    offCanvas: false,
    isSending: true,
    hasAttachment: true,
    selectedAgent: "",
    pickerOpen: false,
    pickerSearchQuery: "",
    messageCount: 2,
  },
  "a2ui-required": {
    key: "a2ui-required",
    chatState: "populated",
    sidebarCollapsed: false,
    drawerOpen: false,
    showSidebarTrigger: false,
    offCanvas: false,
    isSending: false,
    hasAttachment: false,
    selectedAgent: "",
    pickerOpen: false,
    pickerSearchQuery: "",
    messageCount: 2,
  },
  "a2ui-lifecycle": {
    key: "a2ui-lifecycle",
    chatState: "populated",
    sidebarCollapsed: false,
    drawerOpen: false,
    showSidebarTrigger: false,
    offCanvas: false,
    isSending: false,
    hasAttachment: false,
    selectedAgent: "",
    pickerOpen: false,
    pickerSearchQuery: "",
    messageCount: 1,
  },
  "send-stop": {
    key: "send-stop",
    chatState: "populated",
    sidebarCollapsed: false,
    drawerOpen: false,
    showSidebarTrigger: false,
    offCanvas: false,
    isSending: true,
    hasAttachment: false,
    selectedAgent: "",
    pickerOpen: false,
    pickerSearchQuery: "",
    messageCount: 2,
  },
  "parallel-a": {
    key: "parallel-a",
    chatState: "populated",
    sidebarCollapsed: false,
    drawerOpen: false,
    showSidebarTrigger: false,
    offCanvas: false,
    isSending: false,
    hasAttachment: false,
    selectedAgent: "ChatAgent",
    pickerOpen: false,
    pickerSearchQuery: "",
    messageCount: 2,
  },
  "parallel-b": {
    key: "parallel-b",
    chatState: "populated",
    sidebarCollapsed: false,
    drawerOpen: false,
    showSidebarTrigger: false,
    offCanvas: false,
    isSending: false,
    hasAttachment: false,
    selectedAgent: "KnowledgeAgent",
    pickerOpen: false,
    pickerSearchQuery: "",
    messageCount: 2,
  },
  "agent-preparing": agentLifecycleFixture("agent-preparing"),
  "agent-running-partial": agentLifecycleFixture("agent-running-partial"),
  "agent-succeeded-artifacts": agentLifecycleFixture(
    "agent-succeeded-artifacts"
  ),
  "agent-succeeded-empty": agentLifecycleFixture("agent-succeeded-empty"),
  "agent-failed": agentLifecycleFixture("agent-failed"),
  "agent-delivery-pending": agentLifecycleFixture("agent-delivery-pending"),
  "agent-delivery-ready": agentLifecycleFixture("agent-delivery-ready"),
  "agent-delivery-retryable": agentLifecycleFixture("agent-delivery-retryable"),
  "agent-delivery-nonretryable": agentLifecycleFixture(
    "agent-delivery-nonretryable"
  ),
  "review-confirm-fallback": agentLifecycleFixture("review-confirm-fallback"),
  "analyst-log-pending": agentLifecycleFixture("analyst-log-pending"),
  "analyst-log-available": agentLifecycleFixture("analyst-log-available"),
  "deep-genome-preparing": agentLifecycleFixture("deep-genome-preparing"),
  "deep-genome-running-partial": agentLifecycleFixture(
    "deep-genome-running-partial"
  ),
  "deep-genome-succeeded": agentLifecycleFixture("deep-genome-succeeded"),
};

export type ResolveChatVisualFixtureOk = {
  ok: true;
  key: ChatVisualFixtureKey;
  locale: ChatVisualLocale;
  theme: ChatVisualTheme;
  fixture: ChatVisualFixtureDefinition;
};

export type ResolveChatVisualFixtureErr = {
  ok: false;
  error: string;
};

export type ResolveChatVisualFixtureResult =
  ResolveChatVisualFixtureOk | ResolveChatVisualFixtureErr;

export function isChatVisualFixtureKey(
  value: string | null | undefined
): value is ChatVisualFixtureKey {
  return (
    typeof value === "string" &&
    (
      [
        ...CHAT_VISUAL_FIXTURE_KEYS,
        ...AGENT_LIFECYCLE_VISUAL_FIXTURE_KEYS,
      ] as readonly string[]
    ).includes(value)
  );
}

export function isAgentLifecycleVisualFixtureKey(
  value: string | null | undefined
): value is AgentLifecycleVisualFixtureKey {
  return (
    typeof value === "string" &&
    (AGENT_LIFECYCLE_VISUAL_FIXTURE_KEYS as readonly string[]).includes(value)
  );
}

export function isA2uiLifecycleFixtureKey(
  value: string | null | undefined
): value is "a2ui-lifecycle" {
  return value === "a2ui-lifecycle";
}

export function isChatVisualLocale(
  value: string | null | undefined
): value is ChatVisualLocale {
  return (
    typeof value === "string" &&
    (CHAT_VISUAL_LOCALES as readonly string[]).includes(value)
  );
}

export function isChatVisualTheme(
  value: string | null | undefined
): value is ChatVisualTheme {
  return (
    typeof value === "string" &&
    (CHAT_VISUAL_THEMES as readonly string[]).includes(value)
  );
}

/**
 * Resolve query dimensions. Unknown state/locale/theme is an explicit error —
 * never silently default.
 */
export function resolveChatVisualFixture(
  state: string | null | undefined,
  locale: string | null | undefined,
  theme: string | null | undefined
): ResolveChatVisualFixtureResult {
  if (!isChatVisualFixtureKey(state)) {
    return {
      ok: false,
      error: `Unknown fixture state "${String(state)}". Expected one of: ${[
        ...CHAT_VISUAL_FIXTURE_KEYS,
        ...AGENT_LIFECYCLE_VISUAL_FIXTURE_KEYS,
      ].join(", ")}.`,
    };
  }
  if (!isChatVisualLocale(locale)) {
    return {
      ok: false,
      error: `Unknown locale "${String(locale)}". Expected en-US|zh-CN.`,
    };
  }
  if (!isChatVisualTheme(theme)) {
    return {
      ok: false,
      error: `Unknown theme "${String(theme)}". Expected light|dark.`,
    };
  }
  return {
    ok: true,
    key: state,
    locale,
    theme,
    fixture: DEFINITIONS[state],
  };
}

export function getChatVisualFixture(
  key: ChatVisualFixtureKey
): ChatVisualFixtureDefinition {
  return DEFINITIONS[key];
}

export function getChatRoutingFixture(
  id: string | null | undefined
): ChatRoutingFixture | undefined {
  return routingFixtures.find((fixture) => fixture.id === id);
}
