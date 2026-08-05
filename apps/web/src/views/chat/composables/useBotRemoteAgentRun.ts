import { ref, type Ref } from "vue";
import { runAgentProductAbortable } from "@/api/chat";
import { isSuccessfulDataEnvelope } from "@/api/contracts";
import { abortRequest } from "@/utils/request";
import type { AssetAttachmentRef, ConversationArtifactLink } from "@/api/types";
import type { TransferSnapshot } from "@/utils/transfer-progress";
import {
  REMOTE_AGENT_PRODUCT_REGISTRY,
  type RemoteAgentTool,
} from "@/constants/agents";
import type { BotCapability } from "./useBotCapabilities";
import { useBotCapabilities } from "./useBotCapabilities";
import { parseBotProjection, type BotRunProjection } from "../botProjection";
import {
  cloneBotInterop,
  initBotLifecycleState,
  reduceBotFailure,
  reduceBotProjection,
  type BotLifecycleState,
} from "../streaming/botLifecycleReducer";
import { isSafeAssetId } from "../utils/asset-attachments";
import {
  DatasetDescriptionError,
  normalizeDatasetDescription,
} from "../utils/dataset-description";

export type RemoteAgentRunPhase =
  | "idle"
  | "submitting"
  | "running"
  | "input_required"
  | "succeeded"
  | "failed"
  | "cancelled";

export type RemoteAgentResolver = {
  geneId?: string;
  gene_id?: string;
  toId?: string;
  to_id?: string;
  speciesCode?: string;
  species_code?: string;
};

export type RemoteAgentSubmitInput = {
  query: string;
  attachments?: readonly AssetAttachmentRef[];
  datasetDescription?: string;
  resolver?: RemoteAgentResolver;
  interopMode?: "off" | "auto" | "required";
  interopTargets?: string[];
};

export interface RemoteAgentChatState {
  isSending?: boolean;
  /** Upload progress is owned by the resumable queue, not this runner. */
  uploadTransfer?: TransferSnapshot | null;
  activeRequestId?: string;
  generationStopped?: boolean;
  activeAgentName?: string;
  botProjection?: BotRunProjection;
  botLifecycle?: BotLifecycleState;
  artifactLinks?: ConversationArtifactLink[];
  dialogueId?: string;
  messageId?: string;
}

type RefLike<T> = { readonly value: T };

export type RemoteAgentCapabilitySource =
  | {
      byTool:
        | RefLike<Record<string, Partial<BotCapability> | undefined>>
        | Record<string, Partial<BotCapability> | undefined>;
      load?: (force?: boolean) => Promise<unknown>;
    }
  | RefLike<unknown>
  | Record<string, Partial<BotCapability> | undefined>;

export type BotRemoteAgentRunErrorCode =
  | "unknown_agent"
  | "capability_disabled"
  | "attachments_disabled"
  | "artifacts_disabled"
  | "resolver_disabled"
  | "invalid_dialogue"
  | "invalid_query"
  | "invalid_dataset_description"
  | "run_in_progress";

export class BotRemoteAgentRunError extends Error {
  readonly code: BotRemoteAgentRunErrorCode;

  constructor(code: BotRemoteAgentRunErrorCode, message: string) {
    super(message);
    this.name = "BotRemoteAgentRunError";
    this.code = code;
  }
}

export interface BotRemoteAgentRunState extends BotLifecycleState {
  phase: RemoteAgentRunPhase;
  requestId: string | null;
  /** Upload progress is owned by the resumable queue, not this runner. */
  uploadTransfer: TransferSnapshot | null;
  projection: BotRunProjection | null;
  artifactLinks: ConversationArtifactLink[];
  dialogueId: string | null;
  messageId: string | null;
  error:
    BotRemoteAgentRunErrorCode | "request_failed" | "projection_invalid" | null;
}

export type UseBotRemoteAgentRunOptions = {
  tool: RemoteAgentTool;
  dialogueId: string;
  getChatState?: (dialogueId: string) => RemoteAgentChatState;
  capabilities?: RemoteAgentCapabilitySource;
};

export type RemoteAgentRunIdentity = {
  dialogueId: string | null;
  messageId: string | null;
  artifactLinks?: readonly ConversationArtifactLink[];
};

let requestSequence = 0;
const localChatStates = new Map<string, RemoteAgentChatState>();
const SAFE_DIALOGUE_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/u;

type RemoteRequestToken = {
  id: string;
  cancelled: boolean;
};

