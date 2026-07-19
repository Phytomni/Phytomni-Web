import { describe, it, expect, vi, beforeEach } from "vitest";
import { ref, nextTick } from "vue";
import { useComposer } from "@/views/chat/composables/useComposer";
import { useChatStates } from "@/views/chat/composables/useChatStates";

describe("useComposer", () => {
  let messageInput: ReturnType<typeof ref<string>>;
  let isSending: ReturnType<typeof ref<boolean>>;
  let currentChatId: ReturnType<typeof ref<string>>;
  let selectedAgent: ReturnType<typeof ref<string>>;
  let scrollToBottom: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    messageInput = ref("");
    isSending = ref(false);
    currentChatId = ref("A");
    selectedAgent = ref("");
    scrollToBottom = vi.fn();
  });

  const permittedTools = ["ChatAgent", "KnowledgeAgent", "DataAgent"];

  function makeComposable(authorizedAgentTools = permittedTools) {
    return useComposer({
      messageInput: messageInput as any,
      isSending: isSending as any,
      currentChatId,
      selectedAgent: selectedAgent as any,
      scrollToBottom,
      authorizedAgentTools: ref(authorizedAgentTools) as any,
    });
  }

  describe("handleButtonClick", () => {
    it("activates the button and prepends the @tool, command when none active", () => {
      const { handleButtonClick } = makeComposable();

      handleButtonClick("ChatAgent");

      expect(selectedAgent.value).toBe("ChatAgent");
      expect(messageInput.value).toBe("@ChatAgent,");
    });

    it("toggles the same button OFF, clearing selectedAgent and removing the command", () => {
      const { handleButtonClick } = makeComposable();

      handleButtonClick("ChatAgent");
      expect(selectedAgent.value).toBe("ChatAgent");
      expect(messageInput.value).toBe("@ChatAgent,");

      handleButtonClick("ChatAgent");
      expect(selectedAgent.value).toBe("");
      expect(messageInput.value).toBe("");
    });

    it("early-returns (no change) when isSending is true", () => {
      isSending.value = true;
      const { handleButtonClick } = makeComposable();

      handleButtonClick("ChatAgent");

      expect(selectedAgent.value).toBe("");
      expect(messageInput.value).toBe("");
    });

    it("rejects a direct-selection tool outside the authorized set", () => {
      const { handleButtonClick } = makeComposable(["ChatAgent"]);

      handleButtonClick("DeepGenomeAgent");

      expect(selectedAgent.value).toBe("");
      expect(messageInput.value).toBe("");
    });

    it("rejects a mention selection outside the authorized set", () => {
      const { handleSelect } = makeComposable(["ChatAgent"]);

      handleSelect({ value: "DeepGenomeAgent" });

      expect(selectedAgent.value).toBe("");
      expect(messageInput.value).toBe("");
    });
  });

  describe("handleCommand", () => {
    it("sets selectedAgent from the @x, command and rewrites messageInput with the cleaned text", () => {
      messageInput.value = "hello world";
      const { handleCommand } = makeComposable();

      handleCommand("@ChatAgent,");

      expect(selectedAgent.value).toBe("ChatAgent");
      expect(messageInput.value).toBe("@ChatAgent,hello world");
    });

    it("rejects a command not in the permitted intersection", () => {
      messageInput.value = "keep";
      const { handleCommand } = makeComposable(["ChatAgent"]);

      handleCommand("@KnowledgeAgent,");

      expect(selectedAgent.value).toBe("");
      expect(messageInput.value).toBe("keep");
    });
  });

  describe("handleSelect", () => {
    it("sets selectedAgent to the option value", () => {
      const { handleSelect } = makeComposable();

      handleSelect({ value: "DataAgent" } as any);

      expect(selectedAgent.value).toBe("DataAgent");
    });
  });

  describe("handleSearch", () => {
    it("keeps the search event binding live and scrolls after the event", async () => {
      const { handleSearch } = makeComposable();

      handleSearch();
      await nextTick();

      expect(scrollToBottom).toHaveBeenCalled();
    });
  });

  describe("displayMessageInput adapter", () => {
    it("shows cleaned text while the underlying model keeps the serialized prefix", () => {
      messageInput.value = "@KnowledgeAgent,user text";
      selectedAgent.value = "KnowledgeAgent";
      const { displayMessageInput } = makeComposable();

      expect(displayMessageInput.value).toBe("user text");
      expect(messageInput.value).toBe("@KnowledgeAgent,user text");
    });

    it("writes back through the serialized prefix when an agent is selected", () => {
      selectedAgent.value = "DataAgent";
      messageInput.value = "@DataAgent,old";
      const { displayMessageInput } = makeComposable();

      displayMessageInput.value = "new body";
      expect(messageInput.value).toBe("@DataAgent,new body");
    });
  });

  describe("clearSelectedAgent", () => {
    it("removes only the exact prefix and preserves cleaned text", () => {
      selectedAgent.value = "KnowledgeAgent";
      messageInput.value = "@KnowledgeAgent,preserve me";
      const { clearSelectedAgent } = makeComposable();

      clearSelectedAgent();

      expect(selectedAgent.value).toBe("");
      expect(messageInput.value).toBe("preserve me");
    });
  });

  describe("watch(messageInput)", () => {
    it("clears selectedAgent when its @command is removed from the input", async () => {
      makeComposable();
      selectedAgent.value = "ChatAgent";

      messageInput.value = "no command here";
      await nextTick();

      expect(selectedAgent.value).toBe("");
    });
  });

  describe("permission refresh", () => {
    it("clears an unauthorized selection once when roles shrink", async () => {
      const authorizedAgentTools = ref(["ChatAgent", "KnowledgeAgent"]);
      useComposer({
        messageInput: messageInput as any,
        isSending: isSending as any,
        currentChatId,
        selectedAgent: selectedAgent as any,
        scrollToBottom,
        authorizedAgentTools: authorizedAgentTools as any,
      });

      selectedAgent.value = "KnowledgeAgent";
      messageInput.value = "@KnowledgeAgent,body";

      authorizedAgentTools.value = ["ChatAgent"];
      await nextTick();

      expect(selectedAgent.value).toBe("");
      expect(messageInput.value).toBe("body");
    });
  });

  describe("per-dialogue selectedAgent", () => {
    it("does not leak selection or marker across A→B→A dialogue switches", () => {
      const chatStates = useChatStates();
      chatStates.currentChatId.value = "A";

      const authorizedAgentTools = ref([
        "ChatAgent",
        "KnowledgeAgent",
        "DataAgent",
      ]);
      const { handleButtonClick } = useComposer({
        messageInput: chatStates.messageInput,
        isSending: chatStates.isSending,
        currentChatId: chatStates.currentChatId,
        selectedAgent: chatStates.selectedAgent,
        scrollToBottom,
        authorizedAgentTools: authorizedAgentTools as any,
      });

      handleButtonClick("KnowledgeAgent");
      expect(chatStates.selectedAgent.value).toBe("KnowledgeAgent");
      expect(chatStates.messageInput.value).toBe("@KnowledgeAgent,");

      chatStates.currentChatId.value = "B";
      expect(chatStates.selectedAgent.value).toBe("");
      expect(chatStates.messageInput.value).toBe("");

      handleButtonClick("DataAgent");
      expect(chatStates.selectedAgent.value).toBe("DataAgent");
      expect(chatStates.messageInput.value).toBe("@DataAgent,");

      chatStates.currentChatId.value = "A";
      expect(chatStates.selectedAgent.value).toBe("KnowledgeAgent");
      expect(chatStates.messageInput.value).toBe("@KnowledgeAgent,");

      chatStates.currentChatId.value = "B";
      expect(chatStates.selectedAgent.value).toBe("DataAgent");
      expect(chatStates.messageInput.value).toBe("@DataAgent,");
    });

    it("replaces the old agent marker when switching selection within a dialogue", () => {
      const chatStates = useChatStates();
      chatStates.currentChatId.value = "A";

      const authorizedAgentTools = ref([
        "ChatAgent",
        "KnowledgeAgent",
        "DataAgent",
      ]);
      const { handleButtonClick } = useComposer({
        messageInput: chatStates.messageInput,
        isSending: chatStates.isSending,
        currentChatId: chatStates.currentChatId,
        selectedAgent: chatStates.selectedAgent,
        scrollToBottom,
        authorizedAgentTools: authorizedAgentTools as any,
      });

      handleButtonClick("KnowledgeAgent");
      chatStates.messageInput.value = "@KnowledgeAgent,keep this";
      handleButtonClick("DataAgent");
      expect(chatStates.selectedAgent.value).toBe("DataAgent");
      expect(chatStates.messageInput.value).toBe("@DataAgent,keep this");
      expect(chatStates.getChatState("A").selectedAgent).toBe("DataAgent");
    });

    it("clears only the current dialogue selection when the marker is deleted", async () => {
      const chatStates = useChatStates();
      chatStates.currentChatId.value = "A";
      chatStates.selectedAgent.value = "KnowledgeAgent";
      chatStates.messageInput.value = "@KnowledgeAgent,text";

      chatStates.currentChatId.value = "B";
      chatStates.selectedAgent.value = "DataAgent";
      chatStates.messageInput.value = "@DataAgent,other";

      const authorizedAgentTools = ref([
        "ChatAgent",
        "KnowledgeAgent",
        "DataAgent",
      ]);
      useComposer({
        messageInput: chatStates.messageInput,
        isSending: chatStates.isSending,
        currentChatId: chatStates.currentChatId,
        selectedAgent: chatStates.selectedAgent,
        scrollToBottom,
        authorizedAgentTools: authorizedAgentTools as any,
      });

      chatStates.currentChatId.value = "A";
      chatStates.messageInput.value = "text without marker";
      await nextTick();

      expect(chatStates.selectedAgent.value).toBe("");
      expect(chatStates.getChatState("B").selectedAgent).toBe("DataAgent");
      expect(chatStates.getChatState("B").messageInput).toBe(
        "@DataAgent,other"
      );
    });
  });
});
