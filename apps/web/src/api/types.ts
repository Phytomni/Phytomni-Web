import type { AxiosRequestConfig, AxiosResponse } from "axios";

import request, { createAbortableRequest } from "@/utils/request";
import {
  isRecord,
  optionalString,
  type Decoder,
  type GatewayErrorDetail,
} from "@/api/contracts";
import type { BotInteropPayload } from "@/views/chat/botProjection";

export type ApiDetail = GatewayErrorDetail | string | null;

/** The JSON envelope emitted by the Go gateway and returned by the interceptor. */
export interface ApiEnvelope<T> {
  code: number;
  message?: string;
  msg?: string;
  data: T;
  detail?: ApiDetail;
  token?: string;
  locked?: boolean;
  request_id?: string | null;
}

export interface LoginRequest {
  email: string;
  password: string;
}

export interface LoginResponse {
  token: string;
  user_name: string;
  login_status: string;
  password_warning?: string;
  locked?: boolean;
}

export interface AuthCapabilitiesResponse {
  registration_enabled: boolean;
}

export interface BotUploadCapability {
  enabled: boolean;
  protocol: string;
  upload_origin: string;
  max_file_bytes: number;
  max_attachments: number;
}

export interface AssetAttachmentRef {
  asset_id: string;
}

export interface RegistrationRequest {
  email: string;
  password: string;
}

export interface ChangePasswordRequest {
  password: string;
  new_password: string;
}

export interface CreateUserRequest {
  email: string;
  password: string;
  code: string;
  phone?: string;
  organization?: string;
  position?: string;
  chat_limit?: number | null;
}

export interface ChangePermissionRequest {
  id: number | string;
  code: string;
  password?: string;
  phone?: string;
  organization?: string;
  position?: string;
  chat_limit?: number | null;
}

export interface UserSummary {
  id: number;
  email: string;
  code: string;
  description?: string;
  locked_until?: string | null;
  last_login_at?: string | null;
  phone?: string;
  organization?: string;
  position?: string;
  chat_limit?: number | null;
}

export interface UserListResponse {
  total: number;
  total_pages: number;
  user_list: UserSummary[];
}

export interface UserProfileResponse extends UserSummary {
  dialogue_count: number;
}

export interface UserToolResponse {
  permission: string;
  tool_list: string[];
  permission_list?: string[];
  expert_enabled?: boolean;
}

export interface QueryRequest {
  query: string;
  id?: number;
  tool?: string;
  files?: File[];
  refresh_id?: number;
  mode?: "instant" | "expert";
  interop_mode?: "off" | "auto" | "required";
  interop_targets?: string[];
}

export interface ConversationContextNotice {
  context_rebuilt?: boolean;
  context_degraded?: boolean;
}

export type ConversationArtifactKind =
  "file" | "report" | "table" | "image" | "archive";

export interface ConversationArtifactLink {
  id: string;
  name: string;
  kind: ConversationArtifactKind;
}

export interface QueryData extends ConversationContextNotice {
  /** Backend QuestionAgentLog IDs are JSON numbers; legacy adapters may use strings. */
  id?: number | string;
  final_answer?: string;
  answer?: string;
  follow_up_questions?: string | string[];
  status?: string;
  tool_name?: string;
  upload_path?: string;
  download_path?: string;
  server_file_path?: string;
  image_paths?: string | string[];
  compute_resource?: string;
  reaction_type?: string;
  dialogue_id?: string;
  task_id?: string;
  bot_run_id?: string | null;
  tracking_degraded?: boolean;
  report_revision?: number;
  request_id?: string | null;
  degraded_interop?: boolean;
  interop?: BotInteropPayload | null;
  mode?: "instant" | "expert";
  query?: string;
  steps?: unknown[];
  /** The A2UI parser owns the nested surface contract. */
  a2ui?: unknown;
  artifacts?: ConversationArtifactLink[];
}

