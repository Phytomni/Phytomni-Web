import { beforeEach, describe, expect, it, vi } from "vitest";

import type {
  UploadControlPlane,
  ResumableUploadEngineDeps,
} from "@/views/chat/upload/engine";
import {
  createResumableUploadEngine,
  type ResumableUploadEngineInput,
} from "@/views/chat/upload/engine";
import type { UploadSession } from "@/api/upload";
import type {
  UploadDataPlane,
  UploadHeadState,
  UploadPartProgress,
} from "@/views/chat/upload/transport";
import { UploadTransportError } from "@/views/chat/upload/transport";
import type {
  UploadRecoveryRecord,
  UploadRecoveryStore,
} from "@/views/chat/upload/store";

const digest = "a".repeat(64);
const accountScope = "a".repeat(64);
const sessionBase: UploadSession = {
  protocol: "obs-multipart-v2",
  asset_id: "file_abc123",
  status: "uploading",
  part_size_bytes: 3,
  part_count: 2,
  max_parallel_parts: 2,
  upload_url: "https://upload.example/v1/files/file_abc123",
  capability: "capability",
  capability_expires_at: "2026-08-01T05:15:00+08:00",
  session_expires_at: "2099-08-08T05:00:00+08:00",
};

function headState(overrides: Partial<UploadHeadState> = {}): UploadHeadState {
  return {
    protocol: "obs-multipart-v2",
    status: "uploading",
    lengthBytes: 6,
    partSizeBytes: 3,
    partCount: 2,
    receivedParts: [],
    retryAfterSeconds: null,
    requestId: null,
    ...overrides,
  };
}

