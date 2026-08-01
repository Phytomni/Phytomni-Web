import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  createUploadRecoveryStore,
  UPLOAD_RECOVERY_DB_NAME,
  UPLOAD_RECOVERY_DB_VERSION,
  UPLOAD_RECOVERY_STORE_NAME,
  type UploadDatabaseAdapter,
  type UploadObjectStoreAdapter,
  type UploadRecoveryRecord,
} from "@/views/chat/upload/store";

const accountA = "a".repeat(64);
const accountB = "b".repeat(64);
const digest = "a".repeat(64);

function queuedRecord(
  overrides: Partial<UploadRecoveryRecord> = {}
): UploadRecoveryRecord {
  return {
    accountScope: accountA,
    localId: "local-1",
    assetId: null,
    dialogueId: "dialogue-1",
    idempotencyKey: "1c2d3e4f-5061-4789-8abc-def012345678",
    name: "sample.fastq.gz",
    size: 6,
    type: "application/gzip",
    lastModified: 123,
    partSize: 0,
    partCount: 0,
    partSizes: [],
    receivedParts: [],
    partDigests: {},
    status: "queued",
    sessionExpiresAt: null,
    ...overrides,
  };
}

function createdRecord(
  overrides: Partial<UploadRecoveryRecord> = {}
): UploadRecoveryRecord {
  return queuedRecord({
    assetId: "file_abc123",
    partSize: 3,
    partCount: 2,
    partSizes: [3, 3],
    receivedParts: [1],
    partDigests: { "1": digest },
    status: "uploading",
    sessionExpiresAt: 2_000,
    ...overrides,
  });
}

class MemoryObjectStore implements UploadObjectStoreAdapter {
  readonly values = new Map<string, unknown>();

  private key(value: readonly [string, string]): string {
    return JSON.stringify(value);
  }

  async get(key: [string, string]): Promise<unknown> {
    return this.values.get(this.key(key));
  }

  async getAll(): Promise<unknown[]> {
    return [...this.values.values()];
  }

  async put(value: unknown): Promise<void> {
    const record = value as UploadRecoveryRecord;
    this.values.set(
      this.key([record.accountScope, record.localId]),
      structuredClone(value)
    );
  }

  async delete(key: [string, string]): Promise<void> {
    this.values.delete(this.key(key));
  }
}

class MemoryDatabase implements UploadDatabaseAdapter {
  readonly objectStore = new MemoryObjectStore();
  readonly transactions: Array<{
    storeName: string;
    mode: "readonly" | "readwrite";
  }> = [];

  transaction(
    storeName: typeof UPLOAD_RECOVERY_STORE_NAME,
    mode: "readonly" | "readwrite"
  ): UploadObjectStoreAdapter {
    this.transactions.push({ storeName, mode });
    return this.objectStore;
  }

  close = vi.fn();
}

describe("non-secret upload recovery store", () => {
  let database: MemoryDatabase;
  let openDatabase: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    database = new MemoryDatabase();
    openDatabase = vi.fn(async (name: string, version: number) => {
      expect(name).toBe(UPLOAD_RECOVERY_DB_NAME);
      expect(version).toBe(UPLOAD_RECOVERY_DB_VERSION);
      return database;
    });
  });

  it("opens the versioned assets store and upserts only allowlisted metadata", async () => {
    const store = createUploadRecoveryStore({ openDatabase });
    await store.upsert(queuedRecord());

    expect(openDatabase).toHaveBeenCalledTimes(1);
    expect(database.transactions[0]).toEqual({
      storeName: UPLOAD_RECOVERY_STORE_NAME,
      mode: "readwrite",
    });
    const raw = [...database.objectStore.values.values()][0] as Record<
      string,
      unknown
    >;
    const forbidden = new Set([
      "file",
      "blob",
      "capability",
      "authorization",
      "uploadUrl",
      "jwt",
      "username",
      "obsPath",
      "objectKey",
      "uploadId",
      "rawError",
    ]);
    const visit = (value: unknown): void => {
      if (Array.isArray(value)) {
        value.forEach(visit);
        return;
      }
      if (typeof value !== "object" || value === null) return;
      for (const [key, child] of Object.entries(value)) {
        expect(forbidden.has(key)).toBe(false);
        visit(child);
      }
    };
    visit(raw);
  });

  it("partitions records by account scope and preserves the idempotency UUID", async () => {
    const store = createUploadRecoveryStore({ openDatabase });
    await store.upsert(queuedRecord());
    await store.upsert(
      queuedRecord({ accountScope: accountB, localId: "local-b" })
    );

    await expect(store.load(accountA, "local-1")).resolves.toMatchObject({
      accountScope: accountA,
      idempotencyKey: "1c2d3e4f-5061-4789-8abc-def012345678",
    });
    await expect(store.list(accountA)).resolves.toHaveLength(1);
    await expect(store.list(accountB)).resolves.toHaveLength(1);
  });

  it("deletes expired active records while retaining completed metadata", async () => {
    let now = 2_000;
    const store = createUploadRecoveryStore({
      openDatabase,
      now: () => now,
    });
    await store.upsert(createdRecord());
    await expect(store.load(accountA, "local-1")).resolves.toBeNull();
    expect(database.objectStore.values.size).toBe(0);

    await store.upsert(
      createdRecord({
        localId: "completed",
        status: "completed",
        sessionExpiresAt: 1,
        receivedParts: [1, 2],
        partDigests: { "1": digest, "2": digest },
      })
    );
    now = 3_000;
    await expect(store.load(accountA, "completed")).resolves.toMatchObject({
      status: "completed",
    });
  });

  it("treats corrupt records as non-resumable and removes them", async () => {
    const store = createUploadRecoveryStore({ openDatabase });
    database.objectStore.values.set(JSON.stringify([accountA, "bad"]), {
      ...queuedRecord({ localId: "bad" }),
      capability: "secret-capability",
    });

    await expect(store.load(accountA, "bad")).resolves.toBeNull();
    expect(
      database.objectStore.values.has(JSON.stringify([accountA, "bad"]))
    ).toBe(false);
  });

  it("rejects digests for parts that the server has not registered", async () => {
    const store = createUploadRecoveryStore({ openDatabase });
    database.objectStore.values.set(JSON.stringify([accountA, "stale"]), {
      ...createdRecord({
        localId: "stale",
        receivedParts: [1],
        partDigests: { "1": digest, "2": digest },
      }),
    });

    await expect(store.load(accountA, "stale")).resolves.toBeNull();
    expect(
      database.objectStore.values.has(JSON.stringify([accountA, "stale"]))
    ).toBe(false);
  });

  it("closes the injected database and allows a fresh reopen", async () => {
    const store = createUploadRecoveryStore({ openDatabase });
    await store.upsert(queuedRecord());
    await store.close();
    expect(database.close).toHaveBeenCalledTimes(1);
    await store.upsert(queuedRecord({ localId: "again" }));
    expect(openDatabase).toHaveBeenCalledTimes(2);
  });
});
