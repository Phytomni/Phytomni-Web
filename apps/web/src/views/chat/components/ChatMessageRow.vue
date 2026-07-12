<template>
  <div
    class="message"
    :class="rootClasses"
    data-testid="chat-message-row"
    :data-message-role="role"
    :data-message-id="messageId || undefined"
    :aria-label="ariaLabel"
  >
    <div v-if="showAvatar" class="message-avatar">
      <slot name="avatar">
        <el-avatar :size="36" :src="defaultBotAvatar" />
      </slot>
    </div>
    <div class="message-content">
      <slot />
      <slot name="activity" />
      <slot name="artifact" />
      <slot name="follow-up" />
      <slot name="actions" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";

export type ChatMessageRowRole = "user" | "assistant";

const props = withDefaults(
  defineProps<{
    role: ChatMessageRowRole;
    messageId?: string;
    streaming?: boolean;
    loading?: boolean;
  }>(),
  {
    streaming: false,
    loading: false,
  }
);

const defaultBotAvatar = "/avatars/bot.svg";

const showAvatar = computed(() => props.role === "assistant");

const rootClasses = computed(() => [
  props.role,
  {
    streaming: props.streaming,
    loading: props.loading,
  },
]);

const ariaLabel = computed(() =>
  props.loading
    ? "assistant loading"
    : props.streaming
      ? "assistant streaming"
      : props.role
);
</script>

<style scoped lang="scss">
.message {
  display: flex;
  margin-bottom: 16px;

  &.user {
    justify-content: flex-end;

    .message-content {
      display: flex;
      flex-direction: column;
      align-items: flex-end;
      max-width: 72%;
      width: fit-content;
      background-color: transparent;
    }

    :deep(.message-text.phy-bubble-user) {
      width: fit-content;
      max-width: 100%;
      box-sizing: border-box;
      padding: 14px 16px;
      border-radius: var(--phy-radius-lg);
    }
  }

  &.assistant {
    flex-direction: row;
    justify-content: flex-start;

    .message-content {
      flex: 1 1 0;
      margin-left: 12px;
      width: auto;
      max-width: 100%;
      min-width: 0;
      background-color: transparent;
    }

    :deep(.message-text.phy-bubble-assistant) {
      width: fit-content;
      max-width: 100%;
      box-sizing: border-box;
      padding: 14px 16px;
      border-radius: var(--phy-radius-lg);
    }
  }

  .message-avatar {
    flex-shrink: 0;
    align-self: flex-start;
  }

  .message-content {
    box-sizing: border-box;
    padding-bottom: 12px;
    max-width: 100%;
    min-width: 0;
  }
}

@media (hover: hover) {
  .message-content:hover,
  .message-content:focus-within {
    --message-footer-opacity: 1;
  }
}

@media (max-width: 768px) {
  .message.user :deep(.message-text.phy-bubble-user),
  .message.assistant :deep(.message-text.phy-bubble-assistant) {
    padding: 12px 14px;
  }
}

/* Role identity survives via data-message-role / aria-label / alignment when fills are ignored. */
@media (forced-colors: active) {
  .message.user {
    justify-content: flex-end;
  }

  .message.assistant {
    justify-content: flex-start;
  }
}
</style>
