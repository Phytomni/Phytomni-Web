import { describe, it, expect, vi, beforeEach } from "vitest";
import { useChatHistoryActions } from "@/views/chat/composables/useChatHistoryActions";
import type { Chat } from "@/views/chat/types";

// Mock element-plus ElMessage
vi.mock("element-plus", () => ({
  ElMessage: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

// Mock chat history API
vi.mock("@/api/chat", () => ({
  renameHistory: vi.fn(),
  deleteHistory: vi.fn(),
  collectHistory: vi.fn(),
}));

import { ElMessage } from "element-plus";
import { renameHistory, deleteHistory, collectHistory } from "@/api/chat";

const mockRenameHistory = vi.mocked(renameHistory);
const mockDeleteHistory = vi.mocked(deleteHistory);
const mockCollectHistory = vi.mocked(collectHistory);
const mockElSuccess = vi.mocked(ElMessage.success);
const mockElError = vi.mocked(ElMessage.error);

function makeChat(overrides: Partial<Chat> = {}): Chat {
  return {
    id: 1,
    dialogue_id: "d1",
    title: "原标题",
    isFavorite: false,
    ...overrides,
  } as Chat;
}

describe("useChatHistoryActions", () => {
  let chatListData: Chat[];
  let currentChatIdValue: string;
  let onChatRenamed: ReturnType<typeof vi.fn>;
  let onChatDeleted: ReturnType<typeof vi.fn>;
  let onChatFavorited: ReturnType<typeof vi.fn>;
  let onSelectChat: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    chatListData = [];
    currentChatIdValue = "";
    onChatRenamed = vi.fn();
    onChatDeleted = vi.fn();
    onChatFavorited = vi.fn();
    onSelectChat = vi.fn();
  });

  function makeComposable() {
    return useChatHistoryActions({
      chatList: () => chatListData,
      currentChatId: () => currentChatIdValue,
      onChatRenamed,
      onChatDeleted,
      onChatFavorited,
      onSelectChat,
    });
  }

  describe("handleChatAction", () => {
    it("rename → 打开重命名对话框并预填标题", () => {
      const chat = makeChat({ title: "我的对话" });
      const c = makeComposable();
      c.handleChatAction("rename", chat);

      expect(c.renameDialogVisible.value).toBe(true);
      expect(c.renameForm.value.title).toBe("我的对话");
    });

    it("delete → 设置 chatToDelete 并打开删除对话框", () => {
      const chat = makeChat();
      const c = makeComposable();
      c.handleChatAction("delete", chat);

      expect(c.deleteDialogVisible.value).toBe(true);
      expect(c.chatToDelete.value).toStrictEqual(chat);
    });

    it("favorite → 触发收藏流程(collectHistory 被调用)", () => {
      const chat = makeChat({ isFavorite: false });
      mockCollectHistory.mockResolvedValueOnce({ code: 200 } as any);
      const c = makeComposable();
      c.handleChatAction("favorite", chat);

      expect(mockCollectHistory).toHaveBeenCalledTimes(1);
    });
  });

  describe("handleRenameConfirm", () => {
    it("validate 通过 + 200 → onChatRenamed 收到 {...chat, title}, 对话框关闭", async () => {
      const chat = makeChat({ id: 7, title: "旧标题" });
      mockRenameHistory.mockResolvedValueOnce({ code: 200 } as any);

      const c = makeComposable();
      // 打开重命名,设置 chatToRename + renameForm.title
      c.handleChatAction("rename", chat);
      c.renameForm.value.title = "新标题";
      c.renameFormRef.value = { validate: vi.fn().mockResolvedValue(true) };

      await c.handleRenameConfirm();

      const formData: FormData = mockRenameHistory.mock.calls[0][0];
      expect(formData.get("id")).toBe("7");
      expect(formData.get("rename")).toBe("新标题");

      expect(onChatRenamed).toHaveBeenCalledTimes(1);
      expect(onChatRenamed).toHaveBeenCalledWith({ ...chat, title: "新标题" });
      expect(c.renameDialogVisible.value).toBe(false);
      expect(mockElSuccess).toHaveBeenCalledWith("重命名成功");
    });

    it("非 200 → ElMessage.error, 不调用 onChatRenamed", async () => {
      const chat = makeChat();
      mockRenameHistory.mockResolvedValueOnce({ code: 500, message: "重命名失败" } as any);

      const c = makeComposable();
      c.handleChatAction("rename", chat);
      c.renameFormRef.value = { validate: vi.fn().mockResolvedValue(true) };

      await c.handleRenameConfirm();

      expect(onChatRenamed).not.toHaveBeenCalled();
      expect(mockElError).toHaveBeenCalledWith("重命名失败");
    });

    it("renameHistory reject → catch 分支 ElMessage.error", async () => {
      const chat = makeChat();
      mockRenameHistory.mockRejectedValueOnce(new Error("network error"));

      const c = makeComposable();
      c.handleChatAction("rename", chat);
      c.renameFormRef.value = { validate: vi.fn().mockResolvedValue(true) };

      await c.handleRenameConfirm();

      expect(onChatRenamed).not.toHaveBeenCalled();
      expect(mockElError).toHaveBeenCalledWith("重命名失败，请重试");
    });
  });

  describe("handleDeleteConfirm", () => {
    it("200 + 列表中存在匹配项 → onChatDeleted 收到该项", async () => {
      const chat = makeChat({ id: 3, dialogue_id: "dx" });
      chatListData = [chat];
      mockDeleteHistory.mockResolvedValueOnce({ code: 200 } as any);

      const c = makeComposable();
      c.handleChatAction("delete", chat);
      await c.handleDeleteConfirm();

      expect(onChatDeleted).toHaveBeenCalledTimes(1);
      expect(onChatDeleted).toHaveBeenCalledWith(chat);
      expect(c.deleteDialogVisible.value).toBe(false);
      expect(mockElSuccess).toHaveBeenCalledWith("删除成功");
    });

    it("currentChatId 等于被删除 dialogue_id → onSelectChat('')", async () => {
      const chat = makeChat({ dialogue_id: "dx" });
      chatListData = [chat];
      currentChatIdValue = "dx";
      mockDeleteHistory.mockResolvedValueOnce({ code: 200 } as any);

      const c = makeComposable();
      c.handleChatAction("delete", chat);
      await c.handleDeleteConfirm();

      expect(onSelectChat).toHaveBeenCalledWith("");
    });

    it("currentChatId 不等于被删除 dialogue_id → onSelectChat 不调用", async () => {
      const chat = makeChat({ dialogue_id: "dx" });
      chatListData = [chat];
      currentChatIdValue = "other";
      mockDeleteHistory.mockResolvedValueOnce({ code: 200 } as any);

      const c = makeComposable();
      c.handleChatAction("delete", chat);
      await c.handleDeleteConfirm();

      expect(onSelectChat).not.toHaveBeenCalled();
    });

    it("非 200 → ElMessage.error, 不调用任何 emit", async () => {
      const chat = makeChat({ dialogue_id: "dx" });
      chatListData = [chat];
      mockDeleteHistory.mockResolvedValueOnce({ code: 500, message: "删除失败" } as any);

      const c = makeComposable();
      c.handleChatAction("delete", chat);
      await c.handleDeleteConfirm();

      expect(onChatDeleted).not.toHaveBeenCalled();
      expect(onSelectChat).not.toHaveBeenCalled();
      expect(mockElError).toHaveBeenCalledWith("删除失败");
    });
  });

  describe("toggleFavorite (收藏由父组件持有, 不本地改写)", () => {
    it("isFavorite=false + 200 → emit 副本 isFavorite=true, 原对象不被改写", async () => {
      const chat = makeChat({ id: 5, isFavorite: false });
      mockCollectHistory.mockResolvedValueOnce({ code: 200 } as any);

      const c = makeComposable();
      c.handleChatAction("favorite", chat);
      // 等待内部异步 toggleFavorite 完成
      await Promise.resolve();
      await Promise.resolve();

      const formData: FormData = mockCollectHistory.mock.calls[0][0];
      expect(formData.get("id")).toBe("5");
      expect(formData.get("collect_type")).toBe("1");

      expect(onChatFavorited).toHaveBeenCalledTimes(1);
      const emitted = onChatFavorited.mock.calls[0][0];
      expect(emitted.isFavorite).toBe(true);
      // 关键: 原对象未被改写 (emit 的是副本)
      expect(chat.isFavorite).toBe(false);
      expect(emitted).not.toBe(chat);
      expect(mockElSuccess).toHaveBeenCalledWith("已收藏");
    });

    it("isFavorite=true + 200 → emit false, collect_type='0', 原对象不被改写", async () => {
      const chat = makeChat({ id: 6, isFavorite: true });
      mockCollectHistory.mockResolvedValueOnce({ code: 200 } as any);

      const c = makeComposable();
      c.handleChatAction("favorite", chat);
      await Promise.resolve();
      await Promise.resolve();

      const formData: FormData = mockCollectHistory.mock.calls[0][0];
      expect(formData.get("collect_type")).toBe("0");

      const emitted = onChatFavorited.mock.calls[0][0];
      expect(emitted.isFavorite).toBe(false);
      expect(chat.isFavorite).toBe(true);
      expect(mockElSuccess).toHaveBeenCalledWith("已取消收藏");
    });
  });

  describe("handleRenameDialogClose", () => {
    it("重置状态并调用 resetFields", () => {
      const chat = makeChat({ title: "T" });
      const c = makeComposable();
      c.handleChatAction("rename", chat);
      const resetFields = vi.fn();
      c.renameFormRef.value = { resetFields };

      c.handleRenameDialogClose();

      expect(c.renameForm.value.title).toBe("");
      expect(resetFields).toHaveBeenCalledTimes(1);
    });
  });
});
