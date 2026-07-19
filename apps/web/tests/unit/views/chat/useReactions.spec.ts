import { describe, it, expect, vi, beforeEach } from "vitest";
import { ref } from "vue";
import { useReactions } from "@/views/chat/composables/useReactions";
import i18n from "@/locales";
import zhCN from "@/locales/langs/zh-CN";

// Mock element-plus ElMessage
vi.mock("element-plus", () => ({
  ElMessage: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

// Mock getReactionType API
vi.mock("@/api/chat", () => ({
  getReactionType: vi.fn(),
}));

import { ElMessage } from "element-plus";
import { getReactionType } from "@/api/chat";

const mockGetReactionType = vi.mocked(getReactionType);
const mockElSuccess = vi.mocked(ElMessage.success);
const mockElError = vi.mocked(ElMessage.error);

describe("useReactions", () => {
  let chatState: { reactions: Record<string, number> };
  let currentChatId: ReturnType<typeof ref<string>>;
  let getChatState: (dialogueId: string) => any;
  let scrollToBottom: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    chatState = { reactions: {} };
    currentChatId = ref("d1");
    getChatState = () => chatState;
    scrollToBottom = vi.fn();
  });

  function makeComposable() {
    return useReactions({ currentChatId, getChatState, scrollToBottom });
  }

  describe("getReactionState", () => {
    it("returns the stored reaction state", () => {
      chatState.reactions = { m1: 1 };
      const { getReactionState } = makeComposable();
      expect(getReactionState("m1")).toBe(1);
    });

    it("unknown messageId returns 0", () => {
      chatState.reactions = {};
      const { getReactionState } = makeComposable();
      expect(getReactionState("unknown")).toBe(0);
    });

    it("returns 0 when currentChatId is empty", () => {
      currentChatId.value = "";
      const { getReactionState } = makeComposable();
      expect(getReactionState("m1")).toBe(0);
    });
  });

  describe("handleReaction", () => {
    it("current reaction is 1, click 1 again → cancel reaction_type=0, state=0, success=Cancelled", async () => {
      chatState.reactions = { m1: 1 };
      mockGetReactionType.mockResolvedValueOnce({ code: 200 } as any);

      const { handleReaction } = makeComposable();
      await handleReaction("m1", 1);

      // Check the FormData parameters
      const formData: FormData = mockGetReactionType.mock.calls[0][0];
      expect(formData.get("id")).toBe("m1");
      expect(formData.get("reaction_type")).toBe("0");

      // Check the local state
      expect(chatState.reactions["m1"]).toBe(0);

      // Check the success message
      expect(mockElSuccess).toHaveBeenCalledWith("Cancelled");
    });

    it("current reaction is 0, click 2 → reaction_type=2, state=2, success=Disliked", async () => {
      chatState.reactions = {};
      mockGetReactionType.mockResolvedValueOnce({ code: 200 } as any);

      const { handleReaction } = makeComposable();
      await handleReaction("m1", 2);

      const formData: FormData = mockGetReactionType.mock.calls[0][0];
      expect(formData.get("reaction_type")).toBe("2");
      expect(chatState.reactions["m1"]).toBe(2);
      expect(mockElSuccess).toHaveBeenCalledWith("Disliked");
    });

    it("current reaction is 0, click 1 → reaction_type=1, state=1, success=Liked", async () => {
      chatState.reactions = {};
      mockGetReactionType.mockResolvedValueOnce({ code: 200 } as any);

      const { handleReaction } = makeComposable();
      await handleReaction("m1", 1);

      const formData: FormData = mockGetReactionType.mock.calls[0][0];
      expect(formData.get("reaction_type")).toBe("1");
      expect(chatState.reactions["m1"]).toBe(1);
      expect(mockElSuccess).toHaveBeenCalledWith("Liked");
    });

    it("non-200 response → ElMessage.error operation failed, state not updated", async () => {
      chatState.reactions = {};
      mockGetReactionType.mockResolvedValueOnce({ code: 500 } as any);

      const { handleReaction } = makeComposable();
      await handleReaction("m1", 1);

      expect(mockElError).toHaveBeenCalledWith(
        "Operation failed, please try again"
      );
      expect(chatState.reactions["m1"]).toBeUndefined();
    });

    it("API throws → ElMessage.error operation failed", async () => {
      chatState.reactions = {};
      mockGetReactionType.mockRejectedValueOnce(new Error("network error"));

      const { handleReaction } = makeComposable();
      await handleReaction("m1", 1);

      expect(mockElError).toHaveBeenCalledWith(
        "Operation failed, please try again"
      );
    });
  });

  describe("getReactionTooltip", () => {
    it("returns Undo like when reaction=1", () => {
      chatState.reactions = { m1: 1 };
      const { getReactionTooltip } = makeComposable();
      expect(getReactionTooltip("m1", 1)).toBe("Undo like");
    });

    it("returns Like when reaction=0", () => {
      chatState.reactions = {};
      const { getReactionTooltip } = makeComposable();
      expect(getReactionTooltip("m1", 1)).toBe("Like");
    });

    it("returns Undo dislike when reaction=2", () => {
      chatState.reactions = { m1: 2 };
      const { getReactionTooltip } = makeComposable();
      expect(getReactionTooltip("m1", 2)).toBe("Undo dislike");
    });

    it("returns Dislike when reaction=0", () => {
      chatState.reactions = {};
      const { getReactionTooltip } = makeComposable();
      expect(getReactionTooltip("m1", 2)).toBe("Dislike");
    });

    it("unknown reactionType returns an empty string", () => {
      const { getReactionTooltip } = makeComposable();
      expect(getReactionTooltip("m1", 99)).toBe("");
    });

    it("same-mount locale switch updates labels without API calls", async () => {
      chatState.reactions = { m1: 1 };
      const { getReactionTooltip } = makeComposable();
      expect(getReactionTooltip("m1", 1)).toBe("Undo like");
      expect(getReactionTooltip("m1", 2)).toBe("Dislike");

      i18n.global.setLocaleMessage("zh-CN", zhCN);
      const prevLocale = (i18n.global.locale as { value: string }).value;
      (i18n.global.locale as { value: string }).value = "zh-CN";
      try {
        expect(getReactionTooltip("m1", 1)).toBe("取消点赞");
        expect(getReactionTooltip("m1", 2)).toBe("点踩");
        expect(mockGetReactionType).not.toHaveBeenCalled();
        expect(chatState.reactions["m1"]).toBe(1);
      } finally {
        (i18n.global.locale as { value: string }).value = prevLocale;
      }
    });
  });
});
