import { validateUploadFile } from "@/views/chat/upload/validation";
import type { UploadPurpose, UploadStatus } from "@/views/chat/upload/types";

export const UPLOAD_RECOVERY_DB_NAME = "phytomni-resumable-uploads";
export const UPLOAD_RECOVERY_DB_VERSION = 1;
export const UPLOAD_RECOVERY_STORE_NAME = "assets";

const MAX_UPLOAD_BYTES = 10 * 1024 * 1024 * 1024;
const MAX_PART_COUNT = 100_000;
const MAX_ID_BYTES = 128;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ASSET_ID_PATTERN = /^file_[A-Za-z0-9_-]{1,123}$/;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const STATUS_VALUES = new Set<UploadStatus>([
  "queued",
  "creating",
  "uploading",
  "paused",
  "failed",
  "completing",
  "completed",
  "aborted",
  "expired",
]);

const RECORD_KEYS = new Set([
  "accountScope",
  "localId",
  "assetId",
  "dialogueId",
  "idempotencyKey",
  "name",
  "size",
  "type",
  "lastModified",
  "purpose",
  "partSize",
  "partCount",
  "partSizes",
  "receivedParts",
  "partDigests",
  "status",
  "sessionExpiresAt",
]);

export interface UploadRecoveryRecord {
  accountScope: string;
  localId: string;
  assetId: string | null;
  dialogueId: string;
  idempotencyKey: string;
  name: string;
  size: number;
  type: string;
  lastModified: number;
  purpose: UploadPurpose;
  partSize: number;
  partCount: number;
  partSizes: number[];
  receivedParts: number[];
  partDigests: Record<string, string>;
  status: UploadStatus;
  sessionExpiresAt: number | null;
}

export class UploadRecoveryError extends Error {
  readonly code: string;

  constructor(code = "upload_recovery_failed") {
    super("Upload recovery state unavailable");
    this.name = "UploadRecoveryError";
    this.code = code;
  }
}

export interface UploadObjectStoreAdapter {
  get(key: [string, string]): Promise<unknown>;
  getAll(): Promise<unknown[]>;
  put(value: unknown): Promise<void>;
  delete(key: [string, string]): Promise<void>;
}

export interface UploadDatabaseAdapter {
  transaction(
    storeName: typeof UPLOAD_RECOVERY_STORE_NAME,
    mode: "readonly" | "readwrite"
  ): UploadObjectStoreAdapter;
  close?(): void;
}

export type OpenUploadDatabase = (
  name: string,
  version: number,
  onUpgrade?: (database: IDBDatabase) => void
) => Promise<UploadDatabaseAdapter>;

export interface UploadRecoveryStore {
  upsert(record: UploadRecoveryRecord): Promise<void>;
  load(
    accountScope: string,
    localId: string
  ): Promise<UploadRecoveryRecord | null>;
  list(accountScope: string): Promise<UploadRecoveryRecord[]>;
  remove(accountScope: string, localId: string): Promise<void>;
  close(): Promise<void>;
}

function invalidRecord(): never {
  throw new UploadRecoveryError("upload_recovery_corrupt");
}

function recoveryPurpose(value: unknown): UploadPurpose {
  if (value === undefined) return "document";
  if (value === "dataset" || value === "document") return value;
  return invalidRecord();
}

function safeId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    new TextEncoder().encode(value).length <= MAX_ID_BYTES &&
    [...value].every((character) => {
      const code = character.codePointAt(0) ?? 0;
      return code >= 0x20 && code !== 0x7f;
    })
  );
}

function safeNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function safePositiveInteger(
  value: unknown,
  max = Number.MAX_SAFE_INTEGER
): value is number {
  return (
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= 1 &&
    value <= max
  );
}

function hasOnlyRecordKeys(value: Record<string, unknown>): boolean {
  return Object.keys(value).every((key) => RECORD_KEYS.has(key));
}

function validatePartDigests(
  value: unknown,
  partCount: number,
  receivedParts: readonly number[]
): Record<string, string> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    invalidRecord();
  }
  const output: Record<string, string> = Object.create(null) as Record<
    string,
    string
  >;
  const received = new Set(receivedParts);
  for (const [key, digest] of Object.entries(value)) {
    const partNumber = Number(key);
    if (
      !Number.isSafeInteger(partNumber) ||
      partNumber < 1 ||
      partNumber > partCount ||
      !received.has(partNumber) ||
      typeof digest !== "string" ||
      !SHA256_PATTERN.test(digest)
    ) {
      invalidRecord();
    }
    output[String(partNumber)] = digest;
  }
  for (const partNumber of receivedParts) {
    if (output[String(partNumber)] === undefined) invalidRecord();
  }
  return output;
}

