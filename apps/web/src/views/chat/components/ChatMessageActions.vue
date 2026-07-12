<template>
  <div
    class="message-footer is-touch-visible"
    :class="{
      'message-footer--user': role === 'user',
      'message-footer--assistant': role === 'assistant',
    }"
    data-testid="chat-message-actions"
    role="toolbar"
  >
    <el-tooltip
      v-if="!copied"
      effect="dark"
      :content="t('chat.copy')"
      placement="top-start"
    >
      <button
        type="button"
        class="message-footer-item"
        data-testid="action-copy"
        :aria-label="t('chat.copy')"
        @click="emit('copy')"
      >
        <el-icon><CopyDocument /></el-icon>
      </button>
    </el-tooltip>
    <div
      v-else
      class="message-footer-item"
      data-testid="action-copied"
      aria-hidden="true"
    >
      <el-icon><SuccessFilled /></el-icon>
    </div>

    <el-tooltip
      v-if="canRefresh"
      effect="dark"
      :content="t('chat.refreshReply')"
      placement="top-start"
    >
      <button
        type="button"
        class="message-footer-item"
        data-testid="action-refresh"
        :class="{ 'is-loading': refreshBusy }"
        :aria-label="t('chat.refreshReply')"
        :aria-busy="refreshBusy ? 'true' : undefined"
        @click="emit('refresh')"
      >
        <el-icon><Refresh /></el-icon>
      </button>
    </el-tooltip>

    <div v-if="canReact" class="reaction-buttons">
      <el-tooltip effect="dark" :content="likeLabel" placement="top">
        <button
          type="button"
          class="message-footer-item reaction-btn"
          data-testid="action-like"
          :class="{ active: reactionActive === 1 }"
          :aria-label="likeLabel"
          :aria-pressed="reactionActive === 1 ? 'true' : 'false'"
          @click="emit('reaction', 1)"
        >
          <el-icon>
            <SuccessFilled v-if="reactionActive === 1" />
            <CircleCheck v-else />
          </el-icon>
        </button>
      </el-tooltip>
      <el-tooltip effect="dark" :content="dislikeLabel" placement="top">
        <button
          type="button"
          class="message-footer-item reaction-btn"
          data-testid="action-dislike"
          :class="{ active: reactionActive === 2 }"
          :aria-label="dislikeLabel"
          :aria-pressed="reactionActive === 2 ? 'true' : 'false'"
          @click="emit('reaction', 2)"
        >
          <el-icon>
            <CircleCloseFilled v-if="reactionActive === 2" />
            <CircleClose v-else />
          </el-icon>
        </button>
      </el-tooltip>
    </div>

    <el-dropdown
      v-if="directDownloads.length > 0"
      placement="top-start"
      trigger="click"
      @command="onDirectDownload"
    >
      <button
        type="button"
        class="message-footer-item"
        data-testid="action-direct-downloads"
        :aria-label="directDownloadsLabel"
      >
        <el-icon><Download /></el-icon>
      </button>
      <template #dropdown>
        <el-dropdown-menu>
          <el-dropdown-item
            v-for="item in directDownloads"
            :key="`${item.kind}:${item.path}`"
            :command="item.path"
            :data-testid="`direct-download-${item.path}`"
          >
            {{
              item.kind === "upload"
                ? t("chat.downloadURL")
                : t("chat.downloadFile")
            }}
          </el-dropdown-item>
        </el-dropdown-menu>
      </template>
    </el-dropdown>

    <el-dropdown
      v-if="generatedFormats.length > 0"
      placement="top-start"
      trigger="click"
      @command="onGeneratedFormat"
    >
      <button
        type="button"
        class="message-footer-item"
        data-testid="action-generated-download"
        :aria-label="t('chat.downloadFile')"
      >
        <el-icon><Download /></el-icon>
      </button>
      <template #dropdown>
        <el-dropdown-menu>
          <el-dropdown-item
            v-for="format in generatedFormats"
            :key="format"
            :command="format"
          >
            {{ format }}
          </el-dropdown-item>
        </el-dropdown-menu>
      </template>
    </el-dropdown>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import {
  CopyDocument,
  SuccessFilled,
  Download,
  Refresh,
  CircleCheck,
  CircleClose,
  CircleCloseFilled,
} from "@element-plus/icons-vue";