export interface ConversationSummary {
  id: number;
  dialogue_id: string;
  title_query: string;
  created_at: string;
  title?: string;
  query?: string;
  date?: string;
}

export type ChatHistoryRecord = QueryData & {
  id: string;
  title_query?: string;
  created_at?: string;
  f_dialogue_id?: string;
};

export interface FeedbackRequest {
  feedback_type: string;
  feedback_content: string;
}

export interface FeedbackResponse {
  user_id: number;
}

export interface GeneRecord {
  id: number;
  species_code: string;
  gene_id: string;
  file_name: string;
  content?: string;
  created_at?: string;
  updated_at?: string;
}

export interface GeneReference {
  title: string;
  [key: string]: unknown;
}

export interface DecodedQueryData extends QueryData {
  id: string;
  answer: string;
  tool_name: string;
}

export interface GeneDetail extends GeneRecord {
  references?: GeneReference[];
}

export interface GeneListResponse {
  total: number;
  total_pages: number;
  gene_list: GeneRecord[];
}

export interface AsyncTaskRecord {
  id?: number;
  dialogue_id?: string;
  f_dialogue_id?: string;
  query?: string;
  status?: string;
  upload_path?: string;
  updated_at?: string;
  download_path?: string;
  task_id?: string;
  compute_resource?: string;
  server_file_path?: string;
  tool_name?: string;
}

export interface AsyncTaskListResponse {
  total: number;
  total_pages: number;
  gene_list: AsyncTaskRecord[];
}

export type MutationData = string | number | { up_id: number } | null;

export type BinaryResponse = AxiosResponse<Blob>;

function invalid(label: string): never {
  throw new TypeError(`Invalid ${label}`);
}

