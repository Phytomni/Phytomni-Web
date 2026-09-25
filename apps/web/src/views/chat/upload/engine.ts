import {
  type UploadCapabilityRenewal,
  type UploadCreateMetadata,
  type UploadSession,
  RESUMABLE_UPLOAD_MAX_PARALLEL_PARTS,
  RESUMABLE_UPLOAD_MAX_BYTES,
  RESUMABLE_UPLOAD_MAX_PART_COUNT,
} from "@/api/upload";
import type {
  ResumableUploadItem,
  UploadStatus,
} from "@/views/chat/upload/types";
import {
  isAbortError,
  isPermanentUploadError,
  isRecreateRequiredError,
  isRetryablePartError,
  needsCapabilityRenewal,
  retryDelayMs,
  waitForRetry,
  DEFAULT_UPLOAD_RETRY_POLICY,
  uploadErrorShape,
  type RetryPolicy,
} from "@/views/chat/upload/retry";
import {
  UploadTransportError,
  type UploadCompletion,
  type UploadDataPlane,
  type UploadHeadState,
  type UploadPartProgress,
} from "@/views/chat/upload/transport";
import type {
  UploadRecoveryRecord,
  UploadRecoveryStore,
} from "@/views/chat/upload/store";
import { validateUploadFile } from "@/views/chat/upload/validation";

export interface UploadControlPlane {
  create(
    metadata: UploadCreateMetadata,
    idempotencyKey: string
  ): Promise<
    UploadSession | { session: UploadSession; data?: UploadDataPlane }
  >;
  renew(
    assetId: string
  ): Promise<
    | UploadCapabilityRenewal
    | { renewal: UploadCapabilityRenewal; data?: UploadDataPlane }
  >;
}

export interface ResumableUploadEngineDeps {
  control: UploadControlPlane;
  data: UploadDataPlane;
  store: UploadRecoveryStore;
  hashPart: (blob: Blob) => Promise<string>;
  now: () => number;
  random: () => number;
  sleep?: (delayMs: number) => Promise<void>;
  retryPolicy?: RetryPolicy;
  /** Upper bound selected from browser memory/connection conditions. */
  browserMemoryLimit?: number;
}

export interface ResumableUploadEngineInput {
  localId: string;
  dialogueId: string;
  accountScope: string;
  file: File | null;
  idempotencyKey: string;
  recovered?: UploadRecoveryRecord;
}

export interface UploadEngineOptions {
  onChange?: (item: ResumableUploadItem) => void;
}

export class UploadEngineError extends Error {
  readonly code: string;
  readonly status: number | null;

  constructor(code: string, status: number | null = null) {
    super("Upload could not be completed");
    this.name = "UploadEngineError";
    this.code = code;
    this.status = status;
  }
}

type CreateResult =
  UploadSession | { session: UploadSession; data?: UploadDataPlane };
type RenewalResult =
  | UploadCapabilityRenewal
  | { renewal: UploadCapabilityRenewal; data?: UploadDataPlane };

function sessionFromCreate(result: CreateResult): {
  session: UploadSession;
  data?: UploadDataPlane;
} {
  if ("session" in result) return result;
  return { session: result };
}

function sessionFromRenewal(result: RenewalResult): {
  renewal: UploadCapabilityRenewal;
  data?: UploadDataPlane;
} {
  if ("renewal" in result) return result;
  return { renewal: result };
}

function completedBytes(
  receivedParts: readonly number[],
  partSizes: readonly number[]
): number {
  return receivedParts.reduce(
    (total, partNumber) => total + (partSizes[partNumber - 1] ?? 0),
    0
  );
}

function partSizesForSession(
  session: UploadSession,
  totalBytes: number
): number[] {
  if (
    !Number.isSafeInteger(session.part_size_bytes) ||
    session.part_size_bytes < 1 ||
    session.part_size_bytes > RESUMABLE_UPLOAD_MAX_BYTES ||
    !Number.isSafeInteger(session.part_count) ||
    session.part_count < 1 ||
    session.part_count > RESUMABLE_UPLOAD_MAX_PART_COUNT
  ) {
    throw new UploadEngineError("invalid_upload_session");
  }
  const sizes: number[] = [];
  let remaining = totalBytes;
  for (let index = 0; index < session.part_count; index += 1) {
    const size = Math.min(session.part_size_bytes, remaining);
    if (size < 1) throw new UploadEngineError("invalid_upload_session");
    sizes.push(size);
    remaining -= size;
  }
  if (remaining !== 0) throw new UploadEngineError("invalid_upload_session");
  return sizes;
}

