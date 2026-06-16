import { ref, watch, nextTick } from "vue";
import type { Ref, WritableComputedRef } from "vue";
import type { MentionOption } from "vue-element-plus-x/types/components/MentionSender/types";
import { extractAtValues } from "../utils/format";

export function useComposer(opts: {
  messageInput: WritableComputedRef<string>;
  isSending: WritableComputedRef<boolean>;
  currentChatId: Ref<string>;
  scrollToBottom: () => void;
}) {
  const { messageInput, isSending, currentChatId, scrollToBottom } = opts;

  // 当前激活的按钮
  const activeButton = ref<string>();

  // 处理按钮点击
  const handleButtonClick = (buttonType: string) => {
    // 如果正在发送或刷新，阻止操作
    if (isSending.value) return;

    // 如果点击的是当前已选中的按钮，则取消选中
    if (activeButton.value === buttonType) {
      activeButton.value = "";
      // 从输入框中移除对应的 @tool, 标记
      const command = "@" + buttonType + ",";
      messageInput.value = messageInput.value.replace(command, "");
      return;
    }

    // 如果之前有其他按钮被选中，先移除
    if (activeButton.value) {
      const oldCommand = "@" + activeButton.value + ",";
      messageInput.value = messageInput.value.replace(oldCommand, "");
    }

    // 设置新的选中按钮
    activeButton.value = buttonType;
    const command = "@" + buttonType + ",";
    const newMessageValue = extractAtValues(messageInput.value);
    messageInput.value = `${command}${newMessageValue.cleanedText}`;

    // 确保滚动到底部
    nextTick(() => {
      scrollToBottom();
    });
  };

  // 监听输入内容
  watch(messageInput, (newVal) => {
    if (activeButton.value && currentChatId.value) {
      const command = "@" + activeButton.value + ",";
      const newMessageValue = extractAtValues(newVal);
      const contains = newVal.includes(command);
      if (!contains) {
        activeButton.value = "";
      } else {
        messageInput.value = `${command}${newMessageValue.cleanedText}`;
      }
    }
  });

  // 处理tool选择时更新全文
  const handleCommand = (command: string) => {
    // 如果正在发送或刷新，阻止操作
    if (isSending.value) return;

    const regex = /@([^,]+),/;
    const match = command.match(regex);
    const extractedValue = match ? match[1] : "";
    activeButton.value = extractedValue;
    const newMessageValue = extractAtValues(messageInput.value);
    messageInput.value = `${command}${newMessageValue.cleanedText}`;

    // 确保滚动到底部
    nextTick(() => {
      scrollToBottom();
    });
  };

  const handleSelect = (option: MentionOption) => {
    activeButton.value = option.value;

    // 确保滚动到底部
    nextTick(() => {
      scrollToBottom();
    });
  };
  const handleSearch = (searchValue: string, prefix: string) => {
    // console.log(searchValue,'searchValue',prefix)

    // 确保滚动到底部
    nextTick(() => {
      scrollToBottom();
    });
  };

  return {
    activeButton,
    handleButtonClick,
    handleCommand,
    handleSelect,
    handleSearch,
  };
}
