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
  surfaceId?: string;
  widget?: "confirm" | "form" | "choice" | string;
  props?: Record<string, unknown>;
  failed?: boolean; // set on RunError — UI must not unlock after submit
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
