import { beforeEach, describe, expect, it, vi } from "vitest";
import { ref } from "vue";

const mockQuery = vi.hoisted(() => vi.fn());
const mockAbortRequest = vi.hoisted(() => vi.fn(() => true));
const mockTrackerUpdate = vi.hoisted(() => vi.fn());
const mockTrackerReset = vi.hoisted(() => vi.fn());

vi.mock("@/api/chat", () => ({
  getQueryAbortable: mockQuery,
}));

vi.mock("@/utils/request", () => ({
  default: vi.fn(),
  abortRequest: mockAbortRequest,
}));

vi.mock("@/utils/transfer-progress", () => ({
  createTransferTracker: vi.fn(() => ({
    update: mockTrackerUpdate,
    reset: mockTrackerReset,
  })),
}));

import {
  useBotRemoteAgentRun,
  type RemoteAgentChatState,
  type RemoteAgentCapabilitySource,
} from "@/views/chat/composables/useBotRemoteAgentRun";

function makeState(): RemoteAgentChatState {
  return {
    isSending: false,
    uploadTransfer: null,
    activeRequestId: "",
    generationStopped: false,
  };
}

function makeCapabilities(
  tool: string,
  enabled = true,
  attachments = true
): RemoteAgentCapabilitySource {
  return {
    byTool: ref({
      [tool]: {
        enabled,
        attachments,
        execution: "agent_run",
      },
    }),
  };
}

describe("useBotRemoteAgentRun", () => {
  beforeEach(() => {
    mockQuery.mockReset();
    mockAbortRequest.mockClear();
    mockTrackerUpdate.mockReset();
    mockTrackerReset.mockReset();
  });

  it("does not submit a dark or unknown remote agent", async () => {
    const states = new Map<string, RemoteAgentChatState>();
    const getChatState = (dialogueId: string) => {
      if (!states.has(dialogueId)) states.set(dialogueId, makeState());
      return states.get(dialogueId)!;
    };
    const run = useBotRemoteAgentRun({
      tool: "GeneNetworkAgent",
      dialogueId: "d1",
      getChatState,
      capabilities: makeCapabilities("GeneNetworkAgent", false),
    });

    await expect(run.submit({ query: "trait" })).rejects.toMatchObject({
      code: "capability_disabled",
    });
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("keeps run state inside the supplied dialogue", async () => {
    const states = new Map<string, RemoteAgentChatState>();
    const getChatState = (dialogueId: string) => {
      if (!states.has(dialogueId)) states.set(dialogueId, makeState());
      return states.get(dialogueId)!;
    };
    const paperFile = new File(["paper"], "paper.pdf", {
      type: "application/pdf",
    });
    mockQuery.mockResolvedValueOnce({
      data: {
        bot_run_id: "run-research-1",
        tool_name: "InSilicoResearchAgent",
        status: "RUNNING",
      },
    });

    const run = useBotRemoteAgentRun({
      tool: "InSilicoResearchAgent",
      dialogueId: "d1",
      getChatState,
      capabilities: makeCapabilities("InSilicoResearchAgent"),
    });

    await run.submit({ query: "paper", files: [paperFile] });

    expect(getChatState("d1").botProjection?.runId).toBe("run-research-1");
    expect(getChatState("d1").botLifecycle?.runId).toBe("run-research-1");

    const formData = mockQuery.mock.calls[0][0] as FormData;
    expect(formData.get("query")).toBe("paper");
    expect(formData.get("tool")).toBe("InSilicoResearchAgent");
    expect(formData.get("mode")).toBe("instant");
    expect(formData.get("files")).toBeInstanceOf(File);
    expect(getChatState("d1").activeRequestId).toBe("");
  });

  it("aborts the active request and clears dialogue upload progress", async () => {
    let resolveRequest: (value: unknown) => void = () => undefined;
    mockQuery.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveRequest = resolve;
      })
    );
    const state = makeState();
    const run = useBotRemoteAgentRun({
      tool: "DigitalDesignAgent",
      dialogueId: "d2",
      getChatState: () => state,
      capabilities: makeCapabilities("DigitalDesignAgent"),
    });

    const pending = run.submit({ query: "design" });
    expect(state.activeRequestId).not.toBe("");
    expect(run.cancel()).toBe(true);
    expect(mockAbortRequest).toHaveBeenCalledWith(state.activeRequestId);
    resolveRequest({
      data: {
        bot_run_id: "run-design-1",
        tool_name: "DigitalDesignAgent",
        status: "CANCELLED",
      },
    });
    await pending;

    expect(state.uploadTransfer).toBeNull();
    expect(state.activeRequestId).toBe("");
    expect(run.state.value.phase).toBe("cancelled");
  });
});