function hasOwn(value: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function requiredString(
  value: Record<string, unknown>,
  key: string,
  label: string
): string {
  const candidate = optionalString(value, key);
  if (candidate === undefined || candidate.length === 0) invalid(label);
  return candidate;
}

function optionalStringField(
  value: Record<string, unknown>,
  key: string,
  label: string
): string | undefined {
  if (!hasOwn(value, key) || value[key] === undefined || value[key] === null) {
    return undefined;
  }
  const candidate = optionalString(value, key);
  if (candidate === undefined) invalid(label);
  return candidate;
}

function optionalNullableStringField(
  value: Record<string, unknown>,
  key: string,
  label: string
): string | null | undefined {
  if (!hasOwn(value, key) || value[key] === undefined) return undefined;
  if (value[key] === null) return null;
  return optionalStringField(value, key, label);
}

function requiredNumber(
  value: Record<string, unknown>,
  key: string,
  label: string
): number {
  const candidate = value[key];
  if (typeof candidate !== "number" || !Number.isFinite(candidate)) {
    invalid(label);
  }
  return candidate;
}

function optionalNumberField(
  value: Record<string, unknown>,
  key: string,
  label: string
): number | undefined {
  if (!hasOwn(value, key) || value[key] === undefined || value[key] === null) {
    return undefined;
  }
  return requiredNumber(value, key, label);
}

function optionalNullableNumberField(
  value: Record<string, unknown>,
  key: string,
  label: string
): number | null | undefined {
  if (!hasOwn(value, key) || value[key] === undefined) return undefined;
  if (value[key] === null) return null;
  return requiredNumber(value, key, label);
}

function optionalBooleanField(
  value: Record<string, unknown>,
  key: string,
  label: string
): boolean | undefined {
  if (!hasOwn(value, key) || value[key] === undefined || value[key] === null) {
    return undefined;
  }
  if (typeof value[key] !== "boolean") invalid(label);
  return value[key] as boolean;
}

const MAX_CONVERSATION_ARTIFACTS = 50;
const MAX_CONVERSATION_ARTIFACT_ID_BYTES = 128;
const MAX_CONVERSATION_ARTIFACT_NAME_BYTES = 255;
const MAX_CONVERSATION_ARTIFACT_URL_BYTES = 2 << 10;
const CONVERSATION_ARTIFACT_KINDS = new Set<ConversationArtifactKind>([
  "file",
  "report",
  "table",
  "image",
  "archive",
]);
const ARTIFACT_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u;
const utf8Length = (value: string): number =>
  new TextEncoder().encode(value).length;

export function isConversationArtifactDownloadURL(
  value: unknown
): value is string {
  if (
    typeof value !== "string" ||
    utf8Length(value) > MAX_CONVERSATION_ARTIFACT_URL_BYTES ||
    !value.startsWith("/api/v1/downloads/relay-file?token=") ||
    value.includes("#")
  ) {
    return false;
  }
  const params = new URLSearchParams(value.slice(value.indexOf("?") + 1));
  const keys = [...params.keys()];
  if (
    keys.some((key) => key !== "token") ||
    params.getAll("token").length !== 1
  ) {
    return false;
  }
  const token = params.get("token");
  return (
    typeof token === "string" && token.length > 0 && !/[\s\u0000]/u.test(token)
  );
}

function decodeConversationArtifacts(
  value: unknown
): ConversationArtifactLink[] {
  if (!Array.isArray(value) || value.length > MAX_CONVERSATION_ARTIFACTS) {
    invalid("chat response");
  }
  const seen = new Set<string>();
  return value.map((item) => {
    if (!isRecord(item)) invalid("chat response");
    for (const forbiddenKey of [
      "download_url",
      "obs_path",
      "path",
      "token",
      "url",
    ]) {
      if (hasOwn(item, forbiddenKey)) invalid("chat response");
    }
    const id = requiredString(item, "id", "chat response");
    const name = requiredString(item, "name", "chat response");
    const kind = requiredString(item, "kind", "chat response");
    if (
      utf8Length(id) > MAX_CONVERSATION_ARTIFACT_ID_BYTES ||
      !ARTIFACT_ID_PATTERN.test(id) ||
      seen.has(id) ||
      utf8Length(name) > MAX_CONVERSATION_ARTIFACT_NAME_BYTES ||
      !CONVERSATION_ARTIFACT_KINDS.has(kind as ConversationArtifactKind)
    ) {
      invalid("chat response");
    }
    seen.add(id);
    return {
      id,
      name,
      kind: kind as ConversationArtifactKind,
    };
  });
}

function decodeDetail(value: unknown): ApiDetail {
  if (value === null || typeof value === "string") return value;
  if (!isRecord(value)) invalid("API response");

  const detail: GatewayErrorDetail = {};
  if (hasOwn(value, "code")) {
    detail.code = requiredNumber(value, "code", "API response");
  }
  if (hasOwn(value, "message")) {
    detail.message = requiredString(value, "message", "API response");
  }
  return detail;
}

export function decodeApiEnvelope<T>(
  value: unknown,
  decodeData: Decoder<T>
): ApiEnvelope<T> {
  if (!isRecord(value)) invalid("API response");
  const code = requiredNumber(value, "code", "API response");
  const result = { code } as ApiEnvelope<T>;

  const message = optionalStringField(value, "message", "API response");
  if (message !== undefined) result.message = message;
  const msg = optionalStringField(value, "msg", "API response");
  if (msg !== undefined) result.msg = msg;
  if (hasOwn(value, "detail")) result.detail = decodeDetail(value.detail);

  const token = optionalStringField(value, "token", "API response");
  if (token !== undefined) result.token = token;
  const locked = optionalBooleanField(value, "locked", "API response");
  if (locked !== undefined) result.locked = locked;
  if (hasOwn(value, "request_id")) {
    if (value.request_id !== null && typeof value.request_id !== "string") {
      invalid("API response");
    }
    result.request_id = value.request_id as string | null;
  }

  if (hasOwn(value, "data")) {
    result.data = decodeData(value.data);
  } else if (code === 200) {
    invalid("API response");
  }

  return result;
}

export function decodeString(value: unknown): string {
  if (typeof value !== "string") invalid("string response");
  return value;
}

export function decodeFeedbackResponse(value: unknown): FeedbackResponse {
  if (!isRecord(value)) invalid("feedback response");
  return {
    user_id: requiredNumber(value, "user_id", "feedback response"),
  };
}

function decodeMutationData(value: unknown): MutationData {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number"
  ) {
    return value;
  }
  if (
    isRecord(value) &&
    Object.keys(value).length === 1 &&
    hasOwn(value, "up_id")
  ) {
    return { up_id: requiredNumber(value, "up_id", "mutation response") };
  }
  invalid("mutation response");
}

