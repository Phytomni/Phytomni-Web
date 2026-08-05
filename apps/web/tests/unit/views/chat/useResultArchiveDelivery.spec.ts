import { nextTick } from "vue";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useChatStates } from "@/views/chat/composables/useChatStates";
import { useResultArchiveDelivery } from "@/views/chat/composables/useResultArchiveDelivery";

const mocks = vi.hoisted(() => ({
  retryConversationResultArchive: vi.fn(),
  getConversationArtifactDownloadURL: vi.fn(),
  getConversationArtifactFile: vi.fn(),
  upsertDownloadTransfer: vi.fn(),
  removeDownloadTransfer: vi.fn(),
  saveAs: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
}));

vi.mock("@/api/chat", () => ({
  retryConversationResultArchive: mocks.retryConversationResultArchive,
  getConversationArtifactDownloadURL: mocks.getConversationArtifactDownloadURL,
  getConversationArtifactFile: mocks.getConversationArtifactFile,
}));

vi.mock("@/utils/download-transfers", () => ({
  upsertDownloadTransfer: mocks.upsertDownloadTransfer,
  removeDownloadTransfer: mocks.removeDownloadTransfer,
}));

vi.mock("file-saver", () => ({ saveAs: mocks.saveAs }));
vi.mock("element-plus", () => ({
  ElMessage: { error: mocks.error, info: mocks.info },
}));

const pendingDelivery = {
  schema_version: 1 as const,
  required: true as const,
  status: "pending" as const,
  revision: 2,
  name: null,
  size_bytes: null,
  error_code: null,
  retryable: false,
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((innerResolve, innerReject) => {
    resolve = innerResolve;
    reject = innerReject;
  });
  return { promise, resolve, reject };
}

describe("useResultArchiveDelivery", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("sends one retry per dialogue/message while the request is in flight", async () => {
    const states = useChatStates();
    const delivery = useResultArchiveDelivery({
      getChatState: states.getChatState,
    });
    const request = deferred<{ code: number; data: typeof pendingDelivery }>();
    const onPending = vi.fn();
    mocks.retryConversationResultArchive.mockReturnValueOnce(request.promise);

    const first = delivery.retryResultArchive({
      dialogueId: "dialogue-a",
      messageId: "42",
      onPending,
    });
    const duplicate = delivery.retryResultArchive({
      dialogueId: "dialogue-a",
      messageId: "42",
      onPending,
    });

    expect(mocks.retryConversationResultArchive).toHaveBeenCalledTimes(1);
    expect(mocks.retryConversationResultArchive).toHaveBeenCalledWith({
      dialogue_id: "dialogue-a",
      message_id: "42",
    });
    expect(
      states.getChatState("dialogue-a").archiveRetryingByMessageId
    ).toEqual({
      42: true,
    });

    request.resolve({ code: 200, data: pendingDelivery });
    await Promise.all([first, duplicate]);
    await nextTick();

    expect(onPending).toHaveBeenCalledTimes(1);
    expect(onPending).toHaveBeenCalledWith(pendingDelivery);
    expect(
      states.getChatState("dialogue-a").archiveRetryingByMessageId
    ).toEqual({});
  });

  it("clears only the selected busy key after a retry failure", async () => {
    const states = useChatStates();
    const delivery = useResultArchiveDelivery({
      getChatState: states.getChatState,
    });
    mocks.retryConversationResultArchive.mockRejectedValueOnce(
      new Error("network")
    );
    states.getChatState("dialogue-a").archiveRetryingByMessageId["77"] = true;

    await delivery.retryResultArchive({
      dialogueId: "dialogue-a",
      messageId: "42",
      onPending: vi.fn(),
    });

    expect(
      states.getChatState("dialogue-a").archiveRetryingByMessageId
    ).toEqual({
      77: true,
    });
    expect(mocks.error).toHaveBeenCalledTimes(1);
  });

  it("uses a click-time conversation signature and shared transfer tracking for one archive", async () => {
    const states = useChatStates();
    const delivery = useResultArchiveDelivery({
      getChatState: states.getChatState,
    });
    const archive = {
      id: "archive-42",
      name: "research-results.zip",
      kind: "archive" as const,
    };
    const blob = new Blob(["zip"]);
    mocks.getConversationArtifactDownloadURL.mockResolvedValueOnce({
      code: 200,
      data: "/api/v1/downloads/relay-file?token=short-lived",
    });
    mocks.getConversationArtifactFile.mockImplementationOnce(
      async (_url, options) => {
        options?.onDownloadProgress?.({ loaded: 2, total: 4 });
        return { data: blob, headers: {} };
      }
    );

    await delivery.downloadResultArchive({
      dialogueId: "dialogue-a",
      messageId: "42",
      artifact: archive,
    });

    expect(mocks.getConversationArtifactDownloadURL).toHaveBeenCalledWith({
      dialogue_id: "dialogue-a",
      message_id: "42",
      artifact_id: "archive-42",
    });
    expect(mocks.getConversationArtifactFile).toHaveBeenCalledWith(
      "/api/v1/downloads/relay-file?token=short-lived",
      expect.objectContaining({
        requestId: expect.stringMatching(/^result-archive-/),
        onDownloadProgress: expect.any(Function),
      })
    );
    expect(mocks.upsertDownloadTransfer).toHaveBeenCalledWith(
      expect.objectContaining({ phase: "download", loaded: 2, total: 4 })
    );
    expect(mocks.saveAs).toHaveBeenCalledWith(blob, archive.name);
  });

  it("fails closed before any request for nonpositive ids or non-archive links", async () => {
    const states = useChatStates();
    const delivery = useResultArchiveDelivery({
      getChatState: states.getChatState,
    });

    await delivery.retryResultArchive({
      dialogueId: "dialogue-a",
      messageId: "0",
      onPending: vi.fn(),
    });
    await delivery.downloadResultArchive({
      dialogueId: "dialogue-a",
      messageId: "42",
      artifact: { id: "file-42", name: "report.txt", kind: "file" },
    });

    expect(mocks.retryConversationResultArchive).not.toHaveBeenCalled();
    expect(mocks.getConversationArtifactDownloadURL).not.toHaveBeenCalled();
  });
});