function parseExpiry(value: string): number | null {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function metadataForItem(item: ResumableUploadItem): UploadCreateMetadata {
  return {
    filename: item.name,
    size_bytes: item.size,
    content_type_hint: item.type,
    last_modified_ms: item.lastModified,
  };
}

function idempotencyKey(): string {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }
  throw new UploadEngineError("secure_random_unavailable");
}

function stableError(error: unknown): UploadEngineError {
  if (error instanceof UploadEngineError) return error;
  const { status, code } = uploadErrorShape(error);
  if (status === 410)
    return new UploadEngineError("upload_session_expired", status);
  if (status === 413)
    return new UploadEngineError("upload_limit_exceeded", status);
  if (status === 409)
    return new UploadEngineError("upload_state_conflict", status);
  if (status === 401)
    return new UploadEngineError("upload_capability_invalid", status);
  if (code && /^[a-z][a-z0-9_]{1,63}$/.test(code)) {
    return new UploadEngineError(code, status ?? null);
  }
  return new UploadEngineError("upload_transport_error", status ?? null);
}

export class ResumableUploadEngine {
  private readonly deps: ResumableUploadEngineDeps;
  private readonly options: UploadEngineOptions;
  private readonly listeners = new Set<(item: ResumableUploadItem) => void>();
  private readonly retryPolicy: RetryPolicy;
  private readonly partDigests: Record<string, string>;
  private readonly partSizes: number[];
  private readonly accountScope: string;
  private readonly dialogueId: string;
  private maxParallelParts = 4;
  private item: ResumableUploadItem;
  private data: UploadDataPlane;
  private idempotency: string;
  private runPromise: Promise<void> | null = null;
  private controller: AbortController | null = null;
  private renewalPromise: Promise<void> | null = null;
  private inFlight = new Map<number, number>();
  private samples: Array<{ at: number; bytes: number }> = [];

  constructor(
    input: ResumableUploadEngineInput,
    deps: ResumableUploadEngineDeps,
    options: UploadEngineOptions = {}
  ) {
    this.deps = deps;
    this.options = options;
    this.retryPolicy = deps.retryPolicy ?? DEFAULT_UPLOAD_RETRY_POLICY;
    this.data = deps.data;
    this.accountScope = input.recovered?.accountScope ?? input.accountScope;
    this.dialogueId = input.recovered?.dialogueId ?? input.dialogueId;
    this.sessionExpiry = input.recovered?.sessionExpiresAt ?? null;
    this.idempotency = input.recovered?.idempotencyKey ?? input.idempotencyKey;
    this.partDigests = { ...(input.recovered?.partDigests ?? {}) };
    this.partSizes = [...(input.recovered?.partSizes ?? [])];
    this.item = input.recovered
      ? this.itemFromRecovery(input.recovered, input.file)
      : this.newItem(input);
    if (options.onChange) this.listeners.add(options.onChange);
  }

  private newItem(input: ResumableUploadEngineInput): ResumableUploadItem {
    if (input.file === null) throw new UploadEngineError("file_required");
    const validation = validateUploadFile(input.file);
    if (!validation.ok) throw new UploadEngineError(validation.code);
    return {
      localId: input.localId,
      file: input.file,
      assetId: null,
      name: validation.normalizedName,
      size: input.file.size,
      type: input.file.type,
      lastModified: input.file.lastModified,
      status: "queued",
      partSize: 0,
      partCount: 0,
      receivedParts: [],
      loadedBytes: 0,
      instantaneousSpeedBytesPerSecond: 0,
      speedBytesPerSecond: 0,
      etaSeconds: null,
      retryCount: 0,
      errorCode: null,
    };
  }

  private itemFromRecovery(
    record: UploadRecoveryRecord,
    file: File | null
  ): ResumableUploadItem {
    return {
      localId: record.localId,
      file,
      assetId: record.assetId,
      name: record.name,
      size: record.size,
      type: record.type,
      lastModified: record.lastModified,
      status: record.status,
      partSize: record.partSize,
      partCount: record.partCount,
      receivedParts: [...record.receivedParts],
      loadedBytes: completedBytes(record.receivedParts, record.partSizes),
      instantaneousSpeedBytesPerSecond: 0,
      speedBytesPerSecond: 0,
      etaSeconds: null,
      retryCount: 0,
      errorCode: null,
    };
  }

