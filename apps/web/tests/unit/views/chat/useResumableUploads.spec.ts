import { beforeEach, describe, expect, it, vi } from "vitest";
import { ref } from "vue";
import type { ApiEnvelope, BotUploadCapability } from "@/api/types";
import type { ChatUIState } from "@/views/chat/types";
import type { ResumableUploadItem } from "@/views/chat/upload/types";
import { buildChatState } from "../../../helpers/chatBuilders";
import type {
  UploadRecoveryRecord,
  UploadRecoveryStore,
} from "@/views/chat/upload/store";
import type { UploadDataPlane } from "@/views/chat/upload/transport";
import { useResumableUploads } from "@/views/chat/composables/useResumableUploads";

const mocks = vi.hoisted(() => {
  class HoistedUploadTransportError extends Error {
    status: number | null;
    code: string;
    retryAfterSeconds: number | null;

    constructor(
      message: string,
      options: {
        status?: number | null;
        code?: string;
        retryAfterSeconds?: number | null;
      } = {}
    ) {
      super(message);
      this.status = options.status ?? null;
      this.code = options.code ?? "upload_transport_error";
      this.retryAfterSeconds = options.retryAfterSeconds ?? null;
    }
  }
  return {
    createUpload: vi.fn(),
    renewUploadCapability: vi.fn(),
    createUploadDataPlane: vi.fn(),
    UploadTransportError: HoistedUploadTransportError,
  };
});

vi.mock("@/api/upload", () => ({
  RESUMABLE_UPLOAD_PROTOCOL: "obs-multipart-v2",
  RESUMABLE_UPLOAD_MAX_BYTES: 10 * 1024 * 1024 * 1024,
  RESUMABLE_UPLOAD_MAX_PART_COUNT: 100_000,
  RESUMABLE_UPLOAD_MAX_PARALLEL_PARTS: 4,
  createUpload: mocks.createUpload,
  renewUploadCapability: mocks.renewUploadCapability,
}));

vi.mock("@/views/chat/upload/transport", () => ({
  UploadTransportError: mocks.UploadTransportError,
  createUploadDataPlane: mocks.createUploadDataPlane,
}));

const enabledCapability: BotUploadCapability = {
  enabled: true,
  protocol: "obs-multipart-v2",
  upload_origin: "https://upload.example",
  max_file_bytes: 10 * 1024 * 1024 * 1024,
  max_attachments: 64,
};

function session(assetId: string, size: number) {
  return {
    protocol: "obs-multipart-v2" as const,
    asset_id: assetId,
    status: "uploading",
    part_size_bytes: size,
    part_count: 1,
    max_parallel_parts: 1,
    upload_url: "https://upload.example/files/part",
    capability: "opaque-capability",
    capability_expires_at: "2099-01-01T00:00:00.000Z",
    session_expires_at: "2099-01-02T00:00:00.000Z",
  };
}

function response<T>(data: T): ApiEnvelope<T> {
  return { code: 200, data };
}

function fakeStore(
  initialRecords: readonly UploadRecoveryRecord[] = []
): UploadRecoveryStore {
  const records = new Map<string, UploadRecoveryRecord>();
  for (const record of initialRecords) {
    records.set(`${record.accountScope}:${record.localId}`, record);
  }
  return {
    upsert: vi.fn(async (record) => {
      records.set(`${record.accountScope}:${record.localId}`, record);
    }),
    load: vi.fn(
      async (accountScope, localId) =>
        records.get(`${accountScope}:${localId}`) ?? null
    ),
    list: vi.fn(async (accountScope) =>
      [...records.values()].filter(
        (record) => record.accountScope === accountScope
      )
    ),
    remove: vi.fn(async (accountScope, localId) => {
      records.delete(`${accountScope}:${localId}`);
    }),
    close: vi.fn(async () => undefined),
  };
}