export { decodeMutationData };

export function decodeAuthCapabilities(
  value: unknown
): AuthCapabilitiesResponse {
  if (!isRecord(value)) invalid("auth capabilities response");
  const registrationEnabled = optionalBooleanField(
    value,
    "registration_enabled",
    "auth capabilities response"
  );
  if (registrationEnabled === undefined) invalid("auth capabilities response");
  return { registration_enabled: registrationEnabled };
}

export function decodeLoginResponse(value: unknown): LoginResponse {
  if (!isRecord(value)) invalid("login response");
  const response: LoginResponse = {
    token: requiredString(value, "token", "login response"),
    user_name: requiredString(value, "user_name", "login response"),
    login_status: requiredString(value, "login_status", "login response"),
  };
  const warning = optionalStringField(
    value,
    "password_warning",
    "login response"
  );
  if (warning !== undefined) response.password_warning = warning;
  const locked = optionalBooleanField(value, "locked", "login response");
  if (locked !== undefined) response.locked = locked;
  return response;
}

function decodeUserSummary(value: unknown): UserSummary {
  if (!isRecord(value)) invalid("user list response");
  const result: UserSummary = {
    id: requiredNumber(value, "id", "user list response"),
    email: requiredString(value, "email", "user list response"),
    code: requiredString(value, "code", "user list response"),
  };
  const fields: Array<
    keyof Pick<
      UserSummary,
      | "description"
      | "locked_until"
      | "last_login_at"
      | "phone"
      | "organization"
      | "position"
    >
  > = [
    "description",
    "locked_until",
    "last_login_at",
    "phone",
    "organization",
    "position",
  ];
  fields.forEach((key) => {
    if (!hasOwn(value, key) || value[key] === null) {
      if (key === "locked_until" || key === "last_login_at") {
        result[key] = null;
      }
      return;
    }
    const field = optionalStringField(value, key, "user list response");
    if (field !== undefined) result[key] = field;
  });
  const chatLimit = optionalNullableNumberField(
    value,
    "chat_limit",
    "user list response"
  );
  if (chatLimit !== undefined) result.chat_limit = chatLimit;
  return result;
}

export function decodeUserListResponse(value: unknown): UserListResponse {
  try {
    if (!isRecord(value) || !Array.isArray(value.user_list)) {
      invalid("user list response");
    }
    return {
      total: requiredNumber(value, "total", "user list response"),
      total_pages: requiredNumber(value, "total_pages", "user list response"),
      user_list: value.user_list.map(decodeUserSummary),
    };
  } catch {
    invalid("user list response");
  }
}

export function decodeUserProfileResponse(value: unknown): UserProfileResponse {
  try {
    const summary = decodeUserSummary(value);
    if (!isRecord(value)) invalid("user profile response");
    return {
      ...summary,
      dialogue_count: requiredNumber(
        value,
        "dialogue_count",
        "user profile response"
      ),
    };
  } catch {
    invalid("user profile response");
  }
}

