import type { A2uiActionTransport } from "./streaming/a2uiAction";
import type { BotInteropPayload, BotRunProjection } from "./botProjection";
import type { BotLifecycleState } from "./streaming/botLifecycleReducer";
import type { TransferSnapshot } from "@/utils/transfer-progress";
import type {
  AgentStep,
  ChatContent,
  CitationDocument,
  StreamContentBlock,
} from "./messageTypes";

export type {
  AgentStep,
  ChatContent,
  CitationDocument,
  AgentSurfaceContentBlock,
  MarkdownContentBlock,
  ReasoningContentBlock,
  StepContentBlock,
  StreamContentBlock,
  ToolContentBlock,
} from "./messageTypes";

export interface Chat {
  id: number;
  dialogue_id: string;
  title: string;
  date: string;
  messages?: ChatMessage[];
  original?: string;
  tool_name?: string;
  isSending?: boolean; // per-conversation sending state
  messageInput?: string; // per-conversation input content
  fileList?: UploadFile[]; // per-conversation file list
  isFavorite: boolean; // favorite state
  isPending?: boolean; // local first turn remains selectable until reconciliation
}

/**
 * Live rendered chat view for one dialogue: partial Chat metadata plus a
 * concrete messages array (streaming placeholders, blocks, A2UI surfaces).
 */
export type ChatView = Partial<Chat> & {
  messages: ChatMessage[];
};

/**
 * Runtime-only identity and uplink owned by one streamed assistant message.
 * It is intentionally not dialogue UI state: an older streamed row must keep
 * its own run while a later row starts in the same conversation.
 */
export interface A2uiRuntimeContext {
  dialogueId: string;
  messageId: string;
  runId: string;
  transport: A2uiActionTransport;
}

export type ArtifactKind = "deep-genome" | "research" | "cited-report" | null;

export type ArtifactTab = "content" | "evidence" | "activity" | "downloads";

export interface ChatMessage {
  role: string;
  content: ChatContent;
  id?: string;
  steps?: readonly AgentStep[];
  doc_list?: readonly CitationDocument[];
  tableHeaders?: Array<{
    prop: string;
    label: string;
  }>;
  instantMessage?: boolean;
  status?: string;
  upload_path?: string;
  download_path?: string; // download path
  original?: string;
  tool_name?: string;
  followUpQuestions?: string[]; // follow-up questions list
  showFollowUpQuestions?: boolean; // whether to show follow-up questions
  showLog?: boolean;
  attachedFiles?: readonly ChatAttachment[]; // attached file metadata
  compute_resource?: string; // compute resource info
  task_id?: string; // task ID
  server_file_path?: string; // server file path
  streaming?: boolean; // true while AG-UI stream is in flight (renderer shows cursor)
  blocks?: StreamContentBlock[]; // typed content blocks (streaming path); content stays for the axios path
  /**
   * Runtime-only UI identity for Activity disclosure while a stream placeholder
   * has no server `id`. Stamped from the send request key; never written to
   * FormData, reactions, Artifact eligibility, or A2UI run identity.
   */
  streamPresentationKey?: string;
  /** Runtime-only A2UI context sourced exclusively from stream response headers. */
  a2uiRuntime?: A2uiRuntimeContext;
  /** Sanitized Bot lifecycle snapshot; raw API envelopes never enter message state. */
  botProjection?: BotRunProjection;
  /** Monotonic report state derived from the sanitized Bot projection. */
  botLifecycle?: BotLifecycleState;
}

/** Backward-compatible name for the bounded stream-block union. */
export type ContentBlock = StreamContentBlock;

