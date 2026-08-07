<template>
  <article
    class="chat-upload-card"
    data-testid="chat-upload-card"
    :data-upload-status="item.status"
  >
    <div class="chat-upload-card__content">
      <div class="chat-upload-card__heading">
        <div class="chat-upload-card__identity">
          <span
            class="chat-upload-card__name"
            :title="item.name"
            data-testid="chat-upload-name"
          >
            {{ item.name }}
          </span>
          <span class="chat-upload-card__size">
            {{ formatBytes(item.size) }}
          </span>
        </div>
        <span
          class="chat-upload-card__status"
          data-testid="chat-upload-status"
          role="status"
          aria-live="polite"
        >
          {{ statusLabel }}
        </span>
      </div>

      <div
        class="chat-upload-card__progress"
        role="progressbar"
        :aria-label="progressText"
        aria-valuemin="0"
        aria-valuemax="100"
        :aria-valuenow="progressPercent"
        :aria-valuetext="progressText"
        data-testid="chat-upload-progress"
      >
        <span
          class="chat-upload-card__progress-fill"
          :style="{ width: `${progressPercent}%` }"
        />
      </div>

      <div class="chat-upload-card__metrics" data-testid="chat-upload-metrics">
        <span>{{ progressText }}</span>
        <span v-if="speedText">{{ speedText }}</span>
        <span v-if="etaText">{{ etaText }}</span>
      </div>
    </div>

    <div class="chat-upload-card__actions" data-testid="chat-upload-actions">
      <button
        v-if="canPause"
        type="button"
        class="chat-upload-card__action"
        data-testid="chat-upload-pause"
        :aria-label="t('chat.upload.actions.pause', { file: item.name })"
        @click="emit('pause', item.localId)"
      >
        {{ t("chat.upload.pause") }}
      </button>
      <button
        v-if="item.status === 'paused'"
        type="button"
        class="chat-upload-card__action"
        data-testid="chat-upload-resume"
        :aria-label="t('chat.upload.actions.resume', { file: item.name })"
        @click="emit('resume', item.localId)"
      >
        {{ t("chat.upload.resume") }}
      </button>
      <button
        v-if="canRetry"
        type="button"
        class="chat-upload-card__action"
        data-testid="chat-upload-retry"
        :aria-label="t('chat.upload.actions.retry', { file: item.name })"
        @click="emit('retry', item.localId)"
      >
        {{ t("chat.upload.retry") }}
      </button>
      <button
        v-if="needsReselect"
        type="button"
        class="chat-upload-card__action"
        data-testid="chat-upload-reselect"
        :aria-label="t('chat.upload.actions.reselect', { file: item.name })"
        @click="fileInput?.click()"
      >
        {{ t("chat.upload.reselect") }}
      </button>
      <button
        v-if="canCancel"
        type="button"
        class="chat-upload-card__action chat-upload-card__action--quiet"
        data-testid="chat-upload-cancel"
        :aria-label="t('chat.upload.actions.cancel', { file: item.name })"
        @click="emit('cancel', item.localId)"
      >
        {{ t("chat.upload.cancel") }}
      </button>
      <button
        type="button"
        class="chat-upload-card__action chat-upload-card__action--quiet"
        data-testid="chat-upload-remove"
        :aria-label="t('chat.upload.actions.remove', { file: item.name })"
        @click="emit('remove', item.localId)"
      >
        {{ t("chat.upload.remove") }}
      </button>
    </div>

    <input
      ref="fileInput"
      class="chat-upload-card__file-input"
      type="file"
      tabindex="-1"
      :aria-label="t('chat.upload.actions.reselect', { file: item.name })"
      @change="handleFileChange"
    />
  </article>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import { useI18n } from "vue-i18n";
import { formatBytes, formatEta } from "@/utils/transfer-progress";
import type { ResumableUploadItem } from "../upload/types";

const props = defineProps<{ item: ResumableUploadItem }>();
const emit = defineEmits<{
  pause: [localId: string];
  resume: [localId: string];
  retry: [localId: string];
  reselect: [localId: string, file: File];
  cancel: [localId: string];
  remove: [localId: string];
}>();

const { t } = useI18n();
const fileInput = ref<HTMLInputElement | null>(null);

const progressPercent = computed(() => {
  if (props.item.status === "completed") return 100;
  if (!Number.isFinite(props.item.size) || props.item.size <= 0) return 0;
  return Math.min(
    100,
    Math.max(0, Math.round((props.item.loadedBytes / props.item.size) * 100))
  );
});

const statusLabel = computed(() =>
  t(`chat.upload.status.${props.item.status}`)
);

const progressText = computed(() =>
  t("chat.upload.progress", {
    loaded: formatBytes(props.item.loadedBytes),
    total: formatBytes(props.item.size),
    percent: progressPercent.value,
  })
);

