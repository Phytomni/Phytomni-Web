import type { A2uiActionTransport } from "./streaming/a2uiAction";
import type { A2uiSurfaceRuntime } from "./streaming/a2uiContract";
import type { TransferSnapshot } from "@/utils/transfer-progress";

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
  content: any;
  id?: string;
  steps?: any[];
  doc_list?: any[];
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
  attachedFiles?: UploadFile[]; // attached files list
  compute_resource?: string; // compute resource info
  task_id?: string; // task ID
  server_file_path?: string; // server file path
  streaming?: boolean; // true while AG-UI stream is in flight (renderer shows cursor)
  blocks?: ContentBlock[]; // typed content blocks (streaming path); content stays for the axios path
  /**
   * Runtime-only UI identity for Activity disclosure while a stream placeholder
   * has no server `id`. Stamped from the send request key; never written to
   * FormData, reactions, Artifact eligibility, or A2UI run identity.
   */
  streamPresentationKey?: string;
  /** Runtime-only A2UI context sourced exclusively from stream response headers. */
  a2uiRuntime?: A2uiRuntimeContext;
}

// ContentBlock is one typed unit in a streaming assistant message. authority
// marks who composed it ("web" = Web renders structured data; "agent" =
// agent-surface blocks). interactive flags user-interactive blocks.
// The registry (blockRegistry.ts) maps `type` to a Vue renderer.
export interface ContentBlock {
  type: "markdown" | "tool" | "step" | "reasoning" | "agent-surface" | string;
  authority: "web" | "agent";
  interactive?: boolean;
  text?: string; // markdown/reasoning accumulated text
  toolName?: string; // tool block: structured tool identifier (Web maps to copy)
  label?: string; // step block: structured step identifier
  count?: number; // tool_result hit count
  // agent-surface (phyto.a2ui):
  a2ui?: A2uiSurfaceRuntime;
  sourceActionId?: string;
}

export interface ChatResponse {
  query: string;
  answer: string;
  id?: string;
  task_id?: string;
  tool_name?: string;
  status?: string;
  upload_path?: string;
  download_path?: string; // download path
  steps?: any[];
  reaction_type?: string; // reaction (like/dislike) state field
  compute_resource?: string; // compute resource info
  follow_up_questions?: string | string[]; // follow-up questions list
  server_file_path?: string; // server file path
}

export interface UploadFile {
  name: string;
  size: number;
  type: string;
  file: File;
}

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
  historyQuestion: any;
  copyVisible: number;
  copyTimeRef: ReturnType<typeof setTimeout> | undefined;
  logData: Record<string, any>;
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
