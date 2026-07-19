import { computed, watch, nextTick } from "vue";
import type { Ref, WritableComputedRef } from "vue";
import type { MentionOption } from "vue-element-plus-x/types/components/MentionSender/types";
import { extractAtValues } from "../utils/format";

export function useComposer(opts: {
  messageInput: WritableComputedRef<string>;
  isSending: WritableComputedRef<boolean>;
  currentChatId: Ref<string>;
  selectedAgent: WritableComputedRef<string>;
  scrollToBottom: () => void;
  authorizedAgentTools: Ref<readonly string[]>;
}) {
  const {
    messageInput,
    isSending,
    currentChatId,
    selectedAgent,
    scrollToBottom,
    authorizedAgentTools,
  } = opts;

  const displayMessageInput = computed({
    get() {
      if (!selectedAgent.value) {
        return messageInput.value;
      }
      return extractAtValues(messageInput.value).cleanedText;
    },
    set(val: string) {
      if (selectedAgent.value) {
        messageInput.value = `@${selectedAgent.value},${val}`;
      } else {
        messageInput.value = val;
      }
    },
  });

  const clearSelectedAgent = () => {
    if (isSending.value || !selectedAgent.value) return;
    const cleaned = extractAtValues(messageInput.value).cleanedText;
    selectedAgent.value = "";
    messageInput.value = cleaned;
  };

  const isPermittedTool = (tool: string) =>
    authorizedAgentTools.value.includes(tool);

  // handle button click
  const handleButtonClick = (buttonType: string) => {
    if (isSending.value || !isPermittedTool(buttonType)) return;

    if (selectedAgent.value === buttonType) {
      clearSelectedAgent();
      return;
    }

    if (selectedAgent.value) {
      const oldCommand = "@" + selectedAgent.value + ",";
      messageInput.value = messageInput.value.replace(oldCommand, "");
    }

    selectedAgent.value = buttonType;
    const command = "@" + buttonType + ",";
    const newMessageValue = extractAtValues(messageInput.value);
    messageInput.value = `${command}${newMessageValue.cleanedText}`;

    nextTick(() => {
      scrollToBottom();
    });
  };

  watch(messageInput, (newVal) => {
    if (selectedAgent.value && currentChatId.value) {
      const command = "@" + selectedAgent.value + ",";
      const newMessageValue = extractAtValues(newVal);
      const contains = newVal.includes(command);
      if (!contains) {
        selectedAgent.value = "";
      } else {
        messageInput.value = `${command}${newMessageValue.cleanedText}`;
      }
    }
  });

  watch([authorizedAgentTools, isSending], ([tools, sending]) => {
    // Keep the serialized draft stable while a request owns this dialogue;
    // retry the same fail-closed cleanup when the send lifecycle settles.
    if (sending) return;
    if (selectedAgent.value && !tools.includes(selectedAgent.value)) {
      clearSelectedAgent();
    }
  });

  const handleCommand = (command: string) => {
    if (isSending.value) return;

    const regex = /@([^,]+),/;
    const match = command.match(regex);
    const extractedValue = match ? match[1] : "";
    if (!isPermittedTool(extractedValue)) return;

    selectedAgent.value = extractedValue;
    const newMessageValue = extractAtValues(messageInput.value);
    messageInput.value = `${command}${newMessageValue.cleanedText}`;

    nextTick(() => {
      scrollToBottom();
    });
  };

  const handleSelect = (option: MentionOption) => {
    if (!isPermittedTool(option.value)) return;
    selectedAgent.value = option.value;

    nextTick(() => {
      scrollToBottom();
    });
  };

  const handleSearch = () => {
    nextTick(() => {
      scrollToBottom();
    });
  };

  return {
    displayMessageInput,
    clearSelectedAgent,
    handleButtonClick,
    handleCommand,
    handleSelect,
    handleSearch,
  };
}