function fakeDataPlane(): UploadDataPlane {
  return {
    head: vi.fn(async () => ({
      protocol: "obs-multipart-v2" as const,
      status: "uploading",
      lengthBytes: 3,
      partSizeBytes: 3,
      partCount: 1,
      receivedParts: [],
      retryAfterSeconds: null,
      requestId: null,
    })),
    putPart: vi.fn(async (_part, body, _digest, options) => {
      options?.onProgress?.({ loaded: body.size, total: body.size });
    }),
    complete: vi.fn(async () => ({
      asset_id: "file_fixture",
      status: "completed" as const,
      filename: "fixture",
      size_bytes: 3,
      completed_at: "2099-01-01T00:00:00.000Z",
    })),
    abort: vi.fn(async () => undefined),
    replaceCapability: vi.fn(),
    clearCapability: vi.fn(),
  };
}

function fixtureFile(
  name: string,
  options: { content?: string; type?: string; lastModified?: number } = {}
): File {
  return new File([options.content ?? "abc"], name, {
    type: options.type ?? "application/octet-stream",
    lastModified: options.lastModified ?? 1_786_032_000_000,
  });
}

function retainedItem(
  file: File,
  status: ResumableUploadItem["status"],
  localId: string
): ResumableUploadItem {
  return {
    localId,
    file,
    assetId: status === "completed" ? `file_${localId}` : null,
    name: file.name.normalize("NFC"),
    size: file.size,
    type: file.type,
    lastModified: file.lastModified,
    status,
    partSize: file.size,
    partCount: 1,
    receivedParts: status === "completed" ? [1] : [],
    loadedBytes: status === "completed" ? file.size : 0,
    speedBytesPerSecond: 0,
    etaSeconds: null,
    retryCount: 0,
    errorCode: null,
  };
}

function setup(store = fakeStore()) {
  const currentChatId = ref("A");
  const states = new Map<string, ChatUIState>();
  const getChatState = (dialogueId: string): ChatUIState => {
    let state = states.get(dialogueId);
    if (!state) {
      state = buildChatState();
      states.set(dialogueId, state);
    }
    return state;
  };
  const capability = ref<BotUploadCapability>(enabledCapability);
  const onValidationError = vi.fn();
  const onDuplicate = vi.fn();
  const queue = useResumableUploads({
    currentChatId,
    getChatState,
    uploadCapability: capability,
    username: ref("Researcher@example.org"),
    store,
    random: () => 0.5,
    onValidationError,
    onDuplicate,
  });
  return {
    currentChatId,
    states,
    getChatState,
    capability,
    onValidationError,
    onDuplicate,
    store,
    queue,
  };
}

