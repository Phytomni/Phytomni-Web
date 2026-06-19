import { describe, it, expect, vi, beforeEach } from "vitest";
import { ref, nextTick } from "vue";
import { useComposer } from "@/views/chat/composables/useComposer";

describe("useComposer", () => {
  let messageInput: ReturnType<typeof ref<string>>;
  let isSending: ReturnType<typeof ref<boolean>>;
  let currentChatId: ReturnType<typeof ref<string>>;
  let scrollToBottom: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    messageInput = ref("");
    isSending = ref(false);
    currentChatId = ref("A");
    scrollToBottom = vi.fn();
  });

  function makeComposable() {
    return useComposer({
      messageInput: messageInput as any,
      isSending: isSending as any,
      currentChatId,
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

      expect(activeButton.value).toBeUndefined();
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
});