function record(
  overrides: Partial<UploadRecoveryRecord> = {}
): UploadRecoveryRecord {
  return {
    accountScope,
    localId: "local-1",
    assetId: null,
    dialogueId: "dialogue-1",
    idempotencyKey: "1c2d3e4f-5061-4789-8abc-def012345678",
    name: "sample.bin",
    size: 6,
    type: "application/octet-stream",
    lastModified: 1,
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

class MemoryStore implements UploadRecoveryStore {
  readonly values = new Map<string, UploadRecoveryRecord>();

  async upsert(value: UploadRecoveryRecord): Promise<void> {
    this.values.set(
      `${value.accountScope}:${value.localId}`,
      structuredClone(value)
    );
  }

  async load(
    account: string,
    localId: string
  ): Promise<UploadRecoveryRecord | null> {
    return this.values.get(`${account}:${localId}`) ?? null;
  }

  async list(account: string): Promise<UploadRecoveryRecord[]> {
    return [...this.values.values()].filter(
      (value) => value.accountScope === account
    );
  }

  async remove(account: string, localId: string): Promise<void> {
    this.values.delete(`${account}:${localId}`);
  }

  async close(): Promise<void> {}
}

function input(
  file: File | null,
  recovered?: UploadRecoveryRecord
): ResumableUploadEngineInput {
  return {
    localId: "local-1",
    dialogueId: "dialogue-1",
    accountScope,
    file,
    idempotencyKey: "1c2d3e4f-5061-4789-8abc-def012345678",
    recovered,
  };
}

function makeData(
  head: () => Promise<UploadHeadState> | UploadHeadState,
  putPart: UploadDataPlane["putPart"] = async () => undefined,
  complete: UploadDataPlane["complete"] = async () => ({
    asset_id: sessionBase.asset_id,
    status: "completed",
    filename: "sample.bin",
    size_bytes: 6,
    completed_at: "2099-08-01T05:00:00+08:00",
  })
): UploadDataPlane {
  return {
    head: vi.fn(head),
    putPart: vi.fn(putPart),
    complete: vi.fn(complete),
    abort: vi.fn(async () => undefined),
    replaceCapability: vi.fn(),
    clearCapability: vi.fn(),
  };
}

function makeDeps(
  store: MemoryStore,
  data: UploadDataPlane,
  controlOverrides: Partial<UploadControlPlane> = {},
  session: UploadSession = sessionBase
): ResumableUploadEngineDeps {
  return {
    control: {
      create: vi.fn(async () => ({ session, data })),
      renew: vi.fn(async () => ({
        renewal: {
          protocol: "obs-multipart-v2",
          asset_id: session.asset_id,
          status: "uploading",
          upload_url: session.upload_url,
          capability: "fresh-capability",
          capability_expires_at: session.capability_expires_at,
          session_expires_at: session.session_expires_at,
        },
        data,
      })),
      ...controlOverrides,
    },
    data,
    store,
    hashPart: vi.fn(async () => digest),
    now: vi.fn(() => Date.now()),
    random: () => 0,
    sleep: async () => undefined,
  };
}

describe("resumable upload engine", () => {
  let file: File;

  beforeEach(() => {
    file = new File(["abcdef"], "sample.bin", {
      type: "application/octet-stream",
      lastModified: 1,
    });
  });

  it("creates a session, uploads a one-part file, and completes idempotently", async () => {
    const store = new MemoryStore();
    const data = makeData(async () =>
      headState({ partCount: 1, partSizeBytes: 6 })
    );
    const session = {
      ...sessionBase,
      part_size_bytes: 6,
      part_count: 1,
      max_parallel_parts: 1,
    };
    const deps = makeDeps(store, data, {}, session);
    const engine = createResumableUploadEngine(input(file), deps);

    await engine.start();

    expect(engine.snapshot.status).toBe("completed");
    expect(engine.snapshot.loadedBytes).toBe(6);
    expect(engine.snapshot).not.toHaveProperty("purpose");
    expect(data.putPart).toHaveBeenCalledWith(
      1,
      expect.any(Blob),
      digest,
      expect.objectContaining({ onProgress: expect.any(Function) })
    );
    await expect(store.load(accountScope, "local-1")).resolves.toMatchObject({
      status: "completed",
      assetId: "file_abc123",
    });
    expect(await store.load(accountScope, "local-1")).not.toHaveProperty(
      "purpose"
    );
    expect(deps.control.create).toHaveBeenCalledWith(
      {
        filename: "sample.bin",
        size_bytes: 6,
        content_type_hint: "application/octet-stream",
        last_modified_ms: 1,
      },
      expect.any(String)
    );
  });

  it("marks an unknown completion outcome complete when HEAD confirms it", async () => {
    const store = new MemoryStore();
    let headCalls = 0;
    const data = makeData(
      async () => {
        headCalls += 1;
        return headCalls === 1
          ? headState({ partCount: 1, partSizeBytes: 6 })
          : headState({
              status: "completed",
              partCount: 1,
              partSizeBytes: 6,
              receivedParts: [1],
            });
      },
      async () => undefined,
      async () => {
        throw new UploadTransportError("", { status: 502 });
      }
    );
    const deps = makeDeps(
      store,
      data,
      {},
      {
        ...sessionBase,
        part_size_bytes: 6,
        part_count: 1,
        max_parallel_parts: 1,
      }
    );
    deps.retryPolicy = { maxAttempts: 2, baseDelayMs: 0, maxDelayMs: 0 };
    const engine = createResumableUploadEngine(input(file), deps);

    await engine.start();

    expect(engine.snapshot).toMatchObject({
      status: "completed",
      loadedBytes: 6,
      receivedParts: [1],
    });
    expect(data.complete).toHaveBeenCalledTimes(1);
    expect(data.putPart).toHaveBeenCalledTimes(1);
  });

  it("reuses the persisted idempotency key after a lost create response and reload", async () => {
    const store = new MemoryStore();
    const initialInput = input(file);
    const firstData = makeData(async () => headState());
    const firstCreate = vi.fn(async () => {
      throw new UploadTransportError("", { status: 503 });
    });
    const firstEngine = createResumableUploadEngine(
      initialInput,
      makeDeps(store, firstData, { create: firstCreate })
    );

    await firstEngine.start();

    expect(firstEngine.snapshot.status).toBe("failed");
    const persisted = await store.load(accountScope, "local-1");
    expect(persisted).toMatchObject({
      assetId: null,
      idempotencyKey: initialInput.idempotencyKey,
      status: "failed",
    });

    const resumedSession = {
      ...sessionBase,
      part_size_bytes: 6,
      part_count: 1,
      max_parallel_parts: 1,
    };
    const resumedData = makeData(async () =>
      headState({ partCount: 1, partSizeBytes: 6 })
    );
    const resumedCreate = vi.fn(async () => ({
      session: resumedSession,
      data: resumedData,
    }));
    const resumedEngine = createResumableUploadEngine(
      input(file, persisted ?? undefined),
      makeDeps(store, resumedData, { create: resumedCreate }, resumedSession)
    );

    await resumedEngine.start();

    expect(firstCreate).toHaveBeenCalledWith(
      expect.objectContaining({ filename: "sample.bin", size_bytes: 6 }),
      initialInput.idempotencyKey
    );
    expect(resumedCreate).toHaveBeenCalledWith(
      expect.objectContaining({ filename: "sample.bin", size_bytes: 6 }),
      initialInput.idempotencyKey
    );
    expect(firstData.abort).not.toHaveBeenCalled();
    expect(resumedEngine.snapshot.status).toBe("completed");
  });

  it.each([
    {
      status: 409,
      expectedStatus: "failed",
      errorCode: "upload_state_conflict",
    },
    {
      status: 410,
      expectedStatus: "expired",
      errorCode: "upload_session_expired",
    },
  ] as const)(
    "allocates one new idempotency key when explicit retry follows create $status",
    async ({ status, expectedStatus, errorCode }) => {
      const store = new MemoryStore();
      const data = makeData(async () =>
        headState({ partCount: 1, partSizeBytes: 6 })
      );
      const resumedSession = {
        ...sessionBase,
        part_size_bytes: 6,
        part_count: 1,
        max_parallel_parts: 1,
      };
      const create = vi
        .fn()
        .mockRejectedValueOnce(new UploadTransportError("", { status }))
        .mockResolvedValueOnce({ session: resumedSession, data });
      const initialInput = input(file);
      const engine = createResumableUploadEngine(
        initialInput,
        makeDeps(store, data, { create }, resumedSession)
      );

      await engine.start();

      expect(engine.snapshot).toMatchObject({
        status: expectedStatus,
        errorCode,
      });
      expect(create).toHaveBeenCalledTimes(1);
      expect(create.mock.calls[0]?.[1]).toBe(initialInput.idempotencyKey);
      await expect(store.load(accountScope, "local-1")).resolves.toMatchObject({
        idempotencyKey: initialInput.idempotencyKey,
      });

      await engine.retry();

      const retriedKey = create.mock.calls[1]?.[1];
      expect(create).toHaveBeenCalledTimes(2);
      expect(retriedKey).not.toBe(initialInput.idempotencyKey);
      expect(new Set(create.mock.calls.map((call) => call[1])).size).toBe(2);
      expect(engine.snapshot.status).toBe("completed");
      await expect(store.load(accountScope, "local-1")).resolves.toMatchObject({
        idempotencyKey: retriedKey,
      });
    }
  );

  it("keeps a create 413 permanent without automatic retry or key replacement", async () => {
    const store = new MemoryStore();
    const data = makeData(async () => headState());
    const create = vi.fn(async () => {
      throw new UploadTransportError("", { status: 413 });
    });
    const initialInput = input(file);
    const engine = createResumableUploadEngine(
      initialInput,
      makeDeps(store, data, { create })
    );

    await engine.start();

    expect(engine.snapshot).toMatchObject({
      status: "failed",
      errorCode: "upload_limit_exceeded",
    });
    expect(create).toHaveBeenCalledTimes(1);
    expect(create.mock.calls[0]?.[1]).toBe(initialInput.idempotencyKey);
    expect(data.abort).not.toHaveBeenCalled();
    await expect(store.load(accountScope, "local-1")).resolves.toMatchObject({
      idempotencyKey: initialInput.idempotencyKey,
      status: "failed",
    });
  });

  it("aborts the created asset after a permanent part failure and retries with a new session", async () => {
    const store = new MemoryStore();
    const createdSession = {
      ...sessionBase,
      part_size_bytes: 6,
      part_count: 1,
      max_parallel_parts: 1,
    };
    const failedData = makeData(
      async () => headState({ partCount: 1, partSizeBytes: 6, lengthBytes: 6 }),
      async () => {
        throw new UploadTransportError("", {
          status: 400,
          code: "invalid_upload_metadata",
        });
      }
    );
    const retriedSession = {
      ...sessionBase,
      asset_id: "file_retry123",
      upload_url: "https://upload.example/v1/files/file_retry123",
      part_size_bytes: 6,
      part_count: 1,
      max_parallel_parts: 1,
    };
    const retriedData = makeData(
      async () => headState({ partCount: 1, partSizeBytes: 6, lengthBytes: 6 }),
      async () => undefined,
      async () => ({
        asset_id: "file_retry123",
        status: "completed",
        filename: "sample.bin",
        size_bytes: 6,
        completed_at: "2099-08-01T05:00:00+08:00",
      })
    );
    const create = vi
      .fn()
      .mockResolvedValueOnce({ session: createdSession, data: failedData })
      .mockResolvedValueOnce({ session: retriedSession, data: retriedData });
    const initialInput = input(file);
    const engine = createResumableUploadEngine(
      initialInput,
      makeDeps(store, failedData, { create }, createdSession)
    );

    await engine.start();

    expect(engine.snapshot).toMatchObject({
      status: "failed",
      errorCode: "invalid_upload_metadata",
      assetId: null,
    });
    expect(failedData.abort).toHaveBeenCalledTimes(1);
    const persisted = await store.load(accountScope, "local-1");
    expect(persisted).toMatchObject({
      status: "failed",
      assetId: null,
    });
    expect(persisted?.idempotencyKey).not.toBe(initialInput.idempotencyKey);

    await engine.retry();

    expect(create).toHaveBeenCalledTimes(2);
    expect(create.mock.calls[1]?.[1]).toBe(persisted?.idempotencyKey);
    expect(engine.snapshot).toMatchObject({
      status: "completed",
      assetId: "file_retry123",
    });
    expect(retriedData.abort).not.toHaveBeenCalled();
  });

  it("keeps the created asset when abort after failure fails so retry can resume", async () => {
    const store = new MemoryStore();
    const session = {
      ...sessionBase,
      part_size_bytes: 6,
      part_count: 1,
      max_parallel_parts: 1,
    };
    const data = makeData(
      async () => headState({ partCount: 1, partSizeBytes: 6, lengthBytes: 6 }),
      async () => {
        throw new UploadTransportError("", {
          status: 400,
          code: "invalid_upload_metadata",
        });
      }
    );
    data.abort = vi.fn(async () => {
      throw new UploadTransportError("", { status: 401 });
    });
    const engine = createResumableUploadEngine(
      input(file),
      makeDeps(store, data, {}, session)
    );

    await engine.start();

    expect(engine.snapshot).toMatchObject({
      status: "failed",
      assetId: session.asset_id,
    });
    expect(data.abort).toHaveBeenCalledTimes(1);
    await expect(store.load(accountScope, "local-1")).resolves.toMatchObject({
      status: "failed",
      assetId: session.asset_id,
      idempotencyKey: "1c2d3e4f-5061-4789-8abc-def012345678",
    });
  });

  it("limits simultaneous part transfers to the server maximum", async () => {
    const store = new MemoryStore();
    let active = 0;
    let maximum = 0;
    const data = makeData(
      async () =>
        headState({
          lengthBytes: 12,
          partSizeBytes: 3,
          partCount: 4,
        }),
      async () => {
        active += 1;
        maximum = Math.max(maximum, active);
        await new Promise((resolve) => setTimeout(resolve, 1));
        active -= 1;
      },
      async () => ({
        asset_id: sessionBase.asset_id,
        status: "completed",
        filename: "sample.bin",
        size_bytes: 12,
        completed_at: "2099-08-01T05:00:00+08:00",
      })
    );
    const engine = createResumableUploadEngine(
      input(
        new File(["abcdefghijkl"], "sample.bin", {
          type: "application/octet-stream",
          lastModified: 1,
        })
      ),
      makeDeps(
        store,
        data,
        {},
        { ...sessionBase, part_count: 4, max_parallel_parts: 2 }
      )
    );

    await engine.start();

    expect(maximum).toBe(2);
    expect(engine.snapshot.receivedParts).toEqual([1, 2, 3, 4]);
  });

  it("lowers concurrency to the browser memory budget", async () => {
    const store = new MemoryStore();
    let active = 0;
    let maximum = 0;
    const data = makeData(
      async () =>
        headState({
          lengthBytes: 12,
          partSizeBytes: 3,
          partCount: 4,
        }),
      async () => {
        active += 1;
        maximum = Math.max(maximum, active);
        await new Promise((resolve) => setTimeout(resolve, 1));
        active -= 1;
      },
      async () => ({
        asset_id: sessionBase.asset_id,
        status: "completed",
        filename: "sample.bin",
        size_bytes: 12,
        completed_at: "2099-08-01T05:00:00+08:00",
      })
    );
    const deps = makeDeps(
      store,
      data,
      {},
      { ...sessionBase, part_count: 4, max_parallel_parts: 4 }
    );
    deps.browserMemoryLimit = 1;
    const engine = createResumableUploadEngine(
      input(
        new File(["abcdefghijkl"], "sample.bin", {
          type: "application/octet-stream",
          lastModified: 1,
        })
      ),
      deps
    );

    await engine.start();

    expect(maximum).toBe(1);
  });

  it("rejects HEAD session drift before uploading any part", async () => {
    const store = new MemoryStore();
    const data = makeData(async () =>
      headState({ partSizeBytes: 2, status: "paused" })
    );
    const engine = createResumableUploadEngine(
      input(file),
      makeDeps(store, data)
    );

    await engine.start();

    expect(engine.snapshot).toMatchObject({
      status: "failed",
      errorCode: "upload_session_mismatch",
    });
    expect(data.putPart).not.toHaveBeenCalled();
  });

  it("does not persist a digest until the part is registered", async () => {
    const store = new MemoryStore();
    const data = makeData(
      async () => headState({ partCount: 1, partSizeBytes: 6 }),
      async () => {
        throw new UploadTransportError("", { status: 503 });
      }
    );
    const deps = makeDeps(
      store,
      data,
      {},
      {
        ...sessionBase,
        part_size_bytes: 6,
        part_count: 1,
        max_parallel_parts: 1,
      }
    );
    deps.retryPolicy = { maxAttempts: 1, baseDelayMs: 0, maxDelayMs: 0 };
    const engine = createResumableUploadEngine(input(file), deps);

    await engine.start();

    expect(engine.snapshot.status).toBe("failed");
    await expect(store.load(accountScope, "local-1")).resolves.toMatchObject({
      receivedParts: [],
      partDigests: {},
    });
  });

  it("pauses in-flight work and resumes without aborting the server asset", async () => {
    const store = new MemoryStore();
    let ready!: () => void;
    const readyPromise = new Promise<void>((resolve) => {
      ready = resolve;
    });
    const data = makeData(
      async () => headState({ partCount: 1, partSizeBytes: 6 }),
      async (_part, _body, _digest, options) => {
        await new Promise<void>((_resolve, reject) => {
          ready();
          if (options?.signal?.aborted) {
            reject(new DOMException("Upload aborted", "AbortError"));
            return;
          }
          options?.signal?.addEventListener("abort", () => {
            reject(new DOMException("Upload aborted", "AbortError"));
          });
        });
      }
    );
    const engine = createResumableUploadEngine(
      input(file),
      makeDeps(
        store,
        data,
        {},
        {
          ...sessionBase,
          part_size_bytes: 6,
          part_count: 1,
          max_parallel_parts: 1,
        }
      )
    );
    const running = engine.start();
    await readyPromise;
    engine.pause();
    await running;
    expect(engine.snapshot.status).toBe("paused");
    expect(data.abort).not.toHaveBeenCalled();
    await expect(store.load(accountScope, "local-1")).resolves.toMatchObject({
      idempotencyKey: input(file).idempotencyKey,
    });

    (data.putPart as ReturnType<typeof vi.fn>).mockImplementationOnce(
      async (
        _part: number,
        _body: Blob,
        _digest: string,
        options?: { onProgress?: (value: UploadPartProgress) => void }
      ) => {
        options?.onProgress?.({ loaded: 6, total: 6 });
      }
    );
    await engine.resume();
    expect(engine.snapshot.status).toBe("completed");
  });

  it("retries a rate-limited part with Retry-After and real progress", async () => {
    const store = new MemoryStore();
    let attempts = 0;
    const data = makeData(
      async () => headState({ partCount: 1, partSizeBytes: 6 }),
      async (_part, _body, _digest, options) => {
        attempts += 1;
        if (attempts === 1) {
          throw new UploadTransportError("", {
            status: 429,
            retryAfterSeconds: 1,
          });
        }
        options?.onProgress?.({ loaded: 6, total: 6 });
      }
    );
    const sleep = vi.fn(async () => undefined);
    const deps = makeDeps(store, data);
    (deps.control.create as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      session: {
        ...sessionBase,
        part_size_bytes: 6,
        part_count: 1,
        max_parallel_parts: 1,
      },
      data,
    });
    deps.sleep = sleep;
    const engine = createResumableUploadEngine(input(file), deps);

    await engine.start();

    expect(attempts).toBe(2);
    expect(sleep).toHaveBeenCalledTimes(1);
    expect(engine.snapshot.retryCount).toBe(1);
  });

  it("retries a checksum mismatch without committing the failed part", async () => {
    const store = new MemoryStore();
    let attempts = 0;
    const data = makeData(
      async () => headState({ partCount: 1, partSizeBytes: 6 }),
      async (_part, _body, _digest, options) => {
        attempts += 1;
        if (attempts === 1) {
          throw new UploadTransportError("", { status: 422 });
        }
        options?.onProgress?.({ loaded: 6, total: 6 });
      }
    );
    const deps = makeDeps(
      store,
      data,
      {},
      {
        ...sessionBase,
        part_size_bytes: 6,
        part_count: 1,
        max_parallel_parts: 1,
      }
    );
    deps.retryPolicy = { maxAttempts: 2, baseDelayMs: 0, maxDelayMs: 0 };

    const engine = createResumableUploadEngine(input(file), deps);
    await engine.start();

    expect(engine.snapshot).toMatchObject({
      status: "completed",
      receivedParts: [1],
      retryCount: 1,
    });
    expect(attempts).toBe(2);
    await expect(store.load(accountScope, "local-1")).resolves.toMatchObject({
      receivedParts: [1],
      partDigests: { "1": digest },
    });
  });

  it("marks an expired session without retrying the part", async () => {
    const store = new MemoryStore();
    const data = makeData(
      async () => headState({ partCount: 1, partSizeBytes: 6 }),
      async () => {
        throw new UploadTransportError("", { status: 410 });
      }
    );
    const deps = makeDeps(
      store,
      data,
      {},
      {
        ...sessionBase,
        part_size_bytes: 6,
        part_count: 1,
        max_parallel_parts: 1,
      }
    );
    deps.retryPolicy = { maxAttempts: 3, baseDelayMs: 0, maxDelayMs: 0 };
    const engine = createResumableUploadEngine(input(file), deps);

    await engine.start();

    expect(data.putPart).toHaveBeenCalledTimes(1);
    expect(engine.snapshot).toMatchObject({
      status: "expired",
      errorCode: "upload_session_expired",
    });
  });

  it("renews a capability once after a 401 and resumes the part", async () => {
    const store = new MemoryStore();
    const firstData = makeData(
      async () => headState({ partCount: 1, partSizeBytes: 6 }),
      async () => {
        throw new UploadTransportError("", { status: 401 });
      }
    );
    const renewedData = makeData(
      async () => headState({ partCount: 1, partSizeBytes: 6 }),
      async (_part, _body, _digest, options) => {
        options?.onProgress?.({ loaded: 6, total: 6 });
      }
    );
    const deps = makeDeps(store, firstData, {
      renew: vi.fn(async () => ({
        renewal: {
          protocol: "obs-multipart-v2",
          asset_id: sessionBase.asset_id,
          status: "uploading",
          upload_url: sessionBase.upload_url,
          capability: "fresh-capability",
          capability_expires_at: sessionBase.capability_expires_at,
          session_expires_at: sessionBase.session_expires_at,
        },
        data: renewedData,
      })),
    });
    (deps.control.create as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      session: {
        ...sessionBase,
        part_size_bytes: 6,
        part_count: 1,
        max_parallel_parts: 1,
      },
      data: firstData,
    });
    const engine = createResumableUploadEngine(input(file), deps);

    await engine.start();

    expect(deps.control.renew).toHaveBeenCalledTimes(1);
    expect(renewedData.putPart).toHaveBeenCalledTimes(1);
    expect(engine.snapshot.status).toBe("completed");
  });

  it("stops when a reselected file no longer matches a registered digest", async () => {
    const store = new MemoryStore();
    const recovered = record({
      assetId: sessionBase.asset_id,
      partSize: 3,
      partCount: 2,
      partSizes: [3, 3],
      receivedParts: [1],
      partDigests: { "1": digest },
      status: "uploading",
      sessionExpiresAt: Date.now() + 10_000,
    });
    const data = makeData(async () => headState({ receivedParts: [1] }));
    const deps = makeDeps(store, data);
    deps.hashPart = vi.fn(async () => "b".repeat(64));
    const engine = createResumableUploadEngine(input(file, recovered), deps);

    await engine.start();

    expect(engine.snapshot).toMatchObject({
      status: "failed",
      errorCode: "upload_file_changed",
    });
    expect(data.putPart).not.toHaveBeenCalled();
  });

  it("resumes a recovered asset from verified local part digests", async () => {
    const store = new MemoryStore();
    const putPart = vi.fn(
      async (
        part: number,
        body: Blob,
        _sha256: string,
        options?: { onProgress?: (value: UploadPartProgress) => void }
      ) => {
        options?.onProgress?.({ loaded: body.size, total: body.size });
        expect(part).toBe(2);
      }
    );
    const data = makeData(
      async () => headState({ receivedParts: [1] }),
      putPart
    );
    const recovered = record({
      assetId: sessionBase.asset_id,
      partSize: 3,
      partCount: 2,
      partSizes: [3, 3],
      receivedParts: [1],
      partDigests: { "1": digest },
      status: "uploading",
      sessionExpiresAt: Date.now() + 10_000,
    });
    const deps = makeDeps(store, data);
    const engine = createResumableUploadEngine(input(file, recovered), deps);

    await engine.start();

    expect(deps.control.create).not.toHaveBeenCalled();
    expect(putPart).toHaveBeenCalledTimes(1);
    expect(engine.snapshot).toMatchObject({
      status: "completed",
      receivedParts: [1, 2],
      loadedBytes: 6,
    });
  });

  it("re-sends a server part when its local recovery digest is missing", async () => {
    const store = new MemoryStore();
    const putParts: number[] = [];
    const data = makeData(
      async () => headState({ receivedParts: [1] }),
      async (part, body, _sha256, options) => {
        putParts.push(part);
        options?.onProgress?.({ loaded: body.size, total: body.size });
      }
    );
    const recovered = record({
      assetId: sessionBase.asset_id,
      partSize: 3,
      partCount: 2,
      partSizes: [3, 3],
      receivedParts: [1],
      partDigests: {},
      status: "uploading",
      sessionExpiresAt: Date.now() + 10_000,
    });
    const engine = createResumableUploadEngine(
      input(file, recovered),
      makeDeps(store, data)
    );

    await engine.start();

    expect(putParts).toEqual([1, 2]);
    expect(engine.snapshot.status).toBe("completed");
  });

  it("cancels best-effort and clears the local recovery record", async () => {
    const store = new MemoryStore();
    let ready!: () => void;
    const readyPromise = new Promise<void>((resolve) => {
      ready = resolve;
    });
    const data = makeData(
      async () => headState({ partCount: 1, partSizeBytes: 6 }),
      async (_part, _body, _digest, options) =>
        new Promise<void>((_resolve, reject) => {
          ready();
          if (options?.signal?.aborted) {
            reject(new DOMException("Upload aborted", "AbortError"));
            return;
          }
          options?.signal?.addEventListener("abort", () => {
            reject(new DOMException("Upload aborted", "AbortError"));
          });
        })
    );
    const engine = createResumableUploadEngine(
      input(file),
      makeDeps(
        store,
        data,
        {},
        {
          ...sessionBase,
          part_size_bytes: 6,
          part_count: 1,
          max_parallel_parts: 1,
        }
      )
    );
    const running = engine.start();
    await readyPromise;
    await engine.cancel();
    await running;

    expect(engine.snapshot.status).toBe("aborted");
    expect(data.abort).toHaveBeenCalledTimes(1);
    await expect(store.load(accountScope, "local-1")).resolves.toBeNull();
  });

  it("fences progress callbacks after cancellation", async () => {
    const store = new MemoryStore();
    let ready!: () => void;
    let finish!: () => void;
    let progress: ((value: UploadPartProgress) => void) | undefined;
    const readyPromise = new Promise<void>((resolve) => {
      ready = resolve;
    });
    const data = makeData(
      async () => headState({ partCount: 1, partSizeBytes: 6 }),
      async (_part, _body, _digest, options) =>
        new Promise<void>((resolve) => {
          progress = options?.onProgress;
          finish = resolve;
          ready();
        })
    );
    const engine = createResumableUploadEngine(
      input(file),
      makeDeps(
        store,
        data,
        {},
        {
          ...sessionBase,
          part_size_bytes: 6,
          part_count: 1,
          max_parallel_parts: 1,
        }
      )
    );
    const running = engine.start();
    await readyPromise;
    await engine.cancel();
    progress?.({ loaded: 6, total: 6 });
    finish();
    await running;

    expect(engine.snapshot).toMatchObject({
      status: "aborted",
      loadedBytes: 0,
    });
  });

  it("fences a late completion response after cancellation", async () => {
    const store = new MemoryStore();
    let completeStarted!: () => void;
    let resolveComplete!: (value: {
      asset_id: string;
      status: "completed";
      filename: string;
      size_bytes: number;
      completed_at: string;
    }) => void;
    const completeReady = new Promise<void>((resolve) => {
      completeStarted = resolve;
    });
    const completion = new Promise<{
      asset_id: string;
      status: "completed";
      filename: string;
      size_bytes: number;
      completed_at: string;
    }>((resolve) => {
      resolveComplete = resolve;
    });
    const data = makeData(
      async () => headState({ partCount: 1, partSizeBytes: 6 }),
      async (_part, body, _digest, options) => {
        options?.onProgress?.({ loaded: body.size, total: body.size });
      },
      async () => {
        completeStarted();
        return completion;
      }
    );
    const engine = createResumableUploadEngine(
      input(file),
      makeDeps(
        store,
        data,
        {},
        {
          ...sessionBase,
          part_size_bytes: 6,
          part_count: 1,
          max_parallel_parts: 1,
        }
      )
    );
    const running = engine.start();
    await completeReady;
    await engine.cancel();
    resolveComplete({
      asset_id: sessionBase.asset_id,
      status: "completed",
      filename: "sample.bin",
      size_bytes: 6,
      completed_at: "2099-08-01T05:00:00+08:00",
    });
    await running;

    expect(engine.snapshot.status).toBe("aborted");
    await expect(store.load(accountScope, "local-1")).resolves.toBeNull();
  });

  it("aborts a resource created after the user cancels", async () => {
    const store = new MemoryStore();
    let resolveCreate!: (value: {
      session: UploadSession;
      data: UploadDataPlane;
    }) => void;
    const createPromise = new Promise<{
      session: UploadSession;
      data: UploadDataPlane;
    }>((resolve) => {
      resolveCreate = resolve;
    });
    const data = makeData(async () =>
      headState({ partCount: 1, partSizeBytes: 6 })
    );
    const deps = makeDeps(store, data, {
      create: vi.fn(() => createPromise),
    });
    const engine = createResumableUploadEngine(input(file), deps);
    const running = engine.start();
    await Promise.resolve();
    await engine.cancel();
    resolveCreate({
      session: {
        ...sessionBase,
        part_size_bytes: 6,
        part_count: 1,
        max_parallel_parts: 1,
      },
      data,
    });
    await running;

    expect(data.abort).toHaveBeenCalledTimes(1);
    expect(engine.snapshot.status).toBe("aborted");
  });

  it("recreates an asset after an incompatible part conflict", async () => {
    const store = new MemoryStore();
    const data = makeData(
      async () => headState({ partCount: 1, partSizeBytes: 6 }),
      async () => {
        if (
          (data.putPart as ReturnType<typeof vi.fn>).mock.calls.length === 1
        ) {
          throw new UploadTransportError("", { status: 409 });
        }
      }
    );
    const deps = makeDeps(
      store,
      data,
      {},
      {
        ...sessionBase,
        part_size_bytes: 6,
        part_count: 1,
        max_parallel_parts: 1,
      }
    );
    deps.retryPolicy = { maxAttempts: 1, baseDelayMs: 0, maxDelayMs: 0 };
    const engine = createResumableUploadEngine(input(file), deps);

    await engine.start();
    expect(engine.snapshot.errorCode).toBe("upload_state_conflict");
    await engine.retry();

    expect(data.abort).toHaveBeenCalledTimes(1);
    expect(deps.control.create).toHaveBeenCalledTimes(2);
    expect(engine.snapshot.status).toBe("completed");
  });
});
