import { computed, watch, nextTick } from "vue";
import type { Ref, WritableComputedRef } from "vue";
import type { MentionOption } from "vue-element-plus-x/types/components/MentionSender/types";

function selectedAgentPrefix(selectedAgent: string): string {
  return selectedAgent ? `@${selectedAgent},` : "";
}

function removeExactSelectedPrefix(
  value: string,
  selectedAgent: string
): string {
  const prefix = selectedAgentPrefix(selectedAgent);
  return prefix !== "" && value.startsWith(prefix)
    ? value.slice(prefix.length)
    : value;
}

export function useComposer(opts: {
  messageInput: WritableComputedRef<string>;
  isSending: WritableComputedRef<boolean>;
  selectedAgent: WritableComputedRef<string>;
  chatMode: WritableComputedRef<"instant" | "expert">;
  scrollToBottom: () => Promise<void>;
  authorizedAgentTools: Ref<readonly string[]>;
}) {
  const {
    messageInput,
    isSending,
    selectedAgent,
    chatMode,
    scrollToBottom,
    authorizedAgentTools,
  } = opts;

  const displayMessageInput = computed<string>({
    get() {
      const selected = chatMode.value === "expert" ? selectedAgent.value : "";
      return `${selectedAgentPrefix(selected)}${messageInput.value}`;
    },
    set(value: string) {
      const selected = chatMode.value === "expert" ? selectedAgent.value : "";
      const prefix = selectedAgentPrefix(selected);
      if (prefix !== "" && !value.startsWith(prefix)) {
        selectedAgent.value = "";
        messageInput.value = value;
        return;
      }
      messageInput.value = removeExactSelectedPrefix(value, selected);
    },
  });

  const clearSelectedAgent = () => {
    if (isSending.value || !selectedAgent.value) return;
    selectedAgent.value = "";
  };

  const isPermittedTool = (tool: string) =>
    authorizedAgentTools.value.includes(tool);

  // handle button click
  const handleButtonClick = (buttonType: string) => {
    if (isSending.value || !isPermittedTool(buttonType)) return;

    selectedAgent.value = selectedAgent.value === buttonType ? "" : buttonType;

    nextTick(() => {
      scrollToBottom().catch(() => undefined);
    }).catch(() => undefined);
  };

  watch([authorizedAgentTools, isSending], ([tools, sending]) => {
    // Keep the plain draft stable while a request owns this dialogue;
    // retry the same fail-closed cleanup when the send lifecycle settles.
    if (sending) return;
    if (selectedAgent.value && !tools.includes(selectedAgent.value)) {
      clearSelectedAgent();
    }
  });

  const handleCommand = (command: string) => {
    if (isSending.value) return;

    const regex = /^@([^,]+),$/u;
    const match = command.match(regex);
    const extractedValue = match ? match[1] : "";
    if (!isPermittedTool(extractedValue)) return;

    selectedAgent.value = extractedValue;

    nextTick(() => {
      scrollToBottom().catch(() => undefined);
    }).catch(() => undefined);
  };

  const handleSelect = (option: MentionOption) => {
    if (!isPermittedTool(option.value)) return;
    selectedAgent.value = option.value;
    messageInput.value = removeExactSelectedPrefix(
      messageInput.value,
      option.value
    );

    nextTick(() => {
      scrollToBottom().catch(() => undefined);
    }).catch(() => undefined);
  };

  const handleSearch = () => {
    nextTick(() => {
      scrollToBottom().catch(() => undefined);
    }).catch(() => undefined);
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
