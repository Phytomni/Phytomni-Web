import { ref } from "vue";
import { ElMessage } from "element-plus";
import i18n from "@/locales";
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
  // rename dialog state
  const renameDialogVisible = ref(false);
  const renameForm = ref({
    title: "",
  });
  const renameFormRef = ref();
  const renameRules = {
    title: [{ required: true, message: "Please enter a title", trigger: "blur" }],
  };
  const chatToRename = ref<Chat | null>(null);

  // delete confirmation dialog state
  const deleteDialogVisible = ref(false);
  const chatToDelete = ref<Chat | null>(null);

  // handle chat history item actions
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

  // confirm rename
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
          // the parent owns chatList and updates its local list on this event; the child does not mutate the prop directly.
          opts.onChatRenamed(updatedChat);
          // show a success message
          ElMessage.success(i18n.global.t("common.renamedSuccess"));
        } else {
          ElMessage.error(response.message || i18n.global.t("common.renameFailedRetry"));
        }
      }
    } catch (error) {
      console.error("Rename failed:", error);
      ElMessage.error(i18n.global.t("common.renameFailedRetry"));
    }
  };

  // confirm delete
  const handleDeleteConfirm = async () => {
    if (!chatToDelete.value) return;

    try {
      const formData = new FormData();
      formData.append("id", chatToDelete.value.id.toString());
      formData.append("reaction_type", "0"); // 0 means delete

      const response = await deleteHistory(formData);
      if (response.code === 200) {
        // the parent (owner of chatList) removes it from the list; the child does not mutate props.chatList directly.
        const deletedChat = opts.chatList().find(
          (c) => c.dialogue_id === chatToDelete.value!.dialogue_id
        );
        if (deletedChat) {
          // notify the parent that the chat was deleted
          opts.onChatDeleted(deletedChat);
        }
        deleteDialogVisible.value = false;
        // refresh the current chat
        if (opts.currentChatId() === chatToDelete.value!.dialogue_id) {
          opts.onSelectChat("");
        }
        chatToDelete.value = null;
        // show a success message
        ElMessage.success(i18n.global.t("common.deletedSuccess"));
      } else {
        ElMessage.error(response.message || i18n.global.t("common.deleteFailedRetry"));
      }
    } catch (error) {
      console.error("Delete failed:", error);
      ElMessage.error(i18n.global.t("common.deleteFailedRetry"));
    }
  };

  // toggle favorite state
  const toggleFavorite = async (chat: Chat) => {
    try {
      const formData = new FormData();
      formData.append("id", chat.id.toString());
      formData.append("collect_type", chat.isFavorite ? "0" : "1"); // 0 = unfavorite, 1 = favorite

      const response = await collectHistory(formData);
      if (response.code === 200) {
        const updatedChat = { ...chat, isFavorite: !chat.isFavorite };
        // the parent (owner of chatList) updates the favorite state; the child does not mutate props.chatList directly.
        opts.onChatFavorited(updatedChat);
        // show a success message
        ElMessage.success(
          updatedChat.isFavorite
            ? i18n.global.t("favorites.addedSuccess")
            : i18n.global.t("favorites.removedSuccess")
        );
      } else {
        ElMessage.error(response.message || i18n.global.t("common.opFailedRetry"));
      }
    } catch (error) {
      console.error("Favorite action failed:", error);
      ElMessage.error(i18n.global.t("common.opFailedRetry"));
    }
  };

  // handle rename dialog close
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