function localStateFor(dialogueId: string): RemoteAgentChatState {
  const existing = localChatStates.get(dialogueId);
  if (existing) return existing;
  const created: RemoteAgentChatState = {
    isSending: false,
    uploadTransfer: null,
    activeRequestId: "",
    generationStopped: false,
  };
  localChatStates.set(dialogueId, created);
  return created;
}

function isRefLike(value: unknown): value is RefLike<unknown> {
  return typeof value === "object" && value !== null && "value" in value;
}

function capabilityFor(
  source: RemoteAgentCapabilitySource,
  tool: RemoteAgentTool
): Partial<BotCapability> | undefined {
  const unwrappedSource = isRefLike(source) ? source.value : source;
  const raw =
    unwrappedSource &&
    typeof unwrappedSource === "object" &&
    "byTool" in unwrappedSource
      ? (unwrappedSource as { byTool: unknown }).byTool
      : unwrappedSource &&
          typeof unwrappedSource === "object" &&
          "capabilities" in unwrappedSource
        ? (unwrappedSource as { capabilities: unknown }).capabilities
        : unwrappedSource;
  const byTool = isRefLike(raw) ? raw.value : raw;
  if (Array.isArray(byTool)) {
    return byTool.find(
      (candidate) =>
        candidate &&
        typeof candidate === "object" &&
        (candidate as { tool?: unknown }).tool === tool
    ) as Partial<BotCapability> | undefined;
  }
  if (byTool && typeof byTool === "object") {
    return (byTool as Record<string, Partial<BotCapability> | undefined>)[tool];
  }
  return undefined;
}

function initialState(owned: RemoteAgentChatState): BotRemoteAgentRunState {
  const lifecycle = owned.botLifecycle
    ? {
        ...owned.botLifecycle,
        degradedInterop: owned.botLifecycle.degradedInterop === true,
        interop: cloneBotInterop(owned.botLifecycle.interop),
      }
    : initBotLifecycleState();
  const projection = safeProjectionCopy(owned.botProjection);
  return {
    ...lifecycle,
    phase: projection ? phaseFor(projection.status) : "idle",
    requestId: owned.activeRequestId?.trim() || null,
    uploadTransfer: owned.uploadTransfer ?? null,
    projection,
    artifactLinks: cloneArtifactLinks(owned.artifactLinks),
    dialogueId: owned.dialogueId ?? null,
    messageId: owned.messageId ?? null,
    error: null,
  };
}

function cloneArtifactLinks(
  links: readonly ConversationArtifactLink[] | undefined
): ConversationArtifactLink[] {
  if (!Array.isArray(links)) return [];
  const kinds = new Set(["file", "report", "table", "image", "archive"]);
  const seen = new Set<string>();
  const cloned: ConversationArtifactLink[] = [];
  for (const link of links) {
    if (
      !link ||
      typeof link.id !== "string" ||
      typeof link.name !== "string" ||
      !kinds.has(link.kind) ||
      !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u.test(link.id) ||
      link.name.length === 0 ||
      seen.has(link.id) ||
      cloned.length >= 50
    ) {
      continue;
    }
    seen.add(link.id);
    cloned.push({ ...link });
  }
  return cloned;
}

function phaseFor(status: BotRunProjection["status"]): RemoteAgentRunPhase {
  switch (status) {
    case "INPUT_REQUIRED":
      return "input_required";
    case "SUCCEEDED":
      return "succeeded";
    case "FAILED":
    case "TIMED_OUT":
      return "failed";
    case "CANCELLED":
      return "cancelled";
    case "PENDING":
    case "QUEUED":
    case "RUNNING":
    default:
      return "running";
  }
}

function requestIdFor(dialogueId: string): string {
  requestSequence += 1;
  const safeDialogueId = dialogueId
    .replace(/[^A-Za-z0-9_-]/gu, "_")
    .slice(0, 64);
  return `remote-agent-${
    safeDialogueId || "dialogue"
  }-${Date.now()}-${requestSequence}`;
}

function normalizeDialogueId(dialogueId: string): string {
  const normalized = dialogueId.trim();
  if (!SAFE_DIALOGUE_ID_PATTERN.test(normalized)) {
    throw new BotRemoteAgentRunError(
      "invalid_dialogue",
      "Remote agent dialogue identity is invalid"
    );
  }
  return normalized;
}

function appendOptional(formData: FormData, key: string, value: unknown): void {
  if (typeof value === "string" && value.trim() !== "") {
    formData.append(key, value.trim());
  }
}