function decodeInterop(value: unknown): BotInteropPayload | null {
  if (value === null) return null;
  if (!isRecord(value)) invalid("chat response");
  const mode = requiredString(value, "mode", "chat response");
  const status = requiredString(value, "status", "chat response");
  if (!/[a-z_]+/u.test(mode) || !/[a-z_]+/u.test(status))
    invalid("chat response");
  const result: BotInteropPayload = {
    mode: mode as BotInteropPayload["mode"],
    status: status as BotInteropPayload["status"],
  };
  const targetId = optionalStringField(value, "target_id", "chat response");
  if (targetId !== undefined) result.target_id = targetId;
  const kind = optionalStringField(value, "kind", "chat response");
  if (kind !== undefined) result.kind = kind as BotInteropPayload["kind"];
  const code = optionalStringField(value, "code", "chat response");
  if (code !== undefined) result.code = code as BotInteropPayload["code"];
  return result;
}

export function decodeQueryData(value: unknown): DecodedQueryData {
  if (!isRecord(value)) invalid("chat response");
  const rawId = value.id;
  if (!(
    (typeof rawId === "number" && Number.isFinite(rawId)) ||
    (typeof rawId === "string" && rawId.length > 0)
  )) {
    invalid("chat response");
  }
  const id = String(rawId);
  const result: DecodedQueryData = {
    id,
    answer: "",
    tool_name: "",
  };
  const stringFields: Array<keyof QueryData> = [
    "final_answer",
    "answer",
    "status",
    "tool_name",
    "upload_path",
    "download_path",
    "server_file_path",
    "compute_resource",
    "reaction_type",
    "dialogue_id",
    "task_id",
    "query",
  ];
  const decodedFields = result as unknown as Record<string, unknown>;
  stringFields.forEach((key) => {
    const field = optionalStringField(value, key, "chat response");
    if (field !== undefined) decodedFields[key] = field;
  });
  const botRunId = optionalNullableStringField(
    value,
    "bot_run_id",
    "chat response"
  );
  if (botRunId !== undefined) result.bot_run_id = botRunId;
  if (hasOwn(value, "follow_up_questions")) {
    const followUps = value.follow_up_questions;
    if (typeof followUps === "string") {
      result.follow_up_questions = followUps;
    } else if (
      Array.isArray(followUps) &&
      followUps.every((item): item is string => typeof item === "string")
    ) {
      result.follow_up_questions = followUps;
    } else {
      invalid("chat response");
    }
  }
  if (hasOwn(value, "image_paths")) {
    const imagePaths = value.image_paths;
    if (typeof imagePaths === "string") {
      result.image_paths = imagePaths;
    } else if (
      Array.isArray(imagePaths) &&
      imagePaths.every((item): item is string => typeof item === "string")
    ) {
      result.image_paths = imagePaths;
    } else {
      invalid("chat response");
    }
  }
  if (hasOwn(value, "steps")) {
    if (!Array.isArray(value.steps)) invalid("chat response");
    result.steps = value.steps;
  }
  if (hasOwn(value, "interop")) result.interop = decodeInterop(value.interop);
  if (hasOwn(value, "a2ui")) result.a2ui = value.a2ui;
  if (hasOwn(value, "artifacts")) {
    result.artifacts = decodeConversationArtifacts(value.artifacts);
  }
  const contextNotice = decodeConversationContextNotice(value);
  if (contextNotice) {
    if (contextNotice.context_rebuilt !== undefined) {
      result.context_rebuilt = contextNotice.context_rebuilt;
    }
    if (contextNotice.context_degraded !== undefined) {
      result.context_degraded = contextNotice.context_degraded;
    }
  }
  const booleans: Array<keyof QueryData> = [
    "tracking_degraded",
    "degraded_interop",
  ];
  booleans.forEach((key) => {
    const field = optionalBooleanField(value, key, "chat response");
    if (field !== undefined) decodedFields[key] = field;
  });
  const reportRevision = optionalNumberField(
    value,
    "report_revision",
    "chat response"
  );
  if (reportRevision !== undefined) result.report_revision = reportRevision;
  if (hasOwn(value, "request_id")) {
    if (value.request_id !== null && typeof value.request_id !== "string") {
      invalid("chat response");
    }
    result.request_id = value.request_id as string | null;
  }
  const mode = optionalStringField(value, "mode", "chat response");
  if (mode !== undefined) {
    if (mode !== "instant" && mode !== "expert") invalid("chat response");
    result.mode = mode;
  }
  return result;
}