function validateRecoveryRecord(value: unknown): UploadRecoveryRecord {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value) ||
    !hasOnlyRecordKeys(value as Record<string, unknown>)
  ) {
    invalidRecord();
  }
  const record = value as Record<string, unknown>;
  const purpose = recoveryPurpose(record.purpose);
  if (
    typeof record.accountScope !== "string" ||
    !/^[0-9a-f]{64}$/.test(record.accountScope) ||
    !safeId(record.localId) ||
    (record.assetId !== null &&
      (typeof record.assetId !== "string" ||
        !ASSET_ID_PATTERN.test(record.assetId))) ||
    !safeId(record.dialogueId) ||
    typeof record.idempotencyKey !== "string" ||
    !UUID_PATTERN.test(record.idempotencyKey) ||
    typeof record.name !== "string" ||
    typeof record.type !== "string" ||
    !safeNonNegativeInteger(record.lastModified) ||
    !safePositiveInteger(record.size, MAX_UPLOAD_BYTES) ||
    typeof record.status !== "string" ||
    !STATUS_VALUES.has(record.status as UploadStatus) ||
    (record.sessionExpiresAt !== null &&
      !safeNonNegativeInteger(record.sessionExpiresAt)) ||
    !Array.isArray(record.partSizes) ||
    !Array.isArray(record.receivedParts)
  ) {
    invalidRecord();
  }
  const metadata = validateUploadFile({
    name: record.name,
    size: record.size,
    type: record.type,
    lastModified: record.lastModified,
  });
  if (!metadata.ok || metadata.normalizedName !== record.name) invalidRecord();

  const created = record.assetId !== null;
  const partSize = record.partSize;
  const partCount = record.partCount;
  if (
    !safeNonNegativeInteger(partSize) ||
    !safeNonNegativeInteger(partCount) ||
    partCount > MAX_PART_COUNT ||
    (created &&
      (!safePositiveInteger(partSize, MAX_UPLOAD_BYTES) ||
        !safePositiveInteger(partCount, MAX_PART_COUNT))) ||
    (!created && (partSize !== 0 || partCount !== 0)) ||
    (!created &&
      record.status !== "queued" &&
      record.status !== "creating" &&
      record.status !== "failed") ||
    record.partSizes.length !== partCount ||
    record.partSizes.some(
      (part) => !safePositiveInteger(part, MAX_UPLOAD_BYTES)
    ) ||
    (created &&
      record.partSizes.reduce((total, part) => total + part, 0) !== record.size)
  ) {
    invalidRecord();
  }

  const receivedParts = record.receivedParts.map((part) => {
    if (!safePositiveInteger(part, partCount)) invalidRecord();
    return part;
  });
  if (new Set(receivedParts).size !== receivedParts.length) invalidRecord();
  const partDigests = validatePartDigests(
    record.partDigests,
    partCount,
    receivedParts
  );
  return {
    accountScope: record.accountScope,
    localId: record.localId,
    assetId: record.assetId,
    dialogueId: record.dialogueId,
    idempotencyKey: record.idempotencyKey,
    name: record.name,
    size: record.size,
    type: record.type,
    lastModified: record.lastModified,
    purpose,
    partSize,
    partCount,
    partSizes: [...record.partSizes],
    receivedParts: [...receivedParts],
    partDigests,
    status: record.status as UploadStatus,
    sessionExpiresAt: record.sessionExpiresAt,
  };
}

export function serializeUploadRecoveryRecord(
  record: UploadRecoveryRecord
): UploadRecoveryRecord {
  const validated = validateRecoveryRecord(record);
  return {
    ...validated,
    partSizes: [...validated.partSizes],
    receivedParts: [...validated.receivedParts],
    partDigests: { ...validated.partDigests },
  };
}

function isExpired(record: UploadRecoveryRecord, now: number): boolean {
  return (
    record.status !== "completed" &&
    record.status !== "aborted" &&
    record.sessionExpiresAt !== null &&
    record.sessionExpiresAt <= now
  );
}

function wrapStorageError(error: unknown): UploadRecoveryError {
  return error instanceof UploadRecoveryError
    ? error
    : new UploadRecoveryError();
}

function requestPromise<T>(
  request: IDBRequest<T>,
  transaction: IDBTransaction
): Promise<T> {
  return new Promise((resolve, reject) => {
    let settled = false;
    let result: T;
    const fail = (): void => {
      if (settled) return;
      settled = true;
      reject(new UploadRecoveryError());
    };
    request.onsuccess = () => {
      result = request.result;
    };
    request.onerror = fail;
    transaction.onerror = fail;
    transaction.onabort = fail;
    transaction.oncomplete = () => {
      if (settled) return;
      settled = true;
      resolve(result);
    };
  });
}

function writePromise<T>(
  request: IDBRequest<T>,
  transaction: IDBTransaction
): Promise<void> {
  return requestPromise(request, transaction).then(() => undefined);
}

