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
      justify-content: flex-end;
      width: calc(100% - 48px);
      border-radius: 15px;
      background-color: transparent;
    }
  }

  &.assistant {
    flex-direction: row;

    .message-content {
      border-radius: 15px;
      margin-left: 12px;
      background-color: transparent;
      width: 100%;
    }
  }

  .message-avatar {
    flex-shrink: 0;
    align-self: flex-start;
  }

  .message-content {
    padding: 0 12px 12px;
    max-width: 100%;
  }
}
</style>
