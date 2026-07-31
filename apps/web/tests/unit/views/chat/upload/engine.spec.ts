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
    const engine = createResumableUploadEngine(
      input(file),
      makeDeps(store, data, {}, session)
    );

    await engine.start();

    expect(engine.snapshot.status).toBe("completed");
    expect(engine.snapshot.loadedBytes).toBe(6);
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
});
