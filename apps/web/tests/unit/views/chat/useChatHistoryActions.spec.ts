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
    title: "Original title",
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
    it("rename → opens rename dialog and prefills the title", () => {
      const chat = makeChat({ title: "My conversation" });
      const c = makeComposable();
      c.handleChatAction("rename", chat);

      expect(c.renameDialogVisible.value).toBe(true);
      expect(c.renameForm.value.title).toBe("My conversation");
    });

    it("delete → sets chatToDelete and opens the delete dialog", () => {
      const chat = makeChat();
      const c = makeComposable();
      c.handleChatAction("delete", chat);

      expect(c.deleteDialogVisible.value).toBe(true);
      expect(c.chatToDelete.value).toStrictEqual(chat);
    });

    it("favorite → triggers the favorite flow (collectHistory called)", () => {
      const chat = makeChat({ isFavorite: false });
      mockCollectHistory.mockResolvedValueOnce({ code: 200 } as any);
      const c = makeComposable();
      c.handleChatAction("favorite", chat);

      expect(mockCollectHistory).toHaveBeenCalledTimes(1);
    });
  });

  describe("handleRenameConfirm", () => {
    it("validate passes + 200 → onChatRenamed receives {...chat, title}, dialog closes", async () => {
      const chat = makeChat({ id: 7, title: "Old title" });
      mockRenameHistory.mockResolvedValueOnce({ code: 200 } as any);

      const c = makeComposable();
      // Open rename, setting chatToRename + renameForm.title
      c.handleChatAction("rename", chat);
      c.renameForm.value.title = "New title";
      c.renameFormRef.value = { validate: vi.fn().mockResolvedValue(true) };

      await c.handleRenameConfirm();

      const formData: FormData = mockRenameHistory.mock.calls[0][0];
      expect(formData.get("id")).toBe("7");
      expect(formData.get("rename")).toBe("New title");

      expect(onChatRenamed).toHaveBeenCalledTimes(1);
      expect(onChatRenamed).toHaveBeenCalledWith({
        ...chat,
        title: "New title",
      });
      expect(c.renameDialogVisible.value).toBe(false);
      expect(mockElSuccess).toHaveBeenCalledWith("Renamed successfully");
    });

    it("non-200 → ElMessage.error, does not call onChatRenamed", async () => {
      const chat = makeChat();
      mockRenameHistory.mockResolvedValueOnce({
        code: 500,
        message: "Rename failed",
      } as any);

      const c = makeComposable();
      c.handleChatAction("rename", chat);
      c.renameFormRef.value = { validate: vi.fn().mockResolvedValue(true) };

      await c.handleRenameConfirm();

      expect(onChatRenamed).not.toHaveBeenCalled();
      expect(mockElError).toHaveBeenCalledWith("Rename failed");
    });

    it("renameHistory reject → catch branch ElMessage.error", async () => {
      const chat = makeChat();
      mockRenameHistory.mockRejectedValueOnce(new Error("network error"));

      const c = makeComposable();
      c.handleChatAction("rename", chat);
      c.renameFormRef.value = { validate: vi.fn().mockResolvedValue(true) };

      await c.handleRenameConfirm();

      expect(onChatRenamed).not.toHaveBeenCalled();
      expect(mockElError).toHaveBeenCalledWith(
        "Rename failed, please try again"
      );
    });
  });

  describe("handleDeleteConfirm", () => {
    it("200 + matching item in list → onChatDeleted receives that item", async () => {
      const chat = makeChat({ id: 3, dialogue_id: "dx" });
      chatListData = [chat];
      mockDeleteHistory.mockResolvedValueOnce({ code: 200 } as any);

      const c = makeComposable();
      c.handleChatAction("delete", chat);
      await c.handleDeleteConfirm();

      expect(onChatDeleted).toHaveBeenCalledTimes(1);
      expect(onChatDeleted).toHaveBeenCalledWith(chat);
      expect(c.deleteDialogVisible.value).toBe(false);
      expect(mockElSuccess).toHaveBeenCalledWith("Deleted successfully");
    });

    it("currentChatId equals deleted dialogue_id → onSelectChat('')", async () => {
      const chat = makeChat({ dialogue_id: "dx" });
      chatListData = [chat];
      currentChatIdValue = "dx";
      mockDeleteHistory.mockResolvedValueOnce({ code: 200 } as any);

      const c = makeComposable();
      c.handleChatAction("delete", chat);
      await c.handleDeleteConfirm();

      expect(onSelectChat).toHaveBeenCalledWith("");
    });

    it("currentChatId not equal to deleted dialogue_id → onSelectChat not called", async () => {
      const chat = makeChat({ dialogue_id: "dx" });
      chatListData = [chat];
      currentChatIdValue = "other";
      mockDeleteHistory.mockResolvedValueOnce({ code: 200 } as any);

      const c = makeComposable();
      c.handleChatAction("delete", chat);
      await c.handleDeleteConfirm();

      expect(onSelectChat).not.toHaveBeenCalled();
    });

    it("non-200 → ElMessage.error, no emit called", async () => {
      const chat = makeChat({ dialogue_id: "dx" });
      chatListData = [chat];
      mockDeleteHistory.mockResolvedValueOnce({
        code: 500,
        message: "Delete failed",
      } as any);

      const c = makeComposable();
      c.handleChatAction("delete", chat);
      await c.handleDeleteConfirm();

      expect(onChatDeleted).not.toHaveBeenCalled();
      expect(onSelectChat).not.toHaveBeenCalled();
      expect(mockElError).toHaveBeenCalledWith("Delete failed");
    });
  });

  describe("toggleFavorite (favorite owned by parent, not mutated locally)", () => {
    it("isFavorite=false + 200 → emit copy with isFavorite=true, original not mutated", async () => {
      const chat = makeChat({ id: 5, isFavorite: false });
      mockCollectHistory.mockResolvedValueOnce({ code: 200 } as any);

      const c = makeComposable();
      c.handleChatAction("favorite", chat);
      // Wait for the internal async toggleFavorite to finish
      await Promise.resolve();
      await Promise.resolve();

      const formData: FormData = mockCollectHistory.mock.calls[0][0];
      expect(formData.get("id")).toBe("5");
      expect(formData.get("collect_type")).toBe("1");

      expect(onChatFavorited).toHaveBeenCalledTimes(1);
      const emitted = onChatFavorited.mock.calls[0][0];
      expect(emitted.isFavorite).toBe(true);
      // Key point: the original object is not mutated (a copy is emitted)
      expect(chat.isFavorite).toBe(false);
      expect(emitted).not.toBe(chat);
      expect(mockElSuccess).toHaveBeenCalledWith("Added to favorites");
    });

    it("isFavorite=true + 200 → emit false, collect_type='0', original not mutated", async () => {
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
      expect(mockElSuccess).toHaveBeenCalledWith("Removed from favorites");
    });
  });

  describe("handleRenameDialogClose", () => {
    it("resets state and calls resetFields", () => {
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