  get snapshot(): ResumableUploadItem {
    return { ...this.item, receivedParts: [...this.item.receivedParts] };
  }

  get itemId(): string {
    return this.item.localId;
  }

  get assetId(): string | null {
    return this.item.assetId;
  }

  subscribe(listener: (item: ResumableUploadItem) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(): void {
    const snapshot = this.snapshot;
    this.options.onChange?.(snapshot);
    for (const listener of this.listeners) listener(snapshot);
  }

  private setStatus(
    status: UploadStatus,
    errorCode: string | null = null
  ): void {
    this.item.status = status;
    this.item.errorCode = errorCode;
    this.emit();
  }

  private record(): UploadRecoveryRecord {
    return {
      accountScope: this.accountScope,
      localId: this.item.localId,
      assetId: this.item.assetId,
      dialogueId: this.dialogueId,
      idempotencyKey: this.idempotency,
      name: this.item.name,
      size: this.item.size,
      type: this.item.type,
      lastModified: this.item.lastModified,
      partSize: this.item.partSize,
      partCount: this.item.partCount,
      partSizes: [...this.partSizes],
      receivedParts: [...this.item.receivedParts],
      partDigests: { ...this.partDigests },
      status: this.item.status,
      sessionExpiresAt: this.sessionExpiry,
    };
  }

  private sessionExpiry: number | null = null;

  private async persist(): Promise<void> {
    await this.deps.store.upsert(this.record());
  }

  private applySession(session: UploadSession, data?: UploadDataPlane): void {
    if (
      session.protocol !== "obs-multipart-v2" ||
      (session.status !== "uploading" && session.status !== "completed") ||
      !Number.isSafeInteger(session.max_parallel_parts) ||
      session.max_parallel_parts < 1 ||
      session.max_parallel_parts > RESUMABLE_UPLOAD_MAX_PARALLEL_PARTS
    ) {
      throw new UploadEngineError("invalid_upload_session");
    }
    if (session.asset_id !== this.item.assetId && this.item.assetId !== null) {
      throw new UploadEngineError("upload_asset_mismatch");
    }
    const sizes = partSizesForSession(session, this.item.size);
    this.partSizes.splice(0, this.partSizes.length, ...sizes);
    this.item.assetId = session.asset_id;
    this.item.partSize = session.part_size_bytes;
    this.item.partCount = session.part_count;
    const browserMemoryLimit = this.deps.browserMemoryLimit ?? 4;
    if (!Number.isSafeInteger(browserMemoryLimit) || browserMemoryLimit < 1) {
      throw new UploadEngineError("invalid_upload_session");
    }
    this.maxParallelParts = Math.max(
      1,
      Math.min(
        RESUMABLE_UPLOAD_MAX_PARALLEL_PARTS,
        session.max_parallel_parts,
        browserMemoryLimit
      )
    );
    this.item.receivedParts = this.item.receivedParts.filter(
      (part) => part >= 1 && part <= session.part_count
    );
    this.sessionExpiry = parseExpiry(session.session_expires_at);
    if (data) this.data = data;
  }

  async start(): Promise<void> {
    if (this.runPromise) return this.runPromise;
    if (this.item.status === "completed" || this.item.status === "aborted")
      return;
    if (this.item.file === null) {
      this.setStatus("paused", "file_reselection_required");
      return;
    }
    this.applyIdentityFromCurrent();
    this.controller = new AbortController();
    this.runPromise = this.execute().finally(() => {
      this.runPromise = null;
      this.controller = null;
      this.inFlight.clear();
    });
    return this.runPromise;
  }

  private applyIdentityFromCurrent(): void {
    // The identity is initialized once in the constructor by this helper.
    if (this.accountScope === "") {
      throw new UploadEngineError("upload_account_scope_missing");
    }
  }

  private throwIfCancelled(): void {
    if (this.item.status === "aborted" || this.controller?.signal.aborted) {
      throw new DOMException("Upload aborted", "AbortError");
    }
  }

  pause(): void {
    if (this.item.status === "completed" || this.item.status === "aborted")
      return;
    this.setStatus("paused");
    this.controller?.abort();
  }

  async resume(): Promise<void> {
    if (this.item.status !== "paused") return this.start();
    if (this.runPromise) await this.runPromise;
    this.item.errorCode = null;
    return this.start();
  }

  private dropCreatedAssetIdentity(): void {
    this.data.clearCapability?.();
    this.item.assetId = null;
    this.item.partSize = 0;
    this.item.partCount = 0;
    this.item.receivedParts = [];
    this.item.loadedBytes = 0;
    this.partSizes.splice(0);
    for (const key of Object.keys(this.partDigests))
      delete this.partDigests[key];
    this.idempotency = idempotencyKey();
    this.emit();
  }

  private async recreateFromLocalState(): Promise<void> {
    if (this.item.assetId !== null) {
      try {
        await this.data.abort();
      } catch {
        // The old asset is still bounded by Bot expiry if best-effort abort fails.
      }
    }
    this.dropCreatedAssetIdentity();
  }

  private async abortCreatedAssetAfterFailure(): Promise<void> {
    if (this.item.assetId === null) return;
    try {
      await this.data.abort();
    } catch {
      // Keep the asset id so Retry can resume if abort did not land.
      return;
    }
    this.dropCreatedAssetIdentity();
  }

  async retry(): Promise<void> {
    if (this.item.status !== "failed" && this.item.status !== "expired") return;
    if (
      this.item.status === "expired" ||
      this.item.errorCode === "upload_file_changed" ||
      this.item.errorCode === "upload_state_conflict"
    ) {
      await this.recreateFromLocalState();
    }
    this.item.errorCode = null;
    this.setStatus(this.item.assetId ? "uploading" : "queued");
    await this.start();
  }

  reselect(file: File): void {
    const validation = validateUploadFile(file);
    if (!validation.ok) {
      this.setStatus("failed", validation.code);
      return;
    }
    if (
      validation.normalizedName !== this.item.name ||
      file.size !== this.item.size ||
      file.lastModified !== this.item.lastModified ||
      file.type !== this.item.type
    ) {
      this.setStatus("failed", "upload_file_changed");
      return;
    }
    this.item.file = file;
    if (this.item.status === "paused") void this.start();
    else this.emit();
  }

  async cancel(): Promise<void> {
    if (this.item.status === "completed" || this.item.status === "aborted")
      return;
    this.controller?.abort();
    this.setStatus("aborted");
    if (this.item.assetId !== null) {
      try {
        await this.data.abort();
      } catch {
        // Best effort: local cancellation must still clear the recovery state.
      }
    }
    this.data.clearCapability?.();
    await this.deps.store.remove(this.accountScope, this.item.localId);
  }

  private async execute(): Promise<void> {
    try {
      if (this.item.assetId === null) {
        await this.createAsset();
        if (this.item.status === "paused") return;
      }
      await this.reconcile();
      if (this.item.status === "completed") return;
      await this.uploadMissingParts();
      await this.complete();
    } catch (error) {
      if (isAbortError(error) && this.item.status === "paused") return;
      if (this.item.status === "aborted") return;
      this.controller?.abort();
      const stable = stableError(error);
      if (stable.status === 410 || stable.code === "upload_session_expired") {
        this.setStatus("expired", stable.code);
      } else {
        this.setStatus("failed", stable.code);
      }
      try {
        await this.abortCreatedAssetAfterFailure();
      } catch {
        // Visible failure already stands; slot release is best-effort.
      }
      try {
        await this.persist();
      } catch {
        // The visible stable error is already bounded.
      }
    }
  }

  private async createAsset(): Promise<void> {
    this.setStatus("creating");
    await this.persist();
    const result = sessionFromCreate(
      await this.deps.control.create(
        metadataForItem(this.item),
        this.idempotency
      )
    );
    if (this.item.status === "paused") {
      this.applySession(result.session, result.data);
      this.setStatus("paused");
      await this.persist();
      return;
    }
    try {
      this.throwIfCancelled();
    } catch (error) {
      const createdData = result.data ?? this.data;
      try {
        await createdData.abort();
      } catch {
        // Best effort: a canceled create must not block the visible cancel.
      }
      createdData.clearCapability?.();
      throw error;
    }
    this.applySession(result.session, result.data);
    this.setStatus("uploading");
    await this.persist();
  }

  private async reconcile(): Promise<void> {
    this.throwIfCancelled();
    if (this.item.assetId === null)
      throw new UploadEngineError("upload_asset_missing");
    const head = await this.data.head({ signal: this.controller?.signal });
    this.throwIfCancelled();
    await this.applyHead(head);
    await this.persist();
  }

  private async applyHead(head: UploadHeadState): Promise<void> {
    if (
      head.protocol !== "obs-multipart-v2" ||
      (head.status !== "uploading" && head.status !== "completed") ||
      head.partCount !== this.item.partCount ||
      head.lengthBytes !== this.item.size ||
      head.partSizeBytes !== this.item.partSize
    ) {
      throw new UploadEngineError("upload_session_mismatch");
    }
    const serverParts = new Set(head.receivedParts);
    if (
      head.status === "completed" &&
      serverParts.size !== this.item.partCount
    ) {
      throw new UploadEngineError("upload_session_mismatch");
    }
    for (const key of Object.keys(this.partDigests)) {
      if (!serverParts.has(Number(key))) delete this.partDigests[key];
    }
    const verified: number[] = [];
    for (const part of serverParts) {
      const digest = this.partDigests[String(part)];
      if (!digest) continue;
      const recalculated = await this.deps.hashPart(this.blobForPart(part));
      this.throwIfCancelled();
      if (recalculated !== digest) {
        throw new UploadEngineError("upload_file_changed", 409);
      }
      verified.push(part);
    }
    this.item.receivedParts = verified.sort((left, right) => left - right);
    this.item.loadedBytes = completedBytes(
      this.item.receivedParts,
      this.partSizes
    );
    if (
      head.status === "completed" &&
      this.item.receivedParts.length === this.item.partCount
    ) {
      this.item.loadedBytes = this.item.size;
      this.item.etaSeconds = 0;
      this.setStatus("completed");
      this.data.clearCapability?.();
    } else {
      this.emit();
    }
  }

  private blobForPart(partNumber: number): Blob {
    if (!this.item.file)
      throw new UploadEngineError("file_reselection_required");
    const start = this.partSizes
      .slice(0, partNumber - 1)
      .reduce((total, size) => total + size, 0);
    const size = this.partSizes[partNumber - 1];
    if (!size) throw new UploadEngineError("invalid_upload_part");
    return this.item.file.slice(start, start + size);
  }

  private updateProgress(
    partNumber: number,
    progress: UploadPartProgress
  ): void {
    if (this.item.status !== "uploading") return;
    this.inFlight.set(partNumber, Math.min(progress.loaded, progress.total));
    const committed = completedBytes(this.item.receivedParts, this.partSizes);
    const loaded =
      committed + [...this.inFlight.values()].reduce((a, b) => a + b, 0);
    const now = this.deps.now();
    const previous = this.samples[this.samples.length - 1];
    const instantaneousElapsed = previous
      ? Math.max(1, now - previous.at) / 1000
      : 0;
    this.item.instantaneousSpeedBytesPerSecond =
      previous && instantaneousElapsed > 0
        ? Math.max(0, loaded - previous.bytes) / instantaneousElapsed
        : 0;
    this.samples.push({ at: now, bytes: loaded });
    this.samples = this.samples.filter((sample) => now - sample.at <= 2_000);
    const first = this.samples[0];
    const elapsed = first ? Math.max(1, now - first.at) / 1000 : 0;
    const delta = first ? Math.max(0, loaded - first.bytes) : 0;
    const speed = elapsed > 0 ? delta / elapsed : 0;
    this.item.loadedBytes = loaded;
    this.item.speedBytesPerSecond = speed;
    this.item.etaSeconds =
      speed > 0 ? Math.max(0, (this.item.size - loaded) / speed) : null;
    this.emit();
  }

  private async uploadMissingParts(): Promise<void> {
    const pending = Array.from(
      { length: this.item.partCount },
      (_, index) => index + 1
    ).filter((part) => !this.item.receivedParts.includes(part));
    if (pending.length === 0) return;
    const maxParallel = Math.max(
      1,
      Math.min(this.maxParallelParts, this.item.partCount)
    );
    let cursor = 0;
    const worker = async (): Promise<void> => {
      while (cursor < pending.length) {
        if (this.controller?.signal.aborted)
          throw new DOMException("Upload aborted", "AbortError");
        const part = pending[cursor];
        cursor += 1;
        await this.uploadPartWithRetry(part);
      }
    };
    await Promise.all(
      Array.from({ length: Math.min(maxParallel, pending.length) }, () =>
        worker()
      )
    );
  }

  private async uploadPartWithRetry(partNumber: number): Promise<void> {
    let attempt = 0;
    let renewed = false;
    while (attempt < this.retryPolicy.maxAttempts) {
      attempt += 1;
      try {
        const blob = this.blobForPart(partNumber);
        const digest = await this.deps.hashPart(blob);
        this.throwIfCancelled();
        const savedDigest = this.partDigests[String(partNumber)];
        if (savedDigest && savedDigest !== digest) {
          throw new UploadEngineError("upload_file_changed", 409);
        }
        this.inFlight.set(partNumber, 0);
        this.updateProgress(partNumber, { loaded: 0, total: blob.size });
        await this.data.putPart(partNumber, blob, digest, {
          signal: this.controller?.signal,
          onProgress: (progress) => this.updateProgress(partNumber, progress),
        });
        this.throwIfCancelled();
        this.inFlight.delete(partNumber);
        this.partDigests[String(partNumber)] = digest;
        this.item.receivedParts = [...this.item.receivedParts, partNumber].sort(
          (left, right) => left - right
        );
        this.item.loadedBytes = completedBytes(
          this.item.receivedParts,
          this.partSizes
        );
        this.emit();
        await this.persist();
        return;
      } catch (error) {
        this.inFlight.delete(partNumber);
        if (isAbortError(error)) throw error;
        if (needsCapabilityRenewal(error) && !renewed) {
          renewed = true;
          await this.renewCapability();
          continue;
        }
        if (isRecreateRequiredError(error)) throw error;
        if (isPermanentUploadError(error)) throw error;
        if (
          !isRetryablePartError(error) ||
          attempt >= this.retryPolicy.maxAttempts
        ) {
          throw error;
        }
        this.item.retryCount += 1;
        this.emit();
        const delay = retryDelayMs(
          attempt,
          this.deps.random,
          error,
          this.retryPolicy
        );
        await waitForRetry(delay, this.controller?.signal, this.deps.sleep);
      }
    }
  }

  private async renewCapability(): Promise<void> {
    if (!this.item.assetId) throw new UploadEngineError("upload_asset_missing");
    if (!this.renewalPromise) {
      this.renewalPromise = (async () => {
        const result = sessionFromRenewal(
          await this.deps.control.renew(this.item.assetId as string)
        );
        if (result.renewal.asset_id !== this.item.assetId) {
          throw new UploadEngineError("upload_asset_mismatch");
        }
        if (result.data) this.data = result.data;
        else if (this.data.replaceCapability) {
          this.data.replaceCapability(result.renewal.capability);
        } else {
          throw new UploadEngineError("upload_capability_renewal_unavailable");
        }
        this.sessionExpiry = parseExpiry(result.renewal.session_expires_at);
        await this.reconcile();
      })().finally(() => {
        this.renewalPromise = null;
      });
    }
    await this.renewalPromise;
  }

  private async complete(): Promise<void> {
    this.throwIfCancelled();
    if (this.item.receivedParts.length !== this.item.partCount) {
      throw new UploadEngineError("upload_parts_missing", 409);
    }
    this.setStatus("completing");
    let attempt = 0;
    while (attempt < this.retryPolicy.maxAttempts) {
      attempt += 1;
      try {
        const result: UploadCompletion = await this.data.complete({
          signal: this.controller?.signal,
        });
        this.throwIfCancelled();
        if (result.asset_id !== this.item.assetId) {
          throw new UploadEngineError("upload_asset_mismatch");
        }
        this.item.loadedBytes = this.item.size;
        this.item.etaSeconds = 0;
        this.setStatus("completed");
        this.data.clearCapability?.();
        await this.persist();
        return;
      } catch (error) {
        if (isAbortError(error)) throw error;
        if (needsCapabilityRenewal(error)) {
          await this.renewCapability();
          if (this.item.status === "completed") return;
          continue;
        }
        const { status } = uploadErrorShape(error);
        if (status === 409 || status === 502) {
          await this.reconcile();
          if (this.item.status === "completed") return;
          if (this.item.receivedParts.length !== this.item.partCount) {
            await this.uploadMissingParts();
          }
          continue;
        }
        if (status === 410 || status === 413) throw error;
        if (
          !isRetryablePartError(error) ||
          attempt >= this.retryPolicy.maxAttempts
        ) {
          throw error;
        }
        const delay = retryDelayMs(
          attempt,
          this.deps.random,
          error,
          this.retryPolicy
        );
        await waitForRetry(delay, this.controller?.signal, this.deps.sleep);
      }
    }
    throw new UploadTransportError("Upload completion failed");
  }
}

export function createResumableUploadEngine(
  input: ResumableUploadEngineInput,
  deps: ResumableUploadEngineDeps,
  options?: UploadEngineOptions
): ResumableUploadEngine {
  return new ResumableUploadEngine(input, deps, options);
}