const speedText = computed(() => {
  if (props.item.speedBytesPerSecond <= 0) return "";
  return t("chat.upload.speed", {
    rate: `${formatBytes(props.item.speedBytesPerSecond)}/s`,
  });
});

const etaText = computed(() => {
  const seconds = formatEta(props.item.etaSeconds);
  return seconds === null ? "" : t("chat.upload.eta", { seconds });
});

const canPause = computed(
  () => props.item.status === "creating" || props.item.status === "uploading"
);
const canRetry = computed(
  () => props.item.status === "failed" || props.item.status === "expired"
);
const canCancel = computed(
  () => !["completed", "aborted"].includes(props.item.status)
);
const needsReselect = computed(
  () =>
    props.item.file === null &&
    !["completed", "aborted"].includes(props.item.status)
);

const handleFileChange = (event: Event) => {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = "";
  if (file) emit("reselect", props.item.localId, file);
};
</script>

<style scoped>
.chat-upload-card {
  position: relative;
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  gap: var(--phy-space-12);
  width: 100%;
  box-sizing: border-box;
  padding: var(--phy-space-12);
  border: 1px solid var(--phy-color-border-subtle);
  border-radius: var(--phy-radius-md);
  background: var(--phy-color-bg-elevated);
  box-shadow: var(--phy-shadow-soft);
}

.chat-upload-card__content {
  min-width: 0;
}

.chat-upload-card__heading,
.chat-upload-card__identity,
.chat-upload-card__metrics {
  display: flex;
  align-items: center;
  min-width: 0;
}

.chat-upload-card__heading {
  justify-content: space-between;
  gap: var(--phy-space-8);
}

.chat-upload-card__identity {
  gap: var(--phy-space-8);
}

.chat-upload-card__name {
  min-width: 0;
  overflow: hidden;
  color: var(--phy-color-text);
  font-size: 0.8125rem;
  font-weight: 600;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.chat-upload-card__size,
.chat-upload-card__metrics {
  color: var(--phy-color-text-muted);
  font-size: 0.75rem;
  white-space: nowrap;
}

.chat-upload-card__status {
  flex: 0 0 auto;
  color: var(--phy-color-accent-text);
  font-size: 0.75rem;
  font-weight: 600;
}

.chat-upload-card[data-upload-status="failed"] .chat-upload-card__status,
.chat-upload-card[data-upload-status="expired"] .chat-upload-card__status {
  color: var(--phy-color-action-text);
}

.chat-upload-card__progress {
  position: relative;
  width: 100%;
  height: 6px;
  margin-top: var(--phy-space-8);
  overflow: hidden;
  border-radius: var(--phy-radius-pill);
  background: var(--phy-color-fill-subtle);
}

.chat-upload-card__progress-fill {
  display: block;
  height: 100%;
  border-radius: inherit;
  background: var(--phy-color-accent);
  transition: width var(--phy-motion-fast) var(--phy-motion-ease-out);
}

.chat-upload-card[data-upload-status="failed"] .chat-upload-card__progress-fill,
.chat-upload-card[data-upload-status="expired"]
  .chat-upload-card__progress-fill {
  background: var(--phy-color-action-fill);
}

.chat-upload-card__metrics {
  flex-wrap: wrap;
  gap: var(--phy-space-4) var(--phy-space-12);
  margin-top: var(--phy-space-4);
}

.chat-upload-card__actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: var(--phy-space-4);
}

.chat-upload-card__action {
  min-height: var(--phy-control-height-compact);
  padding: 0 var(--phy-space-8);
  border: 1px solid transparent;
  border-radius: var(--phy-radius-sm);
  background: var(--phy-color-brand-blue-soft);
  color: var(--phy-color-action-text);
  cursor: pointer;
  font: inherit;
  font-size: 0.75rem;
  white-space: nowrap;
}

.chat-upload-card__action:hover {
  background: var(--phy-color-accent-soft);
  color: var(--phy-color-accent-text);
}

.chat-upload-card__action:focus-visible {
  outline: 2px solid var(--phy-color-focus);
  outline-offset: 2px;
}

.chat-upload-card__action--quiet {
  background: transparent;
  color: var(--phy-color-text-secondary);
}

.chat-upload-card__file-input {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
  clip-path: inset(50%);
  white-space: nowrap;
}

@media (max-width: 600px) {
  .chat-upload-card {
    grid-template-columns: 1fr;
  }

  .chat-upload-card__actions {
    justify-content: flex-start;
  }
}

@media (max-width: 359px) {
  .chat-upload-card__heading {
    align-items: flex-start;
    flex-direction: column;
  }

  .chat-upload-card__action {
    flex: 1 1 auto;
  }
}

@media (prefers-reduced-motion: reduce) {
  .chat-upload-card__progress-fill {
    transition: none;
  }
}
</style>
