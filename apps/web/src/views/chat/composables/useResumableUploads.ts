import { computed, getCurrentInstance, onUnmounted, type Ref } from "vue";
import type { ApiEnvelope } from "@/api/types";
import {
  createUpload,
  renewUploadCapability,
  type UploadCapabilityRenewal,
  type UploadCreateMetadata,
  type UploadSession,
} from "@/api/upload";
import type { BotUploadCapability } from "./useBotCapabilities";
import {
  accountScopeForUsername,
  hashBlobSlice,
} from "@/views/chat/upload/hash";
import {
  createUploadDataPlane,
  type UploadDataPlane,
} from "@/views/chat/upload/transport";
import {
  createResumableUploadEngine,
  UploadEngineError,
  type ResumableUploadEngine,
  type ResumableUploadEngineDeps,
  type UploadControlPlane,
} from "@/views/chat/upload/engine";
import {
  createUploadRecoveryStore,
  type UploadRecoveryStore,
} from "@/views/chat/upload/store";
import type {
  ResumableUploadItem,
  UploadPurpose,
} from "@/views/chat/upload/types";
import { validateUploadFile } from "@/views/chat/upload/validation";
import type { ChatUIState } from "../types";
import type { ChatAttachmentValidationError } from "./useFileUpload";

export interface ResumableUploadQueueOptions {
  currentChatId: Ref<string>;
  getChatState: (dialogueId: string) => ChatUIState;
  uploadCapability: Ref<BotUploadCapability>;
  username: Ref<string> | (() => string);
  store?: UploadRecoveryStore;
  now?: () => number;
  random?: () => number;
  browserMemoryLimit?: number;
  onValidationError?: (error: ChatAttachmentValidationError) => void;
}

function defaultBrowserMemoryLimit(): number {
  if (typeof navigator === "undefined") return 4;
  const deviceMemory = (navigator as Navigator & { deviceMemory?: unknown })
    .deviceMemory;
  if (typeof deviceMemory !== "number" || !Number.isFinite(deviceMemory)) {
    return 4;
  }
  return Math.max(1, Math.min(4, Math.floor(deviceMemory / 2)));
}

const EMPTY_DATA_PLANE: UploadDataPlane = {
  head: async () => {
    throw new UploadEngineError("upload_control_unavailable");
  },
  putPart: async () => {
    throw new UploadEngineError("upload_control_unavailable");
  },
  complete: async () => {
    throw new UploadEngineError("upload_control_unavailable");
  },
  abort: async () => undefined,
};

// Recovery records no longer carry classification; retain this only until the
// runtime item type drops its transitional purpose field.
const RECOVERED_UPLOAD_PURPOSE: UploadPurpose = "document";

function capabilityData(
  capability: BotUploadCapability,
  session: UploadSession | UploadCapabilityRenewal
): UploadDataPlane {
  if (
    !capability.enabled ||
    capability.protocol !== "obs-multipart-v2" ||
    capability.upload_origin === ""
  ) {
    throw new UploadEngineError("upload_control_unavailable");
  }
  return createUploadDataPlane({
    uploadUrl: session.upload_url,
    expectedOrigin: capability.upload_origin,
    assetId: session.asset_id,
    capability: session.capability,
  });
}

function envelopeData<T>(response: ApiEnvelope<T>): T {
  if (response.code !== 200 || response.data === undefined) {
    throw new UploadEngineError("upload_control_unavailable");
  }
  return response.data;
}

function newLocalId(): string {
  return `upload-${newUUID()}`;
}

function newUUID(): string {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }
  throw new UploadEngineError("secure_random_unavailable");
}

function usernameValue(username: Ref<string> | (() => string)): string {
  return typeof username === "function" ? username() : username.value;
}

function blocking(item: ResumableUploadItem): boolean {
  return item.status !== "completed" && item.status !== "aborted";
}

