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

  function makeComposable() {
    return useComposer({
      messageInput: messageInput as any,
      isSending: isSending as any,
      currentChatId,
      selectedAgent: selectedAgent as any,
      scrollToBottom,
    });
  }

  describe("handleButtonClick", () => {
    it("activates the button and prepends the @tool, command when none active", () => {
      const { activeButton, handleButtonClick } = makeComposable();

      handleButtonClick("RAG");

      expect(activeButton.value).toBe("RAG");
      // extractAtValues("") -> cleanedText "" so the command is the whole value
      expect(messageInput.value).toBe("@RAG,");
    });

    it("toggles the same button OFF, clearing activeButton and removing the command", () => {
      const { activeButton, handleButtonClick } = makeComposable();

      handleButtonClick("RAG");
      expect(activeButton.value).toBe("RAG");
      expect(messageInput.value).toBe("@RAG,");

      handleButtonClick("RAG");
      expect(activeButton.value).toBe("");
      expect(messageInput.value).toBe("");
    });

    it("early-returns (no change) when isSending is true", () => {
      isSending.value = true;
      const { activeButton, handleButtonClick } = makeComposable();

      handleButtonClick("RAG");

      expect(activeButton.value).toBe("");
      expect(messageInput.value).toBe("");
    });
  });

  describe("handleCommand", () => {
    it("sets activeButton from the @x, command and rewrites messageInput with the cleaned text", () => {
      messageInput.value = "hello world";
      const { activeButton, handleCommand } = makeComposable();

      handleCommand("@GA,");

      expect(activeButton.value).toBe("GA");
      // command + cleanedText of "hello world" (no @x, tokens -> unchanged)
      expect(messageInput.value).toBe("@GA,hello world");
    });
  });

  describe("handleSelect", () => {
    it("sets activeButton to the option value", () => {
      const { activeButton, handleSelect } = makeComposable();

      handleSelect({ value: "DataAgent" } as any);

      expect(activeButton.value).toBe("DataAgent");
    });
  });

  describe("watch(messageInput)", () => {
    it("clears activeButton when its @command is removed from the input", async () => {
      const { activeButton } = makeComposable();
      activeButton.value = "RAG";

      // set messageInput to a value WITHOUT the @RAG, command
      messageInput.value = "no command here";
      await nextTick();

      expect(activeButton.value).toBe("");
    });
  });

  describe("per-dialogue selectedAgent", () => {
    it("does not leak selection or marker across A→B→A dialogue switches", () => {
      const chatStates = useChatStates();
      chatStates.currentChatId.value = "A";

      const { activeButton, handleButtonClick } = useComposer({
        messageInput: chatStates.messageInput,
        isSending: chatStates.isSending,
        currentChatId: chatStates.currentChatId,
        selectedAgent: chatStates.selectedAgent,
        scrollToBottom,
      });

      handleButtonClick("KnowledgeAgent");
      expect(activeButton.value).toBe("KnowledgeAgent");
      expect(chatStates.messageInput.value).toBe("@KnowledgeAgent,");

      chatStates.currentChatId.value = "B";
      expect(activeButton.value).toBe("");
      expect(chatStates.messageInput.value).toBe("");

      handleButtonClick("DataAgent");
      expect(activeButton.value).toBe("DataAgent");
      expect(chatStates.messageInput.value).toBe("@DataAgent,");

      chatStates.currentChatId.value = "A";
      expect(activeButton.value).toBe("KnowledgeAgent");
      expect(chatStates.messageInput.value).toBe("@KnowledgeAgent,");

      chatStates.currentChatId.value = "B";
      expect(activeButton.value).toBe("DataAgent");
      expect(chatStates.messageInput.value).toBe("@DataAgent,");
    });

    it("replaces the old agent marker when switching selection within a dialogue", () => {
      const chatStates = useChatStates();
      chatStates.currentChatId.value = "A";

      const { activeButton, handleButtonClick } = useComposer({
        messageInput: chatStates.messageInput,
        isSending: chatStates.isSending,
        currentChatId: chatStates.currentChatId,
        selectedAgent: chatStates.selectedAgent,
        scrollToBottom,
      });

      handleButtonClick("KnowledgeAgent");
      chatStates.messageInput.value = "@KnowledgeAgent,keep this";
      handleButtonClick("DataAgent");
      expect(activeButton.value).toBe("DataAgent");
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

      useComposer({
        messageInput: chatStates.messageInput,
        isSending: chatStates.isSending,
        currentChatId: chatStates.currentChatId,
        selectedAgent: chatStates.selectedAgent,
        scrollToBottom,
      });

      chatStates.currentChatId.value = "A";
      chatStates.messageInput.value = "text without marker";
      await nextTick();

      expect(chatStates.selectedAgent.value).toBe("");
      expect(chatStates.getChatState("B").selectedAgent).toBe("DataAgent");
      expect(chatStates.getChatState("B").messageInput).toBe("@DataAgent,other");
    });
  });
});
