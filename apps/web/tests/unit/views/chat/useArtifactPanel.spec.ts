import { nextTick } from "vue";
import { describe, expect, it, vi } from "vitest";
import { useArtifactPanel } from "@/views/chat/composables/useArtifactPanel";
import { historyAssistantMetadata } from "@/views/chat/composables/useSelectChat";
import { useChatStates } from "@/views/chat/composables/useChatStates";
import type { ChatMessage } from "@/views/chat/types";

const artifactMocks = vi.hoisted(() => ({
  getConversationArtifactDownloadURL: vi.fn(),
  getConversationArtifactFile: vi.fn(),
  removeDownloadTransfer: vi.fn(),
  saveAs: vi.fn(),
  upsertDownloadTransfer: vi.fn(),
}));

vi.mock("@/api/chat", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/api/chat")>();
  return {
    ...actual,
    getConversationArtifactDownloadURL:
      artifactMocks.getConversationArtifactDownloadURL,
    getConversationArtifactFile: artifactMocks.getConversationArtifactFile,
  };
});

vi.mock("@/utils/download-transfers", () => ({
  removeDownloadTransfer: artifactMocks.removeDownloadTransfer,
  upsertDownloadTransfer: artifactMocks.upsertDownloadTransfer,
}));

vi.mock("file-saver", () => ({ saveAs: artifactMocks.saveAs }));

const eligibleMessage = (
  id: string,
  overrides: Partial<ChatMessage> = {}
): ChatMessage => ({
  role: "assistant",
  content: "Completed scientific result",
  id,
  tool_name: "KnowledgeAgent",
  ...overrides,
});

const makePanel = () => {
  const states = useChatStates();
  const panel = useArtifactPanel({
    currentChatId: states.currentChatId,
    currentChat: states.currentChat,
    getChatState: states.getChatState,
  });
  return { states, panel };
};

