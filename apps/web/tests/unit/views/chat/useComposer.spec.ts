import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  computed,
  ref,
  nextTick,
  type Ref,
  type WritableComputedRef,
} from "vue";
import type { MentionOption } from "vue-element-plus-x/types/components/MentionSender/types";
import { useComposer } from "@/views/chat/composables/useComposer";
import { useChatStates } from "@/views/chat/composables/useChatStates";

describe("useComposer", () => {
  let messageInput: Ref<string>;
  let isSending: Ref<boolean>;
  let selectedAgent: Ref<string>;
  let chatMode: Ref<"instant" | "expert">;
  let scrollToBottom: ReturnType<typeof vi.fn<() => Promise<void>>>;

  beforeEach(() => {
    vi.clearAllMocks();
    messageInput = ref("");
    isSending = ref(false);
    selectedAgent = ref("");
    chatMode = ref("expert");
    scrollToBottom = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
  });

  const permittedTools = ["ChatAgent", "KnowledgeAgent", "DataAgent"];

  function writableRef<T>(source: Ref<T>): WritableComputedRef<T> {
    return computed({
      get: () => source.value,
      set: (value: T) => {
        source.value = value;
      },
    });
  }

  function makeComposable(
    authorizedAgentTools: readonly string[] = permittedTools
  ) {
    return useComposer({
      messageInput: writableRef(messageInput),
      isSending: writableRef(isSending),
      selectedAgent: writableRef(selectedAgent),
      chatMode: writableRef(chatMode),
      scrollToBottom,
      authorizedAgentTools: ref<readonly string[]>(authorizedAgentTools),
    });
  }

  describe("handleButtonClick", () => {
    it("activates the button without mutating the draft", () => {
      const { handleButtonClick } = makeComposable();

      handleButtonClick("ChatAgent");

      expect(selectedAgent.value).toBe("ChatAgent");
      expect(messageInput.value).toBe("");
    });

    it("toggles the same button OFF while preserving the draft", () => {
      const { handleButtonClick } = makeComposable();

      handleButtonClick("ChatAgent");
      expect(selectedAgent.value).toBe("ChatAgent");
      expect(messageInput.value).toBe("");

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
    it("sets selectedAgent from the @x, command without mutating the draft", () => {
      messageInput.value = "hello world";
      const { handleCommand } = makeComposable();

      handleCommand("@ChatAgent,");

      expect(selectedAgent.value).toBe("ChatAgent");
      expect(messageInput.value).toBe("hello world");
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

      const option: MentionOption = { value: "DataAgent" };
      handleSelect(option);

      expect(selectedAgent.value).toBe("DataAgent");
    });

    it("removes only the exact MentionSender token from the plain draft", () => {
      messageInput.value = "@DataAgent,compare these genes";
      const { handleSelect } = makeComposable();

      handleSelect({ value: "DataAgent" });

      expect(selectedAgent.value).toBe("DataAgent");
      expect(messageInput.value).toBe("compare these genes");
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
    it("renders the exact current selection token without mutating the plain draft", () => {
      messageInput.value = "user text";
      selectedAgent.value = "KnowledgeAgent";
      const { displayMessageInput } = makeComposable();

      expect(displayMessageInput.value).toBe("@KnowledgeAgent,user text");
      expect(messageInput.value).toBe("user text");
    });

    it("strips only the exact current selection prefix when writing back", () => {
      selectedAgent.value = "DataAgent";
      messageInput.value = "old";
      const { displayMessageInput } = makeComposable();

      displayMessageInput.value = "@DataAgent,new body";
      expect(messageInput.value).toBe("new body");
      expect(selectedAgent.value).toBe("DataAgent");
    });

    it("clears selection when the user edits away the exact prefix", () => {
      selectedAgent.value = "DataAgent";
      messageInput.value = "old";
      const { displayMessageInput } = makeComposable();

      displayMessageInput.value = "literal @DataAgent,new body";

      expect(selectedAgent.value).toBe("");
      expect(messageInput.value).toBe("literal @DataAgent,new body");
    });

    it("preserves a literal leading @DataAgent token when it is not selected", () => {
      selectedAgent.value = "";
      messageInput.value = "@DataAgent, compare these genes";
      const { displayMessageInput } = makeComposable();

      expect(displayMessageInput.value).toBe("@DataAgent, compare these genes");
      expect(messageInput.value).toBe("@DataAgent, compare these genes");
    });

    it("preserves email addresses in the plain draft", () => {
      messageInput.value = "Contact email@example.org for the dataset";
      const { displayMessageInput } = makeComposable();

      expect(displayMessageInput.value).toBe(
        "Contact email@example.org for the dataset"
      );
      expect(messageInput.value).toBe(
        "Contact email@example.org for the dataset"
      );
    });

    it("hides the selection token in Instant without changing the draft", () => {
      chatMode.value = "instant";
      selectedAgent.value = "DataAgent";
      messageInput.value = "compare these genes";
      const { displayMessageInput } = makeComposable();

      expect(displayMessageInput.value).toBe("compare these genes");
    });
  });

  describe("clearSelectedAgent", () => {
    it("clears only selection and preserves the plain draft", () => {
      selectedAgent.value = "KnowledgeAgent";
      messageInput.value = "preserve me";
      const { clearSelectedAgent } = makeComposable();

      clearSelectedAgent();

      expect(selectedAgent.value).toBe("");
      expect(messageInput.value).toBe("preserve me");
    });

    it("preserves literal at-sign text in the message body", () => {
      selectedAgent.value = "KnowledgeAgent";
      messageInput.value = "body @foo,token";
      const { clearSelectedAgent } = makeComposable();

      clearSelectedAgent();

      expect(selectedAgent.value).toBe("");
      expect(messageInput.value).toBe("body @foo,token");
    });
  });

  describe("permission refresh", () => {
    it("clears an unauthorized selection once when roles shrink", async () => {
      const authorizedAgentTools = ref(["ChatAgent", "KnowledgeAgent"]);
      useComposer({
        messageInput: writableRef(messageInput),
        isSending: writableRef(isSending),
        selectedAgent: writableRef(selectedAgent),
        chatMode: writableRef(chatMode),
        scrollToBottom,
        authorizedAgentTools,
      });

      selectedAgent.value = "KnowledgeAgent";
      messageInput.value = "body";

      authorizedAgentTools.value = ["ChatAgent"];
      await nextTick();

      expect(selectedAgent.value).toBe("");
      expect(messageInput.value).toBe("body");
    });

    it("defers revoked selection cleanup until sending completes", async () => {
      const authorizedAgentTools = ref(["ChatAgent", "KnowledgeAgent"]);
      useComposer({
        messageInput: writableRef(messageInput),
        isSending: writableRef(isSending),
        selectedAgent: writableRef(selectedAgent),
        chatMode: writableRef(chatMode),
        scrollToBottom,
        authorizedAgentTools,
      });

      selectedAgent.value = "KnowledgeAgent";
      messageInput.value = "body";
      isSending.value = true;

      authorizedAgentTools.value = ["ChatAgent"];
      await nextTick();

      expect(selectedAgent.value).toBe("KnowledgeAgent");
      expect(messageInput.value).toBe("body");

      isSending.value = false;
      await nextTick();

      expect(selectedAgent.value).toBe("");
      expect(messageInput.value).toBe("body");
    });
  });

  describe("per-dialogue selectedAgent", () => {
    it("does not leak selection or draft across A→B→A dialogue switches", () => {
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
        selectedAgent: chatStates.selectedAgent,
        chatMode: chatStates.chatMode,
        scrollToBottom,
        authorizedAgentTools,
      });

      handleButtonClick("KnowledgeAgent");
      expect(chatStates.selectedAgent.value).toBe("KnowledgeAgent");
      expect(chatStates.messageInput.value).toBe("");

      chatStates.currentChatId.value = "B";
      expect(chatStates.selectedAgent.value).toBe("");
      expect(chatStates.messageInput.value).toBe("");

      handleButtonClick("DataAgent");
      expect(chatStates.selectedAgent.value).toBe("DataAgent");
      expect(chatStates.messageInput.value).toBe("");

      chatStates.currentChatId.value = "A";
      expect(chatStates.selectedAgent.value).toBe("KnowledgeAgent");
      expect(chatStates.messageInput.value).toBe("");

      chatStates.currentChatId.value = "B";
      expect(chatStates.selectedAgent.value).toBe("DataAgent");
      expect(chatStates.messageInput.value).toBe("");
    });

    it("replaces selection within a dialogue without changing its draft", () => {
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
        selectedAgent: chatStates.selectedAgent,
        chatMode: chatStates.chatMode,
        scrollToBottom,
        authorizedAgentTools,
      });

      handleButtonClick("KnowledgeAgent");
      chatStates.messageInput.value = "keep this";
      handleButtonClick("DataAgent");
      expect(chatStates.selectedAgent.value).toBe("DataAgent");
      expect(chatStates.messageInput.value).toBe("keep this");
      expect(chatStates.getChatState("A").selectedAgent).toBe("DataAgent");
    });

    it("clears only the current dialogue selection without affecting another dialogue", () => {
      const chatStates = useChatStates();
      chatStates.currentChatId.value = "A";
      chatStates.selectedAgent.value = "KnowledgeAgent";
      chatStates.messageInput.value = "text";

      chatStates.currentChatId.value = "B";
      chatStates.selectedAgent.value = "DataAgent";
      chatStates.messageInput.value = "other";

      const authorizedAgentTools = ref([
        "ChatAgent",
        "KnowledgeAgent",
        "DataAgent",
      ]);
      useComposer({
        messageInput: chatStates.messageInput,
        isSending: chatStates.isSending,
        selectedAgent: chatStates.selectedAgent,
        chatMode: chatStates.chatMode,
        scrollToBottom,
        authorizedAgentTools,
      });

      chatStates.currentChatId.value = "A";
      chatStates.selectedAgent.value = "";

      expect(chatStates.selectedAgent.value).toBe("");
      expect(chatStates.getChatState("B").selectedAgent).toBe("DataAgent");
      expect(chatStates.getChatState("B").messageInput).toBe("other");
    });
  });
});