describe("useResumableUploads", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    const data = fakeDataPlane();
    mocks.createUpload.mockImplementation(
      async (metadata: { size_bytes: number }) =>
        response(session("file_fixture", metadata.size_bytes))
    );
    mocks.renewUploadCapability.mockResolvedValue(
      response(session("file_fixture", 3))
    );
    mocks.createUploadDataPlane.mockReturnValue(data);
  });

  it("queues an arbitrary biological file and keeps aggregate progress in its dialogue state", async () => {
    const { queue, getChatState, currentChatId } = setup();
    const file = fixtureFile("reads.fastq.gz");

    await queue.queueFiles([file]);
    await vi.waitFor(() => {
      expect(getChatState("A").fileList[0]?.status).toBe("completed");
    });

    expect(currentChatId.value).toBe("A");
    expect(getChatState("A").fileList[0]).toEqual(
      expect.objectContaining({
        name: "reads.fastq.gz",
        assetId: "file_fixture",
      })
    );
    expect(getChatState("A").uploadTransfer).toBeNull();
    expect(mocks.createUpload).toHaveBeenCalledTimes(1);
    await queue.dispose();
  });

  it("isolates simultaneous A/B queues and aggregate snapshots", async () => {
    const { queue, getChatState, currentChatId } = setup();

    await queue.queueFiles([fixtureFile("a.bam")]);
    currentChatId.value = "B";
    await queue.queueFiles([fixtureFile("b.vcf")]);

    await vi.waitFor(() => {
      expect(getChatState("A").fileList[0]?.status).toBe("completed");
      expect(getChatState("B").fileList[0]?.status).toBe("completed");
    });
    expect(getChatState("A").fileList[0]?.name).toBe("a.bam");
    expect(getChatState("B").fileList[0]?.name).toBe("b.vcf");
    expect(getChatState("A").uploadTransfer).toBeNull();
    expect(getChatState("B").uploadTransfer).toBeNull();
    expect(mocks.createUpload).toHaveBeenCalledTimes(2);
    await queue.dispose();
  });

  it("deduplicates a normalized tuple before engine creation and ignores MIME differences", async () => {
    const { queue, getChatState, onDuplicate, onValidationError } = setup();
    const decomposed = fixtureFile("cafe\u0301.csv", {
      type: "text/csv",
      lastModified: 42,
    });
    const composed = fixtureFile("caf\u00e9.csv", {
      type: "application/octet-stream",
      lastModified: 42,
    });

    await queue.queueFiles([decomposed]);
    await vi.waitFor(() => {
      expect(getChatState("A").fileList[0]?.status).toBe("completed");
    });
    const existing = getChatState("A").fileList[0];
    await queue.queueFiles([composed]);

    expect(getChatState("A").fileList).toHaveLength(1);
    expect(mocks.createUpload).toHaveBeenCalledTimes(1);
    expect(onDuplicate).toHaveBeenCalledWith(
      existing?.localId,
      "caf\u00e9.csv"
    );
    expect(onValidationError).not.toHaveBeenCalled();
    await queue.dispose();
  });

  it.each([
    "queued",
    "creating",
    "uploading",
    "paused",
    "completed",
    "failed",
    "completing",
    "aborted",
    "expired",
  ] as const)(
    "keeps a retained %s item authoritative for draft deduplication",
    async (status) => {
      const { queue, getChatState, onDuplicate, onValidationError } = setup();
      const file = fixtureFile("retained.fastq.gz", { lastModified: 77 });
      getChatState("A").fileList = [
        retainedItem(file, status, `retained-${status}`),
      ];

      await queue.queueFiles([
        fixtureFile("retained.fastq.gz", {
          type: "application/gzip",
          lastModified: 77,
        }),
      ]);

      expect(mocks.createUpload).not.toHaveBeenCalled();
      expect(onDuplicate).toHaveBeenCalledWith(
        `retained-${status}`,
        "retained.fastq.gz"
      );
      expect(onValidationError).not.toHaveBeenCalled();
      await queue.dispose();
    }
  );

  it("checks duplicates before the retained attachment limit", async () => {
    const { queue, getChatState, onDuplicate, onValidationError } = setup();
    const duplicate = fixtureFile("duplicate-at-limit.bam", {
      lastModified: 88,
    });
    getChatState("A").fileList = Array.from({ length: 64 }, (_, index) =>
      retainedItem(
        index === 4
          ? duplicate
          : fixtureFile(`existing-${index}.bam`, { lastModified: index }),
        "completed",
        `existing-${index}`
      )
    );

    await queue.queueFiles([
      fixtureFile("duplicate-at-limit.bam", {
        type: "application/x-bam",
        lastModified: 88,
      }),
    ]);

    expect(onDuplicate).toHaveBeenCalledWith(
      "existing-4",
      "duplicate-at-limit.bam"
    );
    expect(onValidationError).not.toHaveBeenCalled();
    expect(mocks.createUpload).not.toHaveBeenCalled();
    await queue.dispose();
  });

  it("accepts attachment 64 and rejects attachment 65 from the negotiated capability", async () => {
    const { queue, getChatState, onValidationError } = setup();
    getChatState("A").fileList = Array.from({ length: 63 }, (_, index) =>
      retainedItem(
        fixtureFile(`existing-${index}.bam`, { lastModified: index }),
        "completed",
        `existing-${index}`
      )
    );

    await queue.queueFiles([
      fixtureFile("attachment-64.bam", { lastModified: 64 }),
    ]);
    await vi.waitFor(() => {
      expect(getChatState("A").fileList).toHaveLength(64);
    });
    expect(onValidationError).not.toHaveBeenCalled();

    await queue.queueFiles([
      fixtureFile("attachment-65.bam", { lastModified: 65 }),
    ]);

    expect(getChatState("A").fileList).toHaveLength(64);
    expect(onValidationError).toHaveBeenCalledWith({
      code: "too_many_files",
      fileName: "attachment-65.bam",
    });
    await queue.dispose();
  });

  it("creates new tasks for a different normalized name, size, or last-modified time", async () => {
    const { queue, getChatState, onDuplicate } = setup();

    await queue.queueFiles([
      fixtureFile("sample-a.csv", { content: "abc", lastModified: 1 }),
      fixtureFile("sample-b.csv", { content: "abc", lastModified: 1 }),
      fixtureFile("sample-a.csv", { content: "abcd", lastModified: 1 }),
      fixtureFile("sample-a.csv", { content: "abc", lastModified: 2 }),
    ]);

    await vi.waitFor(() => {
      expect(getChatState("A").fileList).toHaveLength(4);
      expect(mocks.createUpload).toHaveBeenCalledTimes(4);
    });
    expect(mocks.createUpload).toHaveBeenCalledTimes(4);
    expect(onDuplicate).not.toHaveBeenCalled();
    await queue.dispose();
  });

  it("scopes duplicate tuples to the current dialogue and allows them after removal", async () => {
    const { queue, getChatState, currentChatId, onDuplicate } = setup();
    const file = fixtureFile("scoped.vcf.gz", { lastModified: 99 });

    await queue.queueFiles([file]);
    await vi.waitFor(() => {
      expect(getChatState("A").fileList[0]?.status).toBe("completed");
    });
    await queue.queueFiles([file]);
    expect(onDuplicate).toHaveBeenCalledTimes(1);

    currentChatId.value = "B";
    await queue.queueFiles([file]);
    await vi.waitFor(() => {
      expect(getChatState("B").fileList[0]?.status).toBe("completed");
    });
    expect(mocks.createUpload).toHaveBeenCalledTimes(2);

    await queue.removeUpload(getChatState("B").fileList[0]);
    await queue.queueFiles([file]);
    await vi.waitFor(() => {
      expect(getChatState("B").fileList[0]?.status).toBe("completed");
    });
    expect(mocks.createUpload).toHaveBeenCalledTimes(3);
    await queue.dispose();
  });

  it("moves the engine registry across a temporary-to-canonical dialogue rekey", async () => {
    const { queue, getChatState, states } = setup();
    await queue.queueFiles([fixtureFile("pending.bam")]);
    const sourceState = getChatState("A");
    states.set("server-1", sourceState);
    states.delete("A");
    queue.rekeyDialogue("A", "server-1");

    await vi.waitFor(() => {
      expect(getChatState("server-1").fileList[0]?.status).toBe("completed");
    });
    expect(getChatState("server-1").fileList[0]?.name).toBe("pending.bam");
    await queue.dispose();
  });

  it("does not call the control plane while upload capability is disabled", async () => {
    const { queue, capability, onValidationError } = setup();
    capability.value = {
      ...enabledCapability,
      enabled: false,
      upload_origin: "",
    };

    await queue.queueFiles([fixtureFile("blocked.fastq")]);

    expect(mocks.createUpload).not.toHaveBeenCalled();
    expect(onValidationError).toHaveBeenCalledWith(
      expect.objectContaining({
        code: "upload_disabled",
        fileName: "blocked.fastq",
      })
    );
    await queue.dispose();
  });

  it("rejects files above the negotiated byte limit before creating an upload", async () => {
    const { queue, capability, onValidationError } = setup();
    capability.value = {
      ...enabledCapability,
      max_file_bytes: 2,
    };

    await queue.queueFiles([fixtureFile("oversized.fastq")]);

    expect(mocks.createUpload).not.toHaveBeenCalled();
    expect(onValidationError).toHaveBeenCalledWith({
      code: "invalid_size",
      fileName: "oversized.fastq",
    });
    await queue.dispose();
  });

  it("focuses a retained duplicate even when capability now blocks new uploads", async () => {
    const { queue, capability, getChatState, onDuplicate, onValidationError } =
      setup();
    const file = fixtureFile("retained-after-disable.pdf", {
      lastModified: 55,
    });
    getChatState("A").fileList = [
      retainedItem(file, "completed", "retained-after-disable"),
    ];
    capability.value = {
      ...enabledCapability,
      enabled: false,
      upload_origin: "",
    };

    await queue.queueFiles([file]);

    expect(onDuplicate).toHaveBeenCalledWith(
      "retained-after-disable",
      "retained-after-disable.pdf"
    );
    expect(onValidationError).not.toHaveBeenCalled();
    expect(mocks.createUpload).not.toHaveBeenCalled();
    await queue.dispose();
  });

  it("keeps an active upload running when new uploads are disabled", async () => {
    const { queue, capability, getChatState } = setup();
    const data = fakeDataPlane();
    let release!: () => void;
    let markStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    data.putPart = vi.fn(async (_part, body, _digest, options) => {
      markStarted();
      await gate;
      options?.onProgress?.({ loaded: body.size, total: body.size });
    });
    mocks.createUploadDataPlane.mockReturnValue(data);

    await queue.queueFiles([fixtureFile("during-switch.fasta")]);
    await started;

    capability.value = {
      ...enabledCapability,
      enabled: false,
      upload_origin: "",
    };
    release();

    await vi.waitFor(() => {
      expect(getChatState("A").fileList[0]?.status).toBe("completed");
    });
    expect(mocks.createUpload).toHaveBeenCalledTimes(1);
    expect(data.putPart).toHaveBeenCalledTimes(1);
    await queue.dispose();
  });

  it("pauses an in-flight upload on disposal without aborting its recovery", async () => {
    const store = fakeStore();
    const { queue, getChatState } = setup(store);
    const data = fakeDataPlane();
    let markStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    data.putPart = vi.fn(async (_part, _body, _digest, options) => {
      markStarted();
      await new Promise<void>((_resolve, reject) => {
        if (options?.signal?.aborted) {
          reject(new DOMException("Upload paused", "AbortError"));
          return;
        }
        options?.signal?.addEventListener("abort", () => {
          reject(new DOMException("Upload paused", "AbortError"));
        });
      });
    });
    mocks.createUploadDataPlane.mockReturnValue(data);

    await queue.queueFiles([fixtureFile("recover-after-disposal.fastq")]);
    await started;
    const localId = getChatState("A").fileList[0]?.localId;
    const originalKey = mocks.createUpload.mock.calls[0]?.[1];

    await queue.dispose();

    expect(getChatState("A").fileList[0]?.status).toBe("paused");
    expect(data.abort).not.toHaveBeenCalled();
    expect(store.remove).not.toHaveBeenCalled();
    expect(store.close).toHaveBeenCalledTimes(1);
    expect(store.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        localId,
        idempotencyKey: originalKey,
      })
    );
  });

  it("keeps a late create response recoverable after disposal", async () => {
    const store = fakeStore();
    const { queue, getChatState } = setup(store);
    const data = fakeDataPlane();
    let markCreateStarted!: () => void;
    let resolveCreate!: (
      value: ApiEnvelope<ReturnType<typeof session>>
    ) => void;
    const createStarted = new Promise<void>((resolve) => {
      markCreateStarted = resolve;
    });
    const createResponse = new Promise<ApiEnvelope<ReturnType<typeof session>>>(
      (resolve) => {
        resolveCreate = resolve;
      }
    );
    mocks.createUpload.mockImplementationOnce(async () => {
      markCreateStarted();
      return createResponse;
    });
    mocks.createUploadDataPlane.mockReturnValue(data);

    await queue.queueFiles([fixtureFile("late-create-recovery.fastq")]);
    await createStarted;
    const originalKey = mocks.createUpload.mock.calls[0]?.[1];

    await queue.dispose();
    expect(getChatState("A").fileList[0]?.status).toBe("paused");
    expect(store.remove).not.toHaveBeenCalled();

    resolveCreate(response(session("file_fixture", 3)));
    await vi.waitFor(() => {
      expect(store.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          assetId: "file_fixture",
          idempotencyKey: originalKey,
          status: "paused",
        })
      );
    });

    expect(data.abort).not.toHaveBeenCalled();
    expect(getChatState("A").fileList[0]?.status).toBe("paused");
  });

  it.each(["cancel", "remove"] as const)(
    "keeps explicit %s terminal and clears upload recovery",
    async (action) => {
      const store = fakeStore();
      const { queue, getChatState } = setup(store);
      const data = fakeDataPlane();
      let markStarted!: () => void;
      const started = new Promise<void>((resolve) => {
        markStarted = resolve;
      });
      data.putPart = vi.fn(async (_part, _body, _digest, options) => {
        markStarted();
        await new Promise<void>((_resolve, reject) => {
          if (options?.signal?.aborted) {
            reject(new DOMException("Upload cancelled", "AbortError"));
            return;
          }
          options?.signal?.addEventListener("abort", () => {
            reject(new DOMException("Upload cancelled", "AbortError"));
          });
        });
      });
      mocks.createUploadDataPlane.mockReturnValue(data);

      await queue.queueFiles([fixtureFile(`${action}-upload.fastq`)]);
      await started;
      const item = getChatState("A").fileList[0];
      expect(item).toBeTruthy();

      if (action === "cancel") {
        await queue.cancelUpload(item?.localId ?? "");
      } else if (item) {
        await queue.removeUpload(item);
      }

      expect(data.abort).toHaveBeenCalledTimes(1);
      expect(store.remove).toHaveBeenCalledTimes(1);
      const [accountScope, localId] = (store.remove as ReturnType<typeof vi.fn>)
        .mock.calls[0] ?? ["", ""];
      expect(localId).toBe(item?.localId);
      await expect(store.list(accountScope)).resolves.toEqual([]);
      if (action === "remove") {
        expect(getChatState("A").fileList).toEqual([]);
      } else {
        expect(getChatState("A").fileList[0]?.status).toBe("aborted");
      }
      await queue.dispose();
    }
  );

  it("does not install page lifecycle handlers that can abort uploads", async () => {
    const addEventListener = vi.spyOn(window, "addEventListener");
    const { queue } = setup();

    const registeredEvents = addEventListener.mock.calls.map(
      ([event]) => event
    );
    expect(registeredEvents).not.toContain("beforeunload");
    expect(registeredEvents).not.toContain("pagehide");
    expect(registeredEvents).not.toContain("visibilitychange");

    addEventListener.mockRestore();
    await queue.dispose();
  });

  it("does not pause a completed sibling when another attachment fails", async () => {
    const { queue, getChatState } = setup();
    let planeCount = 0;
    mocks.createUploadDataPlane.mockImplementation(() => {
      planeCount += 1;
      const data = fakeDataPlane();
      if (planeCount === 1) {
        data.putPart = vi.fn(async () => {
          throw new mocks.UploadTransportError("", { status: 413 });
        });
      }
      return data;
    });

    await queue.queueFiles([
      fixtureFile("failed-input.fasta"),
      fixtureFile("sibling-input.vcf.gz"),
    ]);

    await vi.waitFor(() => {
      expect(getChatState("A").fileList).toHaveLength(2);
      expect(getChatState("A").fileList[0]?.status).toBe("failed");
      expect(getChatState("A").fileList[1]?.status).toBe("completed");
    });
    await queue.dispose();
  });

  it("cancels all incomplete items for one dialogue without touching another", async () => {
    const { queue, getChatState, currentChatId, store } = setup();
    const activeData = fakeDataPlane();
    let markStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    activeData.putPart = vi.fn(async (_part, _body, _digest, options) => {
      markStarted();
      await new Promise<void>((_resolve, reject) => {
        if (options?.signal?.aborted) {
          reject(new DOMException("Upload cancelled", "AbortError"));
          return;
        }
        options?.signal?.addEventListener("abort", () => {
          reject(new DOMException("Upload cancelled", "AbortError"));
        });
      });
    });
    const completedData = fakeDataPlane();
    mocks.createUploadDataPlane
      .mockReturnValueOnce(activeData)
      .mockReturnValueOnce(completedData);

    await queue.queueFiles([fixtureFile("a.fastq")]);
    await started;
    currentChatId.value = "B";
    await queue.queueFiles([fixtureFile("b.fastq")]);
    await vi.waitFor(() => {
      expect(getChatState("B").fileList[0]?.status).toBe("completed");
    });

    await queue.cancelDialogue("A");

    expect(getChatState("A").fileList[0]?.status).toBe("aborted");
    expect(getChatState("A").uploadTransfer).toBeNull();
    expect(getChatState("B").fileList[0]?.status).toBe("completed");
    expect(activeData.abort).toHaveBeenCalledTimes(1);
    expect(completedData.abort).not.toHaveBeenCalled();
    expect(store.remove).toHaveBeenCalledTimes(1);
    await queue.dispose();
  });

  it("keeps runtime queue items free of client classification", async () => {
    const { queue, getChatState } = setup();

    await queue.queueFiles([fixtureFile("reference.pdf")]);
    await queue.queueFiles([fixtureFile("reads.fastq.gz")]);

    await vi.waitFor(() => {
      expect(getChatState("A").fileList).toHaveLength(2);
      expect(
        getChatState("A").fileList.every((item) => item.status === "completed")
      ).toBe(true);
    });
    expect(getChatState("A").fileList).toEqual([
      expect.not.objectContaining({ purpose: expect.anything() }),
      expect.not.objectContaining({ purpose: expect.anything() }),
    ]);
    expect(mocks.createUpload).toHaveBeenNthCalledWith(
      1,
      {
        filename: "reference.pdf",
        size_bytes: 3,
        content_type_hint: "application/octet-stream",
        last_modified_ms: expect.any(Number),
      },
      expect.any(String)
    );
    expect(mocks.createUpload).toHaveBeenNthCalledWith(
      2,
      {
        filename: "reads.fastq.gz",
        size_bytes: 3,
        content_type_hint: "application/octet-stream",
        last_modified_ms: expect.any(Number),
      },
      expect.any(String)
    );
    await queue.dispose();
  });

  it("drops legacy recovery purpose from the runtime queue item", async () => {
    const store = fakeStore();
    const first = setup(store);
    const file = fixtureFile("counts.csv");

    await first.queue.queueFiles([file]);
    await vi.waitFor(() => {
      expect(first.getChatState("A").fileList[0]?.status).toBe("completed");
    });
    await first.queue.dispose();

    const persisted = (store.upsert as ReturnType<typeof vi.fn>).mock.calls.at(
      -1
    )?.[0] as UploadRecoveryRecord;
    const legacy = { ...persisted } as unknown as Record<string, unknown>;
    legacy.purpose = "dataset";

    const recovered = setup(
      fakeStore([legacy as unknown as UploadRecoveryRecord])
    );
    await recovered.queue.loadRecovery();
    expect(recovered.getChatState("A").fileList).toEqual([
      expect.objectContaining({ file: null }),
    ]);
    expect(recovered.getChatState("A").fileList[0]).not.toHaveProperty(
      "purpose"
    );
    await recovered.queue.dispose();
  });
});