export type ChatMessageActionRole = "user" | "assistant";

export type DirectDownloadItem = {
  kind: "upload" | "file";
  path: string;
};

const props = withDefaults(
  defineProps<{
    role: ChatMessageActionRole;
    copied?: boolean;
    canRefresh?: boolean;
    refreshBusy?: boolean;
    canReact?: boolean;
    reactionActive?: number;
    likeLabel?: string;
    dislikeLabel?: string;
    generatedFormats?: string[];
    directDownloads?: DirectDownloadItem[];
  }>(),
  {
    copied: false,
    canRefresh: false,
    refreshBusy: false,
    canReact: false,
    reactionActive: 0,
    likeLabel: "",
    dislikeLabel: "",
    generatedFormats: () => [],
    directDownloads: () => [],
  }
);

const emit = defineEmits<{
  copy: [];
  refresh: [];
  reaction: [type: number];
  "direct-download": [path: string];
  "download-format": [format: string];
}>();

const { t } = useI18n();

const directDownloadsLabel = computed(() => {
  if (props.directDownloads.length === 1) {
    return props.directDownloads[0].kind === "upload"
      ? t("chat.downloadURL")
      : t("chat.downloadFile");
  }
  return t("chat.downloadFile");
});

const onDirectDownload = (path: string | number) => {
  emit("direct-download", String(path));
};

const onGeneratedFormat = (format: string | number) => {
  emit("download-format", String(format));
};
</script>

<style scoped lang="scss">
.message-footer {
  width: 100%;
  height: auto;
  display: flex;
  gap: var(--phy-space-8, 8px);
  flex-direction: row;
  justify-content: flex-end;
  align-items: center;
  margin-top: var(--phy-space-4, 4px);
  opacity: 1;
  visibility: visible;

  &--user {
    justify-content: flex-end;
  }

  &--assistant {
    justify-content: flex-start;
  }
}

.message-footer-item {
  display: inline-flex;
  justify-content: center;
  align-items: center;
  min-width: 44px;
  min-height: 44px;
  width: 44px;
  height: 44px;
  padding: var(--phy-space-4, 4px);
  box-sizing: border-box;
  border: none;
  border-radius: var(--phy-radius-sm, 4px);
  background: transparent;
  color: inherit;
  cursor: pointer;

  &:hover {
    color: var(--phy-color-action-text, var(--el-color-primary));
    background: var(--phy-color-fill-subtle, #eef3f0);
  }

  &:focus-visible {
    outline: 2px solid var(--phy-color-focus, var(--el-color-primary));
    outline-offset: 2px;
  }

  &.is-loading {
    animation: message-footer-spin 1s linear infinite;
  }

  &.reaction-btn.active {
    color: var(--phy-color-action-text, var(--el-color-primary));
  }
}

.reaction-buttons {
  display: inline-flex;
  gap: var(--phy-space-4, 4px);
  align-items: center;
}

@keyframes message-footer-spin {
  from {
    transform: rotate(0deg);
  }
  to {
    transform: rotate(360deg);
  }
}

/* Hover-capable pointers may hide idle chrome; focus-within keeps keyboard use
   visible. Touch / coarse pointers keep .is-touch-visible discoverable (no
   hover reduction). Parent sets --message-footer-opacity on row hover. */
@media (hover: hover) {
  .message-footer.is-touch-visible {
    opacity: var(--message-footer-opacity, 0);
  }

  .message-footer.is-touch-visible:focus-within {
    opacity: 1;
  }
}
</style>
