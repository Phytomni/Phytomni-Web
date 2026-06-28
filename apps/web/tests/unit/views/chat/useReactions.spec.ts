import { describe, it, expect, vi, beforeEach } from "vitest";
import { ref } from "vue";
import { useReactions } from "@/views/chat/composables/useReactions";

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
    getChatState = (_dialogueId: string) => chatState;
    scrollToBottom = vi.fn();
  });

  function makeComposable() {
    return useReactions({ currentChatId, getChatState, scrollToBottom });
  }

  describe("getReactionState", () => {
    it("返回已存储的点赞状态", () => {
      chatState.reactions = { m1: 1 };
      const { getReactionState } = makeComposable();
      expect(getReactionState("m1")).toBe(1);
    });

    it("未知 messageId 返回 0", () => {
      chatState.reactions = {};
      const { getReactionState } = makeComposable();
      expect(getReactionState("unknown")).toBe(0);
    });

    it("currentChatId 为空时返回 0", () => {
      currentChatId.value = "";
      const { getReactionState } = makeComposable();
      expect(getReactionState("m1")).toBe(0);
    });
  });

  describe("handleReaction", () => {
    it("当前 reaction 为 1，再次点击 1 → 取消 reaction_type=0，状态=0，success=已取消", async () => {
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
      expect(mockElSuccess).toHaveBeenCalledWith("已取消");
    });

    it("当前 reaction 为 0，点击 2 → reaction_type=2，状态=2，success=已点踩", async () => {
      chatState.reactions = {};
      mockGetReactionType.mockResolvedValueOnce({ code: 200 } as any);

      const { handleReaction } = makeComposable();
      await handleReaction("m1", 2);

      const formData: FormData = mockGetReactionType.mock.calls[0][0];
      expect(formData.get("reaction_type")).toBe("2");
      expect(chatState.reactions["m1"]).toBe(2);
      expect(mockElSuccess).toHaveBeenCalledWith("已点踩");
    });

    it("当前 reaction 为 0，点击 1 → reaction_type=1，状态=1，success=已点赞", async () => {
      chatState.reactions = {};
      mockGetReactionType.mockResolvedValueOnce({ code: 200 } as any);

      const { handleReaction } = makeComposable();
      await handleReaction("m1", 1);

      const formData: FormData = mockGetReactionType.mock.calls[0][0];
      expect(formData.get("reaction_type")).toBe("1");
      expect(chatState.reactions["m1"]).toBe(1);
      expect(mockElSuccess).toHaveBeenCalledWith("已点赞");
    });

    it("非 200 响应 → ElMessage.error 操作失败，状态不更新", async () => {
      chatState.reactions = {};
      mockGetReactionType.mockResolvedValueOnce({ code: 500 } as any);

      const { handleReaction } = makeComposable();
      await handleReaction("m1", 1);

      expect(mockElError).toHaveBeenCalledWith("操作失败，请重试");
      expect(chatState.reactions["m1"]).toBeUndefined();
    });

    it("API 抛异常 → ElMessage.error 操作失败", async () => {
      chatState.reactions = {};
      mockGetReactionType.mockRejectedValueOnce(new Error("network error"));

      const { handleReaction } = makeComposable();
      await handleReaction("m1", 1);

      expect(mockElError).toHaveBeenCalledWith("操作失败，请重试");
    });
  });

  describe("getReactionTooltip", () => {
    it("reaction=1 时返回取消点赞", () => {
      chatState.reactions = { m1: 1 };
      const { getReactionTooltip } = makeComposable();
      expect(getReactionTooltip("m1", 1)).toBe("取消点赞");
    });

    it("reaction=0 时返回点赞", () => {
      chatState.reactions = {};
      const { getReactionTooltip } = makeComposable();
      expect(getReactionTooltip("m1", 1)).toBe("点赞");
    });

    it("reaction=2 时返回取消点踩", () => {
      chatState.reactions = { m1: 2 };
      const { getReactionTooltip } = makeComposable();
      expect(getReactionTooltip("m1", 2)).toBe("取消点踩");
    });

    it("reaction=0 时返回点踩", () => {
      chatState.reactions = {};
      const { getReactionTooltip } = makeComposable();
      expect(getReactionTooltip("m1", 2)).toBe("点踩");
    });

    it("未知 reactionType 返回空字符串", () => {
      const { getReactionTooltip } = makeComposable();
      expect(getReactionTooltip("m1", 99)).toBe("");
    });
  });
});
