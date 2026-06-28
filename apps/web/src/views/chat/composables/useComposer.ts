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

  // the currently active button
  const activeButton = ref<string>();

  // handle button click
  const handleButtonClick = (buttonType: string) => {
    // block the action while sending or refreshing
    if (isSending.value) return;

    // if clicking the already-selected button, deselect it
    if (activeButton.value === buttonType) {
      activeButton.value = "";
      // remove the corresponding @tool, marker from the input
      const command = "@" + buttonType + ",";
      messageInput.value = messageInput.value.replace(command, "");
      return;
    }

    // if another button was selected before, remove it first
    if (activeButton.value) {
      const oldCommand = "@" + activeButton.value + ",";
      messageInput.value = messageInput.value.replace(oldCommand, "");
    }

    // set the newly selected button
    activeButton.value = buttonType;
    const command = "@" + buttonType + ",";
    const newMessageValue = extractAtValues(messageInput.value);
    messageInput.value = `${command}${newMessageValue.cleanedText}`;

    // ensure it scrolls to the bottom
    nextTick(() => {
      scrollToBottom();
    });
  };

  // watch the input content
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

  // update the full text when a tool is selected
  const handleCommand = (command: string) => {
    // block the action while sending or refreshing
    if (isSending.value) return;

    const regex = /@([^,]+),/;
    const match = command.match(regex);
    const extractedValue = match ? match[1] : "";
    activeButton.value = extractedValue;
    const newMessageValue = extractAtValues(messageInput.value);
    messageInput.value = `${command}${newMessageValue.cleanedText}`;

    // ensure it scrolls to the bottom
    nextTick(() => {
      scrollToBottom();
    });
  };

  const handleSelect = (option: MentionOption) => {
    activeButton.value = option.value;

    // ensure it scrolls to the bottom
    nextTick(() => {
      scrollToBottom();
    });
  };
  const handleSearch = (searchValue: string, prefix: string) => {
    // console.log(searchValue,'searchValue',prefix)

    // ensure it scrolls to the bottom
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