/**
 * Decode only the two public context booleans. A malformed notice is omitted
 * while the surrounding successful answer remains usable.
 */
export function decodeConversationContextNotice(
  value: unknown
): ConversationContextNotice | undefined {
  if (!isRecord(value)) return undefined;
  const keys = ["context_rebuilt", "context_degraded"] as const;
  const present = keys.filter((key) => hasOwn(value, key));
  if (present.length === 0) return undefined;
  if (present.some((key) => typeof value[key] !== "boolean")) return undefined;
  const result: ConversationContextNotice = {};
  for (const key of present) result[key] = value[key] as boolean;
  return result;
}

export function decodeChatHistory(value: unknown): ChatHistoryRecord[] {
  if (!Array.isArray(value)) invalid("chat history response");
  try {
    return value.map((item) => {
      const decoded = decodeQueryData(item);
      if (!isRecord(item)) invalid("chat history response");
      const title = optionalStringField(
        item,
        "title_query",
        "chat history response"
      );
      const created = optionalStringField(
        item,
        "created_at",
        "chat history response"
      );
      const fDialogue = optionalStringField(
        item,
        "f_dialogue_id",
        "chat history response"
      );
      return {
        ...decoded,
        ...(title === undefined ? {} : { title_query: title }),
        ...(created === undefined ? {} : { created_at: created }),
        ...(fDialogue === undefined ? {} : { f_dialogue_id: fDialogue }),
      };
    });
  } catch {
    invalid("chat history response");
  }
}

function decodeConversationSummary(value: unknown): ConversationSummary {
  if (!isRecord(value)) invalid("conversation list response");
  const id = requiredNumber(value, "id", "conversation list response");
  const dialogueId = requiredString(
    value,
    "dialogue_id",
    "conversation list response"
  );
  const title =
    optionalStringField(value, "title_query", "conversation list response") ||
    optionalStringField(value, "title", "conversation list response") ||
    optionalStringField(value, "query", "conversation list response") ||
    "";
  const createdAt =
    optionalStringField(value, "created_at", "conversation list response") ||
    optionalStringField(value, "date", "conversation list response") ||
    "";
  return {
    id,
    dialogue_id: dialogueId,
    title_query: title,
    created_at: createdAt,
    ...(optionalStringField(value, "title", "conversation list response")
      ? { title: value.title as string }
      : {}),
    ...(optionalStringField(value, "query", "conversation list response")
      ? { query: value.query as string }
      : {}),
    ...(optionalStringField(value, "date", "conversation list response")
      ? { date: value.date as string }
      : {}),
  };
}

export function decodeConversationList(value: unknown): ConversationSummary[] {
  if (!Array.isArray(value)) invalid("conversation list response");
  try {
    return value.map(decodeConversationSummary);
  } catch {
    invalid("conversation list response");
  }
}

export function decodeUserToolResponse(value: unknown): UserToolResponse {
  if (!isRecord(value)) invalid("user tool response");
  const toolList = value.tool_list;
  if (
    !Array.isArray(toolList) ||
    !toolList.every((item): item is string => typeof item === "string")
  ) {
    invalid("user tool response");
  }
  const permission = requiredString(value, "permission", "user tool response");
  const response: UserToolResponse = { permission, tool_list: toolList };
  if (hasOwn(value, "permission_list")) {
    if (
      !Array.isArray(value.permission_list) ||
      !value.permission_list.every(
        (item): item is string => typeof item === "string"
      )
    ) {
      invalid("user tool response");
    }
    response.permission_list = value.permission_list;
  }
  const expertEnabled = optionalBooleanField(
    value,
    "expert_enabled",
    "user tool response"
  );
  if (expertEnabled !== undefined) response.expert_enabled = expertEnabled;
  return response;
}