export function useResumableUploads(options: ResumableUploadQueueOptions) {
  const store = options.store ?? createUploadRecoveryStore();
  const enginesByDialogue = new Map<
    string,
    Map<string, ResumableUploadEngine>
  >();
  const dialogueAliases = new Map<string, string>();
  const now = options.now ?? (() => Date.now());
  const random = options.random ?? (() => Math.random());

  const mapFor = (dialogueId: string): Map<string, ResumableUploadEngine> => {
    let map = enginesByDialogue.get(dialogueId);
    if (!map) {
      map = new Map();
      enginesByDialogue.set(dialogueId, map);
    }
    return map;
  };

  const canonicalDialogueId = (dialogueId: string): string => {
    let current = dialogueId;
    const visited = new Set<string>();
    while (dialogueAliases.has(current) && !visited.has(current)) {
      visited.add(current);
      current = dialogueAliases.get(current) as string;
    }
    return current;
  };

  const stateFor = (dialogueId: string): ChatUIState =>
    options.getChatState(dialogueId);

  const setItem = (dialogueId: string, item: ResumableUploadItem): void => {
    const ownerDialogueId = canonicalDialogueId(dialogueId);
    const state = stateFor(ownerDialogueId);
    const index = state.fileList.findIndex(
      (candidate) => candidate.localId === item.localId
    );
    if (index < 0) {
      state.fileList = [...state.fileList, item];
    } else {
      const next = [...state.fileList];
      next[index] = item;
      state.fileList = next;
    }
    refreshTransfer(ownerDialogueId);
  };

  function refreshTransfer(dialogueId: string): void {
    const state = stateFor(dialogueId);
    const active = state.fileList.filter(blocking);
    if (active.length === 0) {
      state.uploadTransfer = null;
      return;
    }
    const loaded = active.reduce((total, item) => total + item.loadedBytes, 0);
    const total = active.reduce((sum, item) => sum + item.size, 0);
    const speed = active.reduce(
      (sum, item) => sum + Math.max(0, item.speedBytesPerSecond),
      0
    );
    state.uploadTransfer = {
      loaded,
      total,
      percent:
        total > 0 ? Math.min(100, Math.round((loaded / total) * 100)) : 0,
      etaSec: speed > 0 ? Math.max(0, (total - loaded) / speed) : null,
      indeterminate: total <= 0,
      phase: "upload",
      requestId: `upload:${dialogueId}`,
    };
  }

  const control: UploadControlPlane = {
    async create(
      metadata: UploadCreateMetadata,
      idempotencyKey: string
    ): Promise<{ session: UploadSession; data: UploadDataPlane }> {
      const capability = options.uploadCapability.value;
      const session = envelopeData(
        await createUpload(metadata, idempotencyKey)
      );
      return { session, data: capabilityData(capability, session) };
    },
    async renew(
      assetId: string
    ): Promise<{ renewal: UploadCapabilityRenewal; data: UploadDataPlane }> {
      const capability = options.uploadCapability.value;
      const renewal = envelopeData(await renewUploadCapability(assetId));
      return { renewal, data: capabilityData(capability, renewal) };
    },
  };

  const depsFor = (data: UploadDataPlane): ResumableUploadEngineDeps => ({
    control,
    data,
    store,
    hashPart: hashBlobSlice,
    now,
    random,
    browserMemoryLimit:
      options.browserMemoryLimit ?? defaultBrowserMemoryLimit(),
  });

  const queueFiles = async (
    files: readonly File[],
    purpose: UploadPurpose
  ): Promise<void> => {
    const dialogueId = options.currentChatId.value;
    if (!dialogueId) return;
    const capability = options.uploadCapability.value;
    if (!capability.enabled) {
      files.forEach((file) =>
        options.onValidationError?.({
          code: "upload_disabled",
          fileName: file.name,
        })
      );
      return;
    }
    const state = stateFor(dialogueId);
    const accountScope = await accountScopeForUsername(
      usernameValue(options.username)
    ).catch(() => null);
    if (!accountScope) {
      files.forEach((file) =>
        options.onValidationError?.({
          code: "upload_unavailable",
          fileName: file.name,
        })
      );
      return;
    }
    const engines = mapFor(dialogueId);
    for (const file of files) {
      if (state.fileList.length >= capability.max_attachments) {
        options.onValidationError?.({
          code: "too_many_files",
          fileName: file.name,
        });
        continue;
      }
      const validation = validateUploadFile(file, state.fileList.length);
      if (!validation.ok) {
        options.onValidationError?.({
          code: validation.code,
          fileName: file.name,
        });
        continue;
      }
      const existing = state.fileList.find(
        (item) =>
          item.file === null &&
          item.name === validation.normalizedName &&
          item.size === file.size &&
          item.type === file.type &&
          item.lastModified === file.lastModified &&
          item.purpose === purpose
      );
      if (existing) {
        engines.get(existing.localId)?.reselect(file);
        continue;
      }
      const localId = newLocalId();
      const engine = createResumableUploadEngine(
        {
          localId,
          dialogueId,
          accountScope,
          file,
          idempotencyKey: newUUID(),
          purpose,
        },
        depsFor(EMPTY_DATA_PLANE),
        { onChange: (item) => setItem(dialogueId, item) }
      );
      engines.set(localId, engine);
      setItem(dialogueId, engine.snapshot);
      void engine.start();
    }
  };

  const removeUpload = async (item: ResumableUploadItem): Promise<void> => {
    const dialogueId = options.currentChatId.value;
    const engines = enginesByDialogue.get(dialogueId);
    const engine = engines?.get(item.localId);
    if (engine && item.status !== "completed") await engine.cancel();
    engines?.delete(item.localId);
    const state = stateFor(dialogueId);
    state.fileList = state.fileList.filter(
      (candidate) => candidate.localId !== item.localId
    );
    refreshTransfer(dialogueId);
  };

  const removeUploadById = async (localId: string): Promise<void> => {
    const dialogueId = options.currentChatId.value;
    const item = stateFor(dialogueId).fileList.find(
      (candidate) => candidate.localId === localId
    );
    if (item) await removeUpload(item);
  };

  const cancelUpload = async (localId: string): Promise<void> => {
    const dialogueId = options.currentChatId.value;
    const engine = enginesByDialogue.get(dialogueId)?.get(localId);
    if (!engine) return;
    await engine.cancel();
    refreshTransfer(dialogueId);
  };

  const action = async (
    localId: string,
    method: "pause" | "resume" | "retry"
  ): Promise<void> => {
    const dialogueId = options.currentChatId.value;
    const engine = enginesByDialogue.get(dialogueId)?.get(localId);
    if (!engine) return;
    await engine[method]();
  };

  const pauseUpload = (localId: string): Promise<void> =>
    action(localId, "pause");
  const resumeUpload = (localId: string): Promise<void> =>
    action(localId, "resume");
  const retryUpload = (localId: string): Promise<void> =>
    action(localId, "retry");

  const reselectUpload = (localId: string, file: File): void => {
    const dialogueId = options.currentChatId.value;
    enginesByDialogue.get(dialogueId)?.get(localId)?.reselect(file);
  };

  const cancelDialogue = async (dialogueId: string): Promise<void> => {
    const engines = enginesByDialogue.get(dialogueId);
    if (!engines) return;
    await Promise.all(
      [...engines.values()]
        .filter((engine) => blocking(engine.snapshot))
        .map((engine) => engine.cancel())
    );
    refreshTransfer(dialogueId);
  };

  const hasBlockingUploads = computed(() =>
    stateFor(options.currentChatId.value).fileList.some(blocking)
  );

  const completedAssetIds = computed(() =>
    stateFor(options.currentChatId.value)
      .fileList.filter(
        (item) => item.status === "completed" && item.assetId !== null
      )
      .map((item) => ({ asset_id: item.assetId as string }))
  );

  const rekeyDialogue = (
    fromDialogueId: string,
    toDialogueId: string
  ): void => {
    if (fromDialogueId === toDialogueId) return;
    const engines = enginesByDialogue.get(fromDialogueId);
    if (!engines || enginesByDialogue.has(toDialogueId)) return;
    enginesByDialogue.set(toDialogueId, engines);
    enginesByDialogue.delete(fromDialogueId);
    dialogueAliases.set(fromDialogueId, toDialogueId);
  };

  const loadRecovery = async (
    dialogueId = options.currentChatId.value
  ): Promise<void> => {
    const scope = await accountScopeForUsername(
      usernameValue(options.username)
    ).catch(() => null);
    if (!scope || !dialogueId) return;
    let records;
    try {
      records = (await store.list(scope)).filter(
        (record) => record.dialogueId === dialogueId
      );
    } catch {
      return;
    }
    const engines = mapFor(dialogueId);
    for (const recovered of records) {
      if (engines.has(recovered.localId)) continue;
      let data = EMPTY_DATA_PLANE;
      if (recovered.assetId !== null) {
        try {
          const renewal = envelopeData(
            await renewUploadCapability(recovered.assetId)
          );
          data = capabilityData(options.uploadCapability.value, renewal);
        } catch {
          // Keep the record visible but require a fresh capability/reselection.
        }
      }
      const engine = createResumableUploadEngine(
        {
          localId: recovered.localId,
          dialogueId,
          accountScope: scope,
          file: null,
          idempotencyKey: recovered.idempotencyKey,
          purpose: RECOVERED_UPLOAD_PURPOSE,
          recovered,
        },
        depsFor(data),
        { onChange: (item) => setItem(dialogueId, item) }
      );
      engines.set(recovered.localId, engine);
      setItem(dialogueId, engine.snapshot);
      if (recovered.status !== "completed" && recovered.status !== "aborted") {
        await engine.start();
      }
    }
  };

  const dispose = async (): Promise<void> => {
    for (const engines of enginesByDialogue.values()) {
      for (const engine of engines.values()) {
        if (engine.snapshot.status !== "completed") await engine.cancel();
      }
    }
    enginesByDialogue.clear();
    dialogueAliases.clear();
    await store.close();
  };

  if (getCurrentInstance()) {
    onUnmounted(() => {
      void dispose();
    });
  }

  return {
    recoveryStore: store,
    queueFiles,
    removeUpload,
    removeUploadById,
    cancelUpload,
    pauseUpload,
    resumeUpload,
    retryUpload,
    reselectUpload,
    cancelDialogue,
    loadRecovery,
    rekeyDialogue,
    hasBlockingUploads,
    completedAssetIds,
    refreshTransfer,
    dispose,
  };
}