describe("useArtifactPanel", () => {
  it("opens exactly one eligible completed server message", () => {
    const { states, panel } = makePanel();
    const message = eligibleMessage("42");
    states.currentChatId.value = "A";
    states.currentChat.value = { dialogue_id: "A", messages: [message] };

    panel.openArtifact("42");

    expect(panel.artifactOpen.value).toBe(true);
    expect(panel.activeArtifactMessageId.value).toBe("42");
    expect(panel.artifactTab.value).toBe("content");
    expect(panel.currentArtifactMessage.value).toBe(
      states.getChatState("A").renderedChat?.messages[0]
    );
  });

  it("downloads only a signed link owned by the selected message through shared progress", async () => {
    const { states, panel } = makePanel();
    const artifact = {
      id: "artifact-1",
      name: "report.pdf",
      kind: "report" as const,
    };
    artifactMocks.getConversationArtifactDownloadURL.mockResolvedValueOnce({
      code: 200,
      data: "/api/v1/downloads/relay-file?token=signed-token",
    });
    const blob = new Blob(["report"]);
    artifactMocks.getConversationArtifactFile.mockImplementationOnce(
      async (_url, opts) => {
        opts?.onDownloadProgress?.({ loaded: 4, total: 8 });
        return { data: blob, headers: {} };
      }
    );
    states.currentChatId.value = "A";
    states.currentChat.value = {
      dialogue_id: "A",
      messages: [eligibleMessage("42", { artifacts: [artifact] })],
    };
    const open = vi.spyOn(window, "open").mockImplementation(() => null);

    panel.openArtifact("42");
    await panel.downloadArtifact({
      ...artifact,
    });

    expect(panel.currentArtifactLinks.value).toEqual([artifact]);
    expect(
      artifactMocks.getConversationArtifactDownloadURL
    ).toHaveBeenCalledWith({
      dialogue_id: "A",
      message_id: "42",
      artifact_id: artifact.id,
    });
    expect(artifactMocks.getConversationArtifactFile).toHaveBeenCalledWith(
      "/api/v1/downloads/relay-file?token=signed-token",
      expect.objectContaining({
        requestId: expect.stringMatching(/^conversation-artifact-/),
        onDownloadProgress: expect.any(Function),
      })
    );
    expect(artifactMocks.upsertDownloadTransfer).toHaveBeenCalledWith(
      expect.objectContaining({
        phase: "download",
        loaded: 4,
        total: 8,
        percent: 50,
      })
    );
    expect(artifactMocks.saveAs).toHaveBeenCalledWith(blob, "report.pdf");
    expect(artifactMocks.removeDownloadTransfer).toHaveBeenCalledWith(
      expect.stringMatching(/^conversation-artifact-/)
    );
    expect(open).not.toHaveBeenCalled();

    await panel.downloadArtifact({ ...artifact, id: "foreign-artifact" });
    expect(artifactMocks.getConversationArtifactFile).toHaveBeenCalledTimes(1);
    open.mockRestore();
  });

  it("treats a completed message with authorized links as artifact-eligible", () => {
    const { states, panel } = makePanel();
    states.currentChatId.value = "A";
    states.currentChat.value = {
      dialogue_id: "A",
      messages: [
        eligibleMessage("data-artifact", {
          tool_name: "DataAgent",
          artifacts: [
            {
              id: "table-1",
              name: "table.csv",
              kind: "table",
            },
          ],
        }),
      ],
    };

    panel.openArtifact("data-artifact");

    expect(panel.currentArtifactMessage.value?.id).toBe("data-artifact");
    expect(panel.currentArtifactLinks.value).toHaveLength(1);
  });

  it("preserves bounded artifacts and context notices during history hydration", () => {
    const artifacts = [
      {
        id: "artifact-1",
        name: "report.pdf",
        kind: "report" as const,
      },
    ];

    expect(
      historyAssistantMetadata({
        artifacts,
        context_rebuilt: true,
        context_degraded: true,
      })
    ).toEqual({
      artifacts,
      contextNotice: {
        rebuilt: true,
        degraded: true,
      },
    });
  });

  it.each([
    {
      name: "streaming result",
      requestedId: "streaming",
      messages: [eligibleMessage("streaming", { streaming: true })],
    },
    {
      name: "message without a server id",
      requestedId: "missing",
      messages: [eligibleMessage("missing", { id: undefined })],
    },
    {
      name: "duplicate server id",
      requestedId: "duplicate",
      messages: [eligibleMessage("duplicate"), eligibleMessage("duplicate")],
    },
    {
      name: "stale server id",
      requestedId: "stale",
      messages: [eligibleMessage("42")],
    },
  ])(
    "ignores a $name without disturbing the active selection",
    ({ requestedId, messages }) => {
      const { states, panel } = makePanel();
      states.currentChatId.value = "A";
      states.currentChat.value = {
        dialogue_id: "A",
        messages: [eligibleMessage("selected"), ...messages],
      };
      panel.openArtifact("selected");

      panel.openArtifact(requestedId);

      expect(panel.artifactOpen.value).toBe(true);
      expect(panel.activeArtifactMessageId.value).toBe("selected");
      expect(panel.currentArtifactMessage.value?.id).toBe("selected");
    }
  );

  it("tracks auto-opened server ids idempotently per dialogue", () => {
    const { states, panel } = makePanel();
    states.currentChatId.value = "A";

    expect(panel.hasAutoOpened("42")).toBe(false);
    panel.markAutoOpened("42");
    panel.markAutoOpened("42");

    expect(panel.hasAutoOpened("42")).toBe(true);
    expect(states.getChatState("A").autoOpenedArtifactMessageIds).toEqual([
      "42",
    ]);
  });

  it("can mark a background dialogue id without changing the foreground selection", () => {
    const { states, panel } = makePanel();
    states.currentChatId.value = "A";

    panel.markAutoOpened("background-42", "B");

    expect(panel.hasAutoOpened("background-42", "B")).toBe(true);
    expect(panel.hasAutoOpened("background-42")).toBe(false);
    expect(states.getChatState("A").autoOpenedArtifactMessageIds).toEqual([]);
    expect(states.getChatState("B").autoOpenedArtifactMessageIds).toEqual([
      "background-42",
    ]);
  });

  it("selects a tab and close resets selection without clearing seen ids", () => {
    const { states, panel } = makePanel();
    states.currentChatId.value = "A";
    states.currentChat.value = {
      dialogue_id: "A",
      messages: [eligibleMessage("42")],
    };
    panel.markAutoOpened("42");
    panel.openArtifact("42");

    panel.selectArtifactTab("evidence");
    expect(panel.artifactTab.value).toBe("evidence");

    panel.closeArtifact();

    expect(panel.artifactOpen.value).toBe(false);
    expect(panel.activeArtifactMessageId.value).toBeNull();
    expect(panel.artifactTab.value).toBe("content");
    expect(panel.currentArtifactMessage.value).toBeNull();
    expect(states.getChatState("A").autoOpenedArtifactMessageIds).toEqual([
      "42",
    ]);
  });

  it("invalidates a selected message removed by history refresh without clearing seen ids", async () => {
    const { states, panel } = makePanel();
    states.currentChatId.value = "A";
    states.currentChat.value = {
      dialogue_id: "A",
      messages: [eligibleMessage("42")],
    };
    panel.markAutoOpened("42");
    panel.openArtifact("42");

    states.currentChat.value = {
      dialogue_id: "A",
      messages: [eligibleMessage("replacement")],
    };
    await nextTick();

    expect(panel.artifactOpen.value).toBe(false);
    expect(panel.activeArtifactMessageId.value).toBeNull();
    expect(panel.artifactTab.value).toBe("content");
    expect(states.getChatState("A").autoOpenedArtifactMessageIds).toEqual([
      "42",
    ]);
  });

  it("invalidates an inactive dialogue refreshed before it is revisited", async () => {
    const { states, panel } = makePanel();
    states.currentChatId.value = "A";
    states.currentChat.value = {
      dialogue_id: "A",
      messages: [eligibleMessage("a-message")],
    };
    panel.markAutoOpened("a-message");
    panel.openArtifact("a-message");
    panel.selectArtifactTab("evidence");

    states.currentChatId.value = "B";
    states.currentChat.value = {
      dialogue_id: "B",
      messages: [{ role: "user", content: "B remains active" }],
    };
    panel.markAutoOpened("b-seen");
    const stateB = states.getChatState("B");
    stateB.messageInput = "B draft";

    const stateA = states.getChatState("A");
    stateA.renderedChat = {
      dialogue_id: "A",
      messages: [eligibleMessage("replacement")],
    };
    await nextTick();
    expect(stateA.artifactOpen).toBe(true);

    states.currentChatId.value = "A";
    await nextTick();

    expect(stateA.artifactOpen).toBe(false);
    expect(stateA.activeArtifactMessageId).toBeNull();
    expect(stateA.artifactTab).toBe("content");
    expect(stateA.autoOpenedArtifactMessageIds).toEqual(["a-message"]);
    expect(stateB.messageInput).toBe("B draft");
    expect(stateB.autoOpenedArtifactMessageIds).toEqual(["b-seen"]);
    expect(stateB.artifactOpen).toBe(false);
    expect(stateB.activeArtifactMessageId).toBeNull();
    expect(stateB.artifactTab).toBe("content");
  });

  it("restores complete artifact state independently across two dialogues", async () => {
    const { states, panel } = makePanel();

    states.currentChatId.value = "A";
    states.currentChat.value = {
      dialogue_id: "A",
      messages: [eligibleMessage("a-message")],
    };
    panel.markAutoOpened("a-message");
    panel.openArtifact("a-message");
    panel.selectArtifactTab("downloads");

    states.currentChatId.value = "B";
    states.currentChat.value = {
      dialogue_id: "B",
      messages: [eligibleMessage("b-message")],
    };
    await nextTick();
    expect(panel.artifactOpen.value).toBe(false);
    expect(panel.activeArtifactMessageId.value).toBeNull();
    expect(panel.artifactTab.value).toBe("content");
    expect(panel.hasAutoOpened("a-message")).toBe(false);

    panel.markAutoOpened("b-message");
    panel.openArtifact("b-message");
    panel.selectArtifactTab("activity");

    states.currentChatId.value = "A";
    await nextTick();
    expect(panel.artifactOpen.value).toBe(true);
    expect(panel.activeArtifactMessageId.value).toBe("a-message");
    expect(panel.artifactTab.value).toBe("downloads");
    expect(panel.currentArtifactMessage.value?.id).toBe("a-message");
    expect(panel.hasAutoOpened("a-message")).toBe(true);
    expect(panel.hasAutoOpened("b-message")).toBe(false);

    states.currentChatId.value = "B";
    await nextTick();
    expect(panel.artifactOpen.value).toBe(true);
    expect(panel.activeArtifactMessageId.value).toBe("b-message");
    expect(panel.artifactTab.value).toBe("activity");
    expect(panel.currentArtifactMessage.value?.id).toBe("b-message");
    expect(panel.hasAutoOpened("a-message")).toBe(false);
    expect(panel.hasAutoOpened("b-message")).toBe(true);
  });
});