export function decodeImageData(value: unknown): string | string[] {
  if (typeof value === "string") return value;
  if (
    Array.isArray(value) &&
    value.every((item): item is string => typeof item === "string")
  ) {
    return value;
  }
  invalid("image response");
}

function decodeGeneRecord(value: unknown, label: string): GeneRecord {
  if (!isRecord(value)) invalid(label);
  const result: GeneRecord = {
    id: requiredNumber(value, "id", label),
    species_code: requiredString(value, "species_code", label),
    gene_id: requiredString(value, "gene_id", label),
    file_name: requiredString(value, "file_name", label),
  };
  const content = optionalStringField(value, "content", label);
  if (content !== undefined) result.content = content;
  const created = optionalStringField(value, "created_at", label);
  if (created !== undefined) result.created_at = created;
  const updated = optionalStringField(value, "updated_at", label);
  if (updated !== undefined) result.updated_at = updated;
  return result;
}

export function decodeGeneListResponse(value: unknown): GeneListResponse {
  if (!isRecord(value) || !Array.isArray(value.gene_list)) {
    invalid("gene list response");
  }
  try {
    return {
      total: requiredNumber(value, "total", "gene list response"),
      total_pages: requiredNumber(value, "total_pages", "gene list response"),
      gene_list: value.gene_list.map((item) =>
        decodeGeneRecord(item, "gene list response")
      ),
    };
  } catch {
    invalid("gene list response");
  }
}

export function decodeGeneDetailResponse(value: unknown): GeneDetail {
  const record = decodeGeneRecord(value, "gene detail response");
  if (!isRecord(value)) invalid("gene detail response");
  const result: GeneDetail = { ...record };
  if (hasOwn(value, "references")) {
    if (!Array.isArray(value.references)) invalid("gene detail response");
    result.references = value.references.map((reference) => {
      if (!isRecord(reference)) invalid("gene detail response");
      return {
        title: requiredString(reference, "title", "gene detail response"),
      };
    });
  }
  return result;
}

function decodeAsyncTaskRecord(value: unknown): AsyncTaskRecord {
  if (!isRecord(value)) invalid("task list response");
  const result: AsyncTaskRecord = {};
  const numericId = optionalNumberField(value, "id", "task list response");
  if (numericId !== undefined) result.id = numericId;
  const fields: Array<keyof Omit<AsyncTaskRecord, "id">> = [
    "dialogue_id",
    "f_dialogue_id",
    "query",
    "status",
    "upload_path",
    "updated_at",
    "download_path",
    "task_id",
    "compute_resource",
    "server_file_path",
    "tool_name",
  ];
  fields.forEach((key) => {
    const field = optionalStringField(value, key, "task list response");
    if (field !== undefined) result[key] = field;
  });
  return result;
}

export function decodeAsyncTaskListResponse(
  value: unknown
): AsyncTaskListResponse {
  if (!isRecord(value) || !Array.isArray(value.gene_list)) {
    invalid("task list response");
  }
  try {
    return {
      total: requiredNumber(value, "total", "task list response"),
      total_pages: requiredNumber(value, "total_pages", "task list response"),
      gene_list: value.gene_list.map(decodeAsyncTaskRecord),
    };
  } catch {
    invalid("task list response");
  }
}

export function requestApi<T, D = unknown>(
  config: AxiosRequestConfig<D>,
  decodeData: Decoder<T>
): Promise<ApiEnvelope<T>> {
  const response = request<ApiEnvelope<T>, D>(config);
  return response.then((value) => decodeApiEnvelope(value, decodeData));
}

export function requestAbortableApi<T, D = unknown>(
  config: AxiosRequestConfig<D> & { requestId?: string },
  decodeData: Decoder<T>
): Promise<ApiEnvelope<T>> {
  const response = createAbortableRequest<ApiEnvelope<T>, D>(config);
  return response.then((value) => decodeApiEnvelope(value, decodeData));
}
