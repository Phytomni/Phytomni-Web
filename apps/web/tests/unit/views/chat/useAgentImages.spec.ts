import { describe, it, expect, vi, beforeEach } from "vitest";
import { ref } from "vue";
import { flushPromises } from "@vue/test-utils";
import type { ApiEnvelope } from "@/api/types";
import type { ChatMessage, ChatView } from "@/views/chat/types";
import { buildApiEnvelope } from "../../../helpers/apiBuilders";
import { buildChatMessage } from "../../../helpers/chatBuilders";

// getObsImages mock — hoisted so vi.mock factory can reference it
const mockGetObsImages = vi.hoisted(() =>
  vi.fn<
    (data: { obs_path: string }) => Promise<ApiEnvelope<string | string[]>>
  >()
);

vi.mock("@/api/chat", () => ({
  getObsImages: mockGetObsImages,
}));

import { useAgentImages } from "@/views/chat/composables/useAgentImages";

// Characterization test — locks down the watch logic:
// a correct tool_name + download_path triggers the fetch; a missing field does not.

describe("useAgentImages", () => {
  beforeEach(() => {
    mockGetObsImages.mockReset();
  });

  function chatRef(): ReturnType<typeof ref<ChatView | null>> {
    return ref<ChatView | null>(null);
  }

  function message(overrides: Partial<ChatMessage>): ChatMessage {
    return buildChatMessage({ role: "assistant", ...overrides });
  }

  it("GeneNetworkAgent: gallery-only row (no artifact card) calls getObsImages", async () => {
    mockGetObsImages.mockResolvedValue(
      buildApiEnvelope(["http://obs/img1.png", "http://obs/img2.png"])
    );

    const currentChat = chatRef();
    const { geneNetworkImages, geneNetworkImagesLoading } =
      useAgentImages(currentChat);

    currentChat.value = {
      messages: [
        message({
          tool_name: "GeneNetworkAgent",
          download_path: "obs://bucket/path",
          id: "msg-001",
          content: "",
          status: "SUCCEEDED",
        }),
      ],
    };

    await flushPromises();

    expect(mockGetObsImages).toHaveBeenCalledOnce();
    expect(mockGetObsImages).toHaveBeenCalledWith({
      obs_path: "obs://bucket/path",
    });
    expect(geneNetworkImages["msg-001"]).toEqual([
      "http://obs/img1.png",
      "http://obs/img2.png",
    ]);
    expect(geneNetworkImagesLoading["msg-001"]).toBe(false);
  });

  it("GeneNetworkAgent: artifact-card report does not prefetch obs-images", async () => {
    const currentChat = chatRef();
    useAgentImages(currentChat);

    currentChat.value = {
      messages: [
        message({
          tool_name: "GeneNetworkAgent",
          download_path:
            "/obs/phytomni/agent_data/test/output/children/part-001",
          id: "3676",
          status: "SUCCEEDED",
          content:
            "The analysis reached a terminal outcome, but no validated scientific text artifact was available for synthesis. Review the downloadable scientific artifacts and execution warnings before drawing conclusions.",
        }),
      ],
    };

    await flushPromises();

    expect(mockGetObsImages).not.toHaveBeenCalled();
  });

  it("DigitalDesignAgent: when download_path is a single string value, parses it then calls getObsImages", async () => {
    mockGetObsImages.mockResolvedValue(
      buildApiEnvelope("http://obs/design.png")
    );

    const currentChat = chatRef();
    const { digitalDesignImages, digitalDesignImagesLoading } =
      useAgentImages(currentChat);

    currentChat.value = {
      messages: [
        message({
          tool_name: "DigitalDesignAgent",
          download_path: "obs://bucket/design",
          id: "msg-002",
          content: "",
          status: "SUCCEEDED",
        }),
      ],
    };

    await flushPromises();

    expect(mockGetObsImages).toHaveBeenCalledOnce();
    expect(mockGetObsImages).toHaveBeenCalledWith({
      obs_path: "obs://bucket/design",
    });
    expect(digitalDesignImages["msg-002"]).toEqual(["http://obs/design.png"]);
    expect(digitalDesignImagesLoading["msg-002"]).toBe(false);
  });

  it("DigitalDesignAgent: when download_path is a JSON string array, fetches each one", async () => {
    mockGetObsImages
      .mockResolvedValueOnce(buildApiEnvelope(["http://obs/a.png"]))
      .mockResolvedValueOnce(buildApiEnvelope(["http://obs/b.png"]));

    const currentChat = chatRef();
    const { digitalDesignImages } = useAgentImages(currentChat);

    currentChat.value = {
      messages: [
        message({
          tool_name: "DigitalDesignAgent",
          download_path: JSON.stringify(["obs://p1", "obs://p2"]),
          id: "msg-003",
          content: "",
          status: "SUCCEEDED",
        }),
      ],
    };

    await flushPromises();

    expect(mockGetObsImages).toHaveBeenCalledTimes(2);
    expect(mockGetObsImages).toHaveBeenNthCalledWith(1, {
      obs_path: "obs://p1",
    });
    expect(mockGetObsImages).toHaveBeenNthCalledWith(2, {
      obs_path: "obs://p2",
    });
    expect(digitalDesignImages["msg-003"]).toEqual([
      "http://obs/a.png",
      "http://obs/b.png",
    ]);
  });

  it("negative path: does not trigger fetch when tool_name is ChatAgent", async () => {
    const currentChat = chatRef();
    useAgentImages(currentChat);

    currentChat.value = {
      messages: [
        message({
          tool_name: "ChatAgent",
          download_path: "obs://bucket/chat",
          id: "msg-004",
        }),
      ],
    };

    await flushPromises();

    expect(mockGetObsImages).not.toHaveBeenCalled();
  });

  it("negative path: does not trigger fetch when download_path is missing", async () => {
    const currentChat = chatRef();
    useAgentImages(currentChat);

    currentChat.value = {
      messages: [
        message({
          tool_name: "GeneNetworkAgent",
          // download_path intentionally omitted
          id: "msg-005",
        }),
      ],
    };

    await flushPromises();

    expect(mockGetObsImages).not.toHaveBeenCalled();
  });

  it("negative path: does not trigger fetch when download_path is blank", async () => {
    const currentChat = chatRef();
    useAgentImages(currentChat);

    currentChat.value = {
      messages: [
        message({
          tool_name: "GeneNetworkAgent",
          download_path: "   ",
          id: "msg-005-blank",
        }),
      ],
    };

    await flushPromises();

    expect(mockGetObsImages).not.toHaveBeenCalled();
  });

  it("negative path: does not trigger fetch when currentChat is null", async () => {
    const currentChat = chatRef();
    useAgentImages(currentChat);

    await flushPromises();

    expect(mockGetObsImages).not.toHaveBeenCalled();
  });

  it("dedup: GeneNetworkAgent does not re-fetch on a second change with the same id", async () => {
    mockGetObsImages.mockResolvedValue(buildApiEnvelope(["http://obs/x.png"]));

    const currentChat = chatRef();
    const { geneNetworkImages } = useAgentImages(currentChat);

    const msg: ChatMessage = message({
      tool_name: "GeneNetworkAgent",
      download_path: "obs://bucket/x",
      id: "msg-006",
      content: "",
      status: "SUCCEEDED",
    });

    currentChat.value = { messages: [msg] };
    await flushPromises();
    expect(mockGetObsImages).toHaveBeenCalledOnce();

    // Reassign the same dialogue (simulating the deep watch firing again)
    currentChat.value = {
      messages: [msg, buildChatMessage({ role: "user", content: "hi" })],
    };
    await flushPromises();

    // Since geneNetworkImages[msg.id] already exists, it should not be called again
    expect(mockGetObsImages).toHaveBeenCalledOnce();
    expect(geneNetworkImages["msg-006"]).toEqual(["http://obs/x.png"]);
  });
});
