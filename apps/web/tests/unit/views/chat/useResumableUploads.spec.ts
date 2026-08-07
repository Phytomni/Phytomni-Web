import { beforeEach, describe, expect, it, vi } from "vitest";
import { ref } from "vue";
import type { ApiEnvelope, BotUploadCapability } from "@/api/types";
import type { ChatUIState } from "@/views/chat/types";
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
  max_attachments: 10,
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

function fixtureFile(name: string): File {
  return new File(["abc"], name, { type: "application/octet-stream" });
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
  const queue = useResumableUploads({
    currentChatId,
    getChatState,
    uploadCapability: capability,
    username: ref("Researcher@example.org"),
    store,
    random: () => 0.5,
    onValidationError,
  });
  return {
    currentChatId,
    states,
    getChatState,
    capability,
    onValidationError,
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

    await queue.queueFiles([file], "document");
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

    await queue.queueFiles([fixtureFile("a.bam")], "document");
    currentChatId.value = "B";
    await queue.queueFiles([fixtureFile("b.vcf")], "document");

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

  it("moves the engine registry across a temporary-to-canonical dialogue rekey", async () => {
    const { queue, getChatState, states } = setup();
    await queue.queueFiles([fixtureFile("pending.bam")], "document");
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

    await queue.queueFiles([fixtureFile("blocked.fastq")], "document");

    expect(mocks.createUpload).not.toHaveBeenCalled();
    expect(onValidationError).toHaveBeenCalledWith(
      expect.objectContaining({
        code: "upload_disabled",
        fileName: "blocked.fastq",
      })
    );
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

    await queue.queueFiles([fixtureFile("during-switch.fasta")], "document");
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

    await queue.queueFiles(
      [fixtureFile("failed-input.fasta"), fixtureFile("sibling-input.vcf.gz")],
      "document"
    );

    await vi.waitFor(() => {
      expect(getChatState("A").fileList).toHaveLength(2);
      expect(getChatState("A").fileList[0]?.status).toBe("failed");
      expect(getChatState("A").fileList[1]?.status).toBe("completed");
    });
    await queue.dispose();
  });

  it("cancels all incomplete items for one dialogue without touching another", async () => {
    const { queue, getChatState, currentChatId } = setup();
    await queue.queueFiles([fixtureFile("a.fastq")], "document");
    currentChatId.value = "B";
    await queue.queueFiles([fixtureFile("b.fastq")], "document");
    await vi.waitFor(() => {
      expect(getChatState("A").fileList[0]).toBeTruthy();
      expect(getChatState("B").fileList[0]?.status).toBe("completed");
    });

    await queue.cancelDialogue("A");

    expect(getChatState("A").uploadTransfer).toBeNull();
    expect(getChatState("B").fileList[0]?.status).toBe("completed");
    await queue.dispose();
  });

  it("retains distinct purposes selected in separate picker actions", async () => {
    const { queue, getChatState } = setup();

    await queue.queueFiles([fixtureFile("reference.pdf")], "document");
    await queue.queueFiles([fixtureFile("reads.fastq.gz")], "dataset");

    await vi.waitFor(() => {
      expect(getChatState("A").fileList).toHaveLength(2);
      expect(
        getChatState("A").fileList.every((item) => item.status === "completed")
      ).toBe(true);
    });
    expect(getChatState("A").fileList.map((item) => item.purpose)).toEqual([
      "document",
      "dataset",
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

  it("uses a private placeholder instead of legacy recovery purpose", async () => {
    const store = fakeStore();
    const first = setup(store);
    const file = fixtureFile("counts.csv");

    await first.queue.queueFiles([file], "document");
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
      expect.objectContaining({ file: null, purpose: "document" }),
    ]);
    await recovered.queue.dispose();
  });
});