export interface ChatResponse {
  query: string;
  answer: string;
  id?: string;
  task_id?: string;
  tool_name?: string;
  status?: string;
  upload_path?: string;
  download_path?: string; // download path
  steps?: readonly AgentStep[];
  reaction_type?: string; // reaction (like/dislike) state field
  compute_resource?: string; // compute resource info
  follow_up_questions?: string | string[]; // follow-up questions list
  server_file_path?: string; // server file path
  /** Bot umbrella identity; never substitute the Web row id or a task id. */
  bot_run_id?: string | null;
  /** True when a successful response cannot be polled by Bot run id. */
  tracking_degraded?: boolean;
  /** Safe Web-owned interop outcome; raw Bot metadata is never retained. */
  degraded_interop?: boolean;
  interop?: BotInteropPayload | null;
  report_revision?: number;
  request_id?: string | null;
  /** Bounded input-required surface from the Web Go gateway. */
  a2ui?: unknown;
}

export type ChatHistoryHydrationStatus =
  "new" | "loading" | "ready" | "history-empty" | "error";

export type ChatHistoryErrorKind = "request" | "decode";

export interface UploadFile {
  name: string;
  size: number;
  type: string;
  file: File;
}

/** Persisted history attachment metadata has no live browser File object. */
export interface HistoricalUploadFile {
  name: string;
  size: number;
  type: string;
  file: null;
}

export type ChatAttachment = UploadFile | HistoricalUploadFile;

export interface ChatComposerHandle {
  openHeader: () => void;
  closeHeader: () => void;
  readonly popoverVisible: boolean | undefined;
}

/**
 * Per-dialogue UI + rendered-message owner. Shell focus (currentChatId, URL,
 * scroll) is separate; only `renderedChat` owns the live message tree.
 */
export interface ChatUIState {
  isSending: boolean;
  messageInput: string;
  fileList: UploadFile[];
  historyQuestion: readonly ChatMessage[] | null;
  /** Lifecycle of this dialogue's persisted-history reconstruction. */
  historyHydration: ChatHistoryHydrationStatus;
  /** Bounded reason for a recoverable history hydration failure. */
  historyErrorKind: ChatHistoryErrorKind | null;
  copyVisible: number;
  copyTimeRef: ReturnType<typeof setTimeout> | undefined;
  logData: Record<string, unknown>;
  loadingLog: Record<string, boolean>;
  refreshingMessages: Record<string, boolean>;
  reactions: Record<string, number>;
  updatingLog: Record<string, boolean>;
  /** Stable enum for analyst-log errors; translate at render time. */
  logErrorKinds: Record<string, "fetch" | "update" | undefined>;
  sendStartedAt: number | null;
  activeAgentName: string;
  completing: boolean;
  mode: "instant" | "expert";
  isStreaming: boolean;
  streamingMessageId: string | null;
  uploadTransfer: TransferSnapshot | null;
  selectedAgent: string;
  /** Live message tree for this dialogue; default null until hydrated. */
  renderedChat: ChatView | null;
  /** Runtime-only active send/stream request key; empty when idle. */
  activeRequestId: string;
  /** True after Stop aborted the dialogue's in-flight request. */
  generationStopped: boolean;
  /**
   * Per-message Activity disclosure map keyed by
   * `stream:<messageKey>:activity-<startIndex>`. Owned by chatStates so A→B→A
   * restores open/closed without leaking across dialogues.
   */
  activityExpandedByMessage: Record<string, boolean>;
  artifactOpen: boolean;
  activeArtifactMessageId: string | null;
  artifactTab: ArtifactTab;
  /** Runtime-only server IDs already considered for automatic artifact opening. */
  autoOpenedArtifactMessageIds: string[];
}

/** Atomic chatStates key move — neither record mutates on target-collision. */
export type RekeyChatStateOutcome =
  | { outcome: "moved" }
  | { outcome: "same-id" }
  | { outcome: "source-absent" }
  | { outcome: "target-collision" };

/** Coordinator result for a temporary → server dialogue reconciliation attempt. */
export type DialogueReconciliationResult =
  | {
      status: "reconciled";
      tempId: string;
      serverId: string;
      rekey: RekeyChatStateOutcome;
    }
  | {
      status: "retained";
      tempId: string;
      reason: "no-match" | "ambiguous" | "collision" | "unmatched";
    };