function buildFormData(
  input: RemoteAgentSubmitInput,
  dialogueId: string
): FormData {
  const formData = new FormData();
  formData.append("id", dialogueId);
  formData.append("query", input.query);
  formData.append("attachments", JSON.stringify(input.attachments ?? []));
  if (input.datasetDescription !== undefined) {
    formData.append("dataset_description", input.datasetDescription);
  }

  const resolver = input.resolver;
  if (resolver) {
    appendOptional(formData, "gene_id", resolver.geneId ?? resolver.gene_id);
    appendOptional(formData, "to_id", resolver.toId ?? resolver.to_id);
    appendOptional(
      formData,
      "species_code",
      resolver.speciesCode ?? resolver.species_code
    );
  }

  appendOptional(formData, "interop_mode", input.interopMode);
  if (input.interopTargets && input.interopTargets.length > 0) {
    formData.append("interop_targets", JSON.stringify(input.interopTargets));
  }
  return formData;
}

function responsePayload(response: unknown): unknown {
  if (isSuccessfulDataEnvelope(response)) return response.data;
  return response;
}

function safeProjectionCopy(
  projection: BotRunProjection | null | undefined
): BotRunProjection | null {
  if (!projection) return null;
  try {
    // Re-run the boundary parser before a projection enters message-owned
    // state. This strips unknown/private fields even when hydrate is called by
    // a history consumer rather than by the axios response path.
    return parseBotProjection(projection);
  } catch {
    return null;
  }
}

function safeIdentity(value: unknown, pattern: RegExp): string | null {
  const normalized =
    typeof value === "number" && Number.isSafeInteger(value)
      ? String(value)
      : typeof value === "string"
        ? value.trim()
        : "";
  return normalized && pattern.test(normalized) ? normalized : null;
}

function responseIdentity(response: unknown): RemoteAgentRunIdentity {
  const payload = responsePayload(response);
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return { dialogueId: null, messageId: null };
  }
  const record = payload as Record<string, unknown>;
  return {
    dialogueId: safeIdentity(record.dialogue_id, SAFE_DIALOGUE_ID_PATTERN),
    messageId: safeIdentity(record.id, /^[1-9]\d{0,18}$/u),
  };
}

function isCanceledRequest(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const candidate = error as { code?: unknown; name?: unknown };
  return (
    candidate.code === "ERR_CANCELED" || candidate.name === "CanceledError"
  );
}

function normalizeAttachments(
  attachments: readonly AssetAttachmentRef[] | undefined
): AssetAttachmentRef[] {
  if (attachments === undefined) return [];
  if (!Array.isArray(attachments) || attachments.length > 10) {
    throw new BotRemoteAgentRunError("invalid_query", "Invalid attachment");
  }
  const seen = new Set<string>();
  const normalized: AssetAttachmentRef[] = [];
  for (const attachment of attachments) {
    if (
      !attachment ||
      typeof attachment !== "object" ||
      Array.isArray(attachment) ||
      Object.keys(attachment).some((key) => key !== "asset_id") ||
      !isSafeAssetId(attachment.asset_id) ||
      seen.has(attachment.asset_id)
    ) {
      throw new BotRemoteAgentRunError("invalid_query", "Invalid attachment");
    }
    seen.add(attachment.asset_id);
    normalized.push({ asset_id: attachment.asset_id });
  }
  return normalized;
}

function capabilityLoader(
  source: RemoteAgentCapabilitySource
): ((force?: boolean) => Promise<unknown>) | undefined {
  const unwrappedSource = isRefLike(source) ? source.value : source;
  if (
    unwrappedSource &&
    typeof unwrappedSource === "object" &&
    "load" in unwrappedSource &&
    typeof (unwrappedSource as { load?: unknown }).load === "function"
  ) {
    return (unwrappedSource as { load: (force?: boolean) => Promise<unknown> })
      .load;
  }
  return undefined;
}

