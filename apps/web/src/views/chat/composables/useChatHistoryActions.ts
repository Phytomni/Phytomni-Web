import { ref } from "vue";
import { ElMessage } from "element-plus";
import { collectHistory, renameHistory, deleteHistory } from "@/api/chat";
import type { Chat } from "../types";

export function useChatHistoryActions(opts: {
  chatList: () => Chat[];
  currentChatId: () => string;
  onChatRenamed: (chat: Chat) => void;
  onChatDeleted: (chat: Chat) => void;
  onChatFavorited: (chat: Chat) => void;
  onSelectChat: (id: string) => void;
}) {
  // 重命名对话框相关
  const renameDialogVisible = ref(false);
  const renameForm = ref({
    title: "",
  });
  const renameFormRef = ref();
  const renameRules = {
    title: [{ required: true, message: "请输入标题", trigger: "blur" }],
  };
  const chatToRename = ref<Chat | null>(null);

  // 删除确认对话框相关
  const deleteDialogVisible = ref(false);
  const chatToDelete = ref<Chat | null>(null);

  // 处理聊天历史项操作
  const handleChatAction = (command: string, chat: Chat) => {
    switch (command) {
      case "rename":
        renameForm.value.title = chat.title;
        chatToRename.value = chat;
        renameDialogVisible.value = true;
        break;
      case "favorite":
        toggleFavorite(chat);
        break;
      case "delete":
        chatToDelete.value = chat;
        deleteDialogVisible.value = true;
        break;
    }
  };

  // 重命名确认
  const handleRenameConfirm = async () => {
    if (!renameFormRef.value || !chatToRename.value) return;

    try {
      const valid = await renameFormRef.value.validate();
      if (valid) {
        const formData = new FormData();
        formData.append("id", chatToRename.value.id.toString());
        formData.append("rename", renameForm.value.title);

        const response = await renameHistory(formData);
        if (response.code === 200) {
          const updatedChat = {
            ...chatToRename.value,
            title: renameForm.value.title,
          };
          renameDialogVisible.value = false;
          chatToRename.value = null;
          // 父组件持有 chatList,由它在收到事件后更新本地列表;子组件不直接改 prop。
          opts.onChatRenamed(updatedChat);
          // 显示成功提示
          ElMessage.success("重命名成功");
        } else {
          ElMessage.error(response.message || "重命名失败");
        }
      }
    } catch (error) {
      console.error("重命名失败:", error);
      ElMessage.error("重命名失败，请重试");
    }
  };

  // 删除确认
  const handleDeleteConfirm = async () => {
    if (!chatToDelete.value) return;

    try {
      const formData = new FormData();
      formData.append("id", chatToDelete.value.id.toString());
      formData.append("reaction_type", "0"); // 0表示删除

      const response = await deleteHistory(formData);
      if (response.code === 200) {
        // 由父组件(chatList 的 owner)从列表中移除,子组件不直接改写 props.chatList。
        const deletedChat = opts.chatList().find(
          (c) => c.dialogue_id === chatToDelete.value!.dialogue_id
        );
        if (deletedChat) {
          // 通知父组件聊天已删除
          opts.onChatDeleted(deletedChat);
        }
        deleteDialogVisible.value = false;
        // 刷新当前聊天
        if (opts.currentChatId() === chatToDelete.value!.dialogue_id) {
          opts.onSelectChat("");
        }
        chatToDelete.value = null;
        // 显示成功提示
        ElMessage.success("删除成功");
      } else {
        ElMessage.error(response.message || "删除失败");
      }
    } catch (error) {
      console.error("删除失败:", error);
      ElMessage.error("删除失败，请重试");
    }
  };

  // 切换收藏状态
  const toggleFavorite = async (chat: Chat) => {
    try {
      const formData = new FormData();
      formData.append("id", chat.id.toString());
      formData.append("collect_type", chat.isFavorite ? "0" : "1"); // 0取消收藏，1收藏

      const response = await collectHistory(formData);
      if (response.code === 200) {
        const updatedChat = { ...chat, isFavorite: !chat.isFavorite };
        // 由父组件(chatList 的 owner)更新收藏状态,子组件不直接改写 props.chatList。
        opts.onChatFavorited(updatedChat);
        // 显示成功提示
        ElMessage.success(updatedChat.isFavorite ? "已收藏" : "已取消收藏");
      } else {
        ElMessage.error(response.message || "操作失败");
      }
    } catch (error) {
      console.error("收藏操作失败:", error);
      ElMessage.error("操作失败，请重试");
    }
  };

  // 处理重命名对话框关闭
  const handleRenameDialogClose = () => {
    chatToRename.value = null;
    renameForm.value.title = "";
    if (renameFormRef.value) {
      renameFormRef.value.resetFields();
    }
  };

  return {
    renameDialogVisible,
    renameForm,
    renameFormRef,
    renameRules,
    deleteDialogVisible,
    chatToDelete,
    handleChatAction,
    handleRenameConfirm,
    handleDeleteConfirm,
    handleRenameDialogClose,
  };
}