function openNativeDatabase(
  name: string,
  version: number,
  onUpgrade?: (database: IDBDatabase) => void
): Promise<UploadDatabaseAdapter> {
  const indexedDb = globalThis.indexedDB;
  if (!indexedDb) {
    return Promise.reject(
      new UploadRecoveryError("upload_storage_unavailable")
    );
  }
  return new Promise((resolve, reject) => {
    const request = indexedDb.open(name, version);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(UPLOAD_RECOVERY_STORE_NAME)) {
        database.createObjectStore(UPLOAD_RECOVERY_STORE_NAME, {
          keyPath: ["accountScope", "localId"],
        });
      }
      onUpgrade?.(database);
    };
    request.onerror = () =>
      reject(new UploadRecoveryError("upload_storage_unavailable"));
    request.onblocked = () =>
      reject(new UploadRecoveryError("upload_storage_blocked"));
    request.onsuccess = () => {
      const database = request.result;
      const adapter: UploadDatabaseAdapter = {
        transaction(storeName, mode) {
          try {
            const transaction = database.transaction(storeName, mode);
            const objectStore = transaction.objectStore(storeName);
            return {
              get(key) {
                return requestPromise(objectStore.get(key), transaction);
              },
              getAll() {
                return requestPromise(objectStore.getAll(), transaction);
              },
              put(value) {
                return writePromise(objectStore.put(value), transaction);
              },
              delete(key) {
                return writePromise(objectStore.delete(key), transaction);
              },
            };
          } catch {
            throw new UploadRecoveryError();
          }
        },
        close() {
          database.close();
        },
      };
      resolve(adapter);
    };
  });
}

export function createUploadRecoveryStore(
  options: {
    openDatabase?: OpenUploadDatabase;
    now?: () => number;
  } = {}
): UploadRecoveryStore {
  const openDatabase = options.openDatabase ?? openNativeDatabase;
  const now = options.now ?? (() => Date.now());
  let databasePromise: Promise<UploadDatabaseAdapter> | null = null;

  const database = (): Promise<UploadDatabaseAdapter> => {
    if (databasePromise === null) {
      databasePromise = openDatabase(
        UPLOAD_RECOVERY_DB_NAME,
        UPLOAD_RECOVERY_DB_VERSION
      ).catch((error: unknown) => {
        databasePromise = null;
        throw wrapStorageError(error);
      });
    }
    return databasePromise;
  };

  const removeRaw = async (
    accountScope: string,
    localId: string
  ): Promise<void> => {
    const db = await database();
    await db
      .transaction(UPLOAD_RECOVERY_STORE_NAME, "readwrite")
      .delete([accountScope, localId]);
  };

  const loadValue = async (
    value: unknown
  ): Promise<UploadRecoveryRecord | null> => {
    if (value === undefined || value === null) return null;
    try {
      const record = validateRecoveryRecord(value);
      if (isExpired(record, now())) {
        await removeRaw(record.accountScope, record.localId);
        return null;
      }
      return record;
    } catch (error) {
      if (!(error instanceof UploadRecoveryError)) throw error;
      if (
        typeof value === "object" &&
        value !== null &&
        !Array.isArray(value) &&
        typeof (value as Record<string, unknown>).accountScope === "string" &&
        typeof (value as Record<string, unknown>).localId === "string"
      ) {
        try {
          await removeRaw(
            (value as Record<string, unknown>).accountScope as string,
            (value as Record<string, unknown>).localId as string
          );
        } catch {
          // A corrupt record is non-resumable even if cleanup is unavailable.
        }
      }
      return null;
    }
  };

  return {
    async upsert(record): Promise<void> {
      const serialized = serializeUploadRecoveryRecord(record);
      const db = await database();
      await db
        .transaction(UPLOAD_RECOVERY_STORE_NAME, "readwrite")
        .put(serialized);
    },

    async load(accountScope, localId): Promise<UploadRecoveryRecord | null> {
      const db = await database();
      const value = await db
        .transaction(UPLOAD_RECOVERY_STORE_NAME, "readonly")
        .get([accountScope, localId]);
      return loadValue(value);
    },

    async list(accountScope): Promise<UploadRecoveryRecord[]> {
      const db = await database();
      const values = await db
        .transaction(UPLOAD_RECOVERY_STORE_NAME, "readonly")
        .getAll();
      const records: UploadRecoveryRecord[] = [];
      for (const value of values) {
        if (
          typeof value !== "object" ||
          value === null ||
          (value as Record<string, unknown>).accountScope !== accountScope
        ) {
          continue;
        }
        const record = await loadValue(value);
        if (record !== null) records.push(record);
      }
      return records;
    },

    async remove(accountScope, localId): Promise<void> {
      await removeRaw(accountScope, localId);
    },

    async close(): Promise<void> {
      if (databasePromise === null) return;
      const db = await databasePromise;
      db.close?.();
      databasePromise = null;
    },
  };
}