export function useBotRemoteAgentRun(options: UseBotRemoteAgentRunOptions): {
  state: Ref<BotRemoteAgentRunState>;
  submit: (input: RemoteAgentSubmitInput) => Promise<BotRunProjection | null>;
  hydrate: (
    projection: BotRunProjection,
    identity?: Partial<RemoteAgentRunIdentity>
  ) => void;
  cancel: () => boolean;
  reset: () => void;
} {
  const { tool, dialogueId } = options;
  const getChatState = options.getChatState ?? localStateFor;
  const capabilities =
    options.capabilities ??
    (useBotCapabilities(dialogueId) as RemoteAgentCapabilitySource);
  const owned = getChatState(dialogueId);
  const state = ref<BotRemoteAgentRunState>(initialState(owned));
  let activeToken: RemoteRequestToken | null = null;
  let capabilityLoadPromise: Promise<void> | null = null;

  const syncOwnedState = () => {
    owned.botProjection =
      safeProjectionCopy(state.value.projection) ?? undefined;
    owned.botLifecycle = {
      runId: state.value.runId,
      status: state.value.status,
      reportRevision: state.value.reportRevision,
      visibleReport: state.value.visibleReport,
      intermediateReport: state.value.intermediateReport,
      finalReport: state.value.finalReport,
      degraded: state.value.degraded,
      degradedInterop: state.value.degradedInterop === true,
      interop: state.value.interop ? { ...state.value.interop } : null,
      failures: [...state.value.failures],
      artifacts: state.value.artifacts.map((artifact) => ({
        outputDir: artifact.outputDir,
        paths: [...artifact.paths],
      })),
    };
    owned.artifactLinks = cloneArtifactLinks(state.value.artifactLinks);
  };

  const hydrate = (
    projection: BotRunProjection,
    identity: Partial<RemoteAgentRunIdentity> = {}
  ): void => {
    const safeProjection = parseBotProjection(projection);
    const lifecycle = reduceBotProjection(state.value, safeProjection);
    const dialogueId =
      identity.dialogueId === undefined
        ? state.value.dialogueId
        : safeIdentity(identity.dialogueId, SAFE_DIALOGUE_ID_PATTERN);
    const messageId =
      identity.messageId === undefined
        ? state.value.messageId
        : safeIdentity(identity.messageId, /^[1-9]\d{0,18}$/u);
    state.value = {
      ...state.value,
      ...lifecycle,
      phase: phaseFor(safeProjection.status),
      requestId: null,
      uploadTransfer: null,
      projection: safeProjection,
      artifactLinks:
        identity.artifactLinks === undefined
          ? cloneArtifactLinks(state.value.artifactLinks)
          : cloneArtifactLinks(identity.artifactLinks),
      dialogueId,
      messageId,
      error: null,
    };
    owned.dialogueId = dialogueId ?? undefined;
    owned.messageId = messageId ?? undefined;
    syncOwnedState();
  };

  const syncCancelledOwner = () => {
    const cancelledProjection = state.value.projection
      ? {
          ...state.value.projection,
          status: "CANCELLED" as const,
        }
      : null;
    const failedLifecycle = reduceBotFailure(state.value, {
      code: "cancelled",
    });
    state.value = {
      ...state.value,
      ...failedLifecycle,
      phase: "cancelled",
      requestId: null,
      uploadTransfer: null,
      projection: cancelledProjection,
      error: null,
    };
    owned.activeRequestId = "";
    owned.isSending = false;
    owned.uploadTransfer = null;
    syncOwnedState();
  };

  const ensureCapabilitiesLoaded = async (): Promise<void> => {
    const load = capabilityLoader(capabilities);
    if (!load) return;
    if (!capabilityLoadPromise) {
      capabilityLoadPromise = Promise.resolve(load(false)).then(
        () => undefined
      );
    }
    await capabilityLoadPromise;
  };

  const submit = async (
    input: RemoteAgentSubmitInput
  ): Promise<BotRunProjection | null> => {
    if (
      !Object.prototype.hasOwnProperty.call(REMOTE_AGENT_PRODUCT_REGISTRY, tool)
    ) {
      throw new BotRemoteAgentRunError("unknown_agent", "Unknown remote agent");
    }

    const normalizedDialogueId = normalizeDialogueId(dialogueId);
    let datasetDescription: string | undefined;
    try {
      datasetDescription = normalizeDatasetDescription(
        input.datasetDescription ?? ""
      );
    } catch (error) {
      if (error instanceof DatasetDescriptionError) {
        throw new BotRemoteAgentRunError(
          "invalid_dataset_description",
          error.message
        );
      }
      throw error;
    }
    try {
      await ensureCapabilitiesLoaded();
    } catch {
      throw new BotRemoteAgentRunError(
        "capability_disabled",
        "Remote agent capability is unavailable"
      );
    }

    const capability = capabilityFor(capabilities, tool);
    if (
      !capability ||
      capability.enabled !== true ||
      capability.execution !== "agent_run"
    ) {
      throw new BotRemoteAgentRunError(
        "capability_disabled",
        "Remote agent capability is disabled"
      );
    }

    if (capability.artifacts !== true) {
      throw new BotRemoteAgentRunError(
        "artifacts_disabled",
        "Remote agent artifacts are disabled"
      );
    }

    const attachments = normalizeAttachments(input.attachments);
    if (attachments.length > 0 && capability.attachments !== true) {
      throw new BotRemoteAgentRunError(
        "attachments_disabled",
        "Remote agent attachments are disabled"
      );
    }

    const resolver = input.resolver;
    const hasResolverValues =
      !!resolver &&
      [
        resolver.geneId ?? resolver.gene_id,
        resolver.toId ?? resolver.to_id,
        resolver.speciesCode ?? resolver.species_code,
      ].some((value) => typeof value === "string" && value.trim() !== "");
    if (hasResolverValues && capability.resolver !== true) {
      throw new BotRemoteAgentRunError(
        "resolver_disabled",
        "Remote agent resolver is disabled"
      );
    }

    if (typeof input.query !== "string" || input.query.trim() === "") {
      throw new BotRemoteAgentRunError("invalid_query", "A query is required");
    }
    if (owned.activeRequestId) {
      throw new BotRemoteAgentRunError(
        "run_in_progress",
        "A remote run is already active"
      );
    }

    const formData = buildFormData(
      { ...input, attachments, datasetDescription },
      normalizedDialogueId
    );
    const requestId = requestIdFor(normalizedDialogueId);
    const token: RemoteRequestToken = { id: requestId, cancelled: false };
    activeToken = token;
    const freshLifecycle = initBotLifecycleState();
    owned.activeRequestId = requestId;
    owned.isSending = true;
    owned.generationStopped = false;
    owned.activeAgentName = tool;
    state.value = {
      ...freshLifecycle,
      phase: "submitting",
      requestId,
      uploadTransfer: null,
      projection: null,
      artifactLinks: [],
      dialogueId: null,
      messageId: null,
      error: null,
    };
    syncOwnedState();

    try {
      const response = await runAgentProductAbortable(
        tool,
        formData,
        requestId
      );

      if (activeToken !== token || token.cancelled) return null;

      if (!isSuccessfulDataEnvelope(response)) {
        throw new Error("invalid response envelope");
      }
      const projection = parseBotProjection(response.data);
      const lifecycle = reduceBotProjection(state.value, projection);
      const identity = responseIdentity(response);
      state.value = {
        ...state.value,
        ...lifecycle,
        phase: phaseFor(projection.status),
        requestId,
        projection,
        dialogueId: identity.dialogueId,
        messageId: identity.messageId,
        error: null,
      };
      owned.dialogueId = identity.dialogueId ?? undefined;
      owned.messageId = identity.messageId ?? undefined;
      syncOwnedState();
      return projection;
    } catch (error) {
      if (
        activeToken !== token ||
        token.cancelled ||
        isCanceledRequest(error)
      ) {
        return null;
      }

      state.value = {
        ...state.value,
        ...reduceBotFailure(state.value, error),
        phase: "failed",
        error:
          error instanceof TypeError &&
          error.message.startsWith("Invalid Bot projection")
            ? "projection_invalid"
            : "request_failed",
      };
      syncOwnedState();
      throw error;
    } finally {
      const ownsRequest = activeToken === token;
      if (ownsRequest && owned.activeRequestId === requestId) {
        owned.activeRequestId = "";
        owned.isSending = false;
        owned.uploadTransfer = null;
        owned.activeAgentName = "";
      }
      if (ownsRequest && state.value.requestId === requestId) {
        state.value = { ...state.value, requestId: null, uploadTransfer: null };
      }
      if (ownsRequest) activeToken = null;
    }
  };

  const cancel = (): boolean => {
    const token = activeToken;
    if (!token || token.cancelled || owned.activeRequestId !== token.id) {
      return false;
    }
    token.cancelled = true;
    owned.generationStopped = true;
    owned.activeAgentName = "";
    syncCancelledOwner();
    return abortRequest(token.id);
  };

  const reset = (): void => {
    const token = activeToken;
    if (token) {
      token.cancelled = true;
      abortRequest(token.id);
      activeToken = null;
    }
    owned.activeRequestId = "";
    owned.isSending = false;
    owned.uploadTransfer = null;
    owned.generationStopped = false;
    owned.activeAgentName = "";
    owned.dialogueId = undefined;
    owned.messageId = undefined;
    delete owned.botProjection;
    delete owned.botLifecycle;
    delete owned.artifactLinks;
    state.value = {
      ...initBotLifecycleState(),
      phase: "idle",
      requestId: null,
      uploadTransfer: null,
      projection: null,
      artifactLinks: [],
      dialogueId: null,
      messageId: null,
      error: null,
    };
  };

  return { state, submit, hydrate, cancel, reset };
}
