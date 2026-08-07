<template>
  <div
    v-if="items.length > 0"
    class="attachment-chip-strip"
    data-testid="attachment-chip-strip"
    role="group"
    :aria-label="t('chat.upload.attachments')"
  >
    <button
      v-for="item in directItems"
      :key="item.localId"
      type="button"
      class="attachment-chip"
      data-testid="attachment-chip"
      :data-state="item.status"
      :disabled="disabled"
      :aria-label="chipAccessibleName(item)"
      @click="emit('select', item.localId)"
    >
      <el-icon
        class="attachment-chip__icon"
        data-testid="attachment-chip-file-icon"
        aria-hidden="true"
      >
        <Document />
      </el-icon>
      <span
        class="attachment-chip__suffix"
        data-testid="attachment-chip-suffix"
        aria-hidden="true"
      >
        {{ fileSuffix(item.name) }}
      </span>
      <span
        class="attachment-chip__name"
        data-testid="attachment-chip-name"
        aria-hidden="true"
      >
        {{ item.name }}
      </span>
      <span
        class="attachment-chip__status"
        data-testid="attachment-chip-status"
        aria-hidden="true"
      >
        {{ statusLabel(item) }}
      </span>
      <span
        class="attachment-chip__metric"
        data-testid="attachment-chip-metric"
        aria-hidden="true"
      >
        {{ metricLabel(item) }}
      </span>
    </button>

    <button
      v-if="hiddenItems.length > 0"
      type="button"
      class="attachment-chip attachment-chip--overflow"
      data-testid="attachment-chip-overflow"
      :disabled="disabled"
      :aria-label="overflowLabel"
      @click="emit('select', hiddenItems[0].localId)"
    >
      <el-icon class="attachment-chip__icon" aria-hidden="true">
        <MoreFilled />
      </el-icon>
      <span>{{ overflowLabel }}</span>
    </button>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { Document, MoreFilled } from "@element-plus/icons-vue";
import { useI18n } from "vue-i18n";
import { formatBytes } from "@/utils/transfer-progress";
import type { ResumableUploadItem } from "../upload/types";

const props = withDefaults(
  defineProps<{
    items: readonly ResumableUploadItem[];
    disabled?: boolean;
  }>(),
  {
    disabled: false,
  }
);

const emit = defineEmits<{
  select: [localId: string];
  pause: [localId: string];
  resume: [localId: string];
  retry: [localId: string];
  reselect: [localId: string, file: File];
  cancel: [localId: string];
  remove: [localId: string];
}>();

const { t } = useI18n();

const directItems = computed(() => props.items.slice(0, 3));
const hiddenItems = computed(() =>
  props.items.length > 3 ? props.items.slice(3) : []
);

const progressStatuses = new Set([
  "creating",
  "uploading",
  "paused",
  "completing",
]);

const progressPercent = (item: ResumableUploadItem): number => {
  if (item.status === "completed") return 100;
  if (!Number.isFinite(item.size) || item.size <= 0) return 0;
  return Math.min(
    100,
    Math.max(0, Math.round((item.loadedBytes / item.size) * 100))
  );
};

const statusLabel = (item: ResumableUploadItem): string =>
  t(`chat.upload.status.${item.status}`);

const metricLabel = (item: ResumableUploadItem): string => {
  if (!progressStatuses.has(item.status)) return formatBytes(item.size);
  return t("chat.upload.progress", {
    loaded: formatBytes(item.loadedBytes),
    total: formatBytes(item.size),
    percent: progressPercent(item),
  });
};

const chipAccessibleName = (item: ResumableUploadItem): string =>
  t("chat.upload.chipLabel", {
    file: item.name,
    suffix: fileSuffix(item.name),
    status: statusLabel(item),
    metric: metricLabel(item),
  });

const fileSuffix = (name: string): string => {
  const dot = name.lastIndexOf(".");
  if (dot <= 0 || dot === name.length - 1) {
    return t("chat.upload.fileSuffixFallback");
  }
  return name.slice(dot + 1, dot + 7).toLocaleUpperCase("en-US");
};

const overflowLabel = computed(() => {
  const labels = [
    t("chat.upload.more", {
      count: hiddenItems.value.length,
    }),
  ];
  const failed = hiddenItems.value.filter(
    (item) => item.status === "failed"
  ).length;
  const expired = hiddenItems.value.filter(
    (item) => item.status === "expired"
  ).length;

  if (failed > 0) {
    labels.push(t("chat.upload.hiddenFailed", { count: failed }));
  }
  if (expired > 0) {
    labels.push(t("chat.upload.hiddenExpired", { count: expired }));
  }
  return labels.join(" · ");
});
</script>

<style scoped>
.attachment-chip-strip {
  display: flex;
  flex-wrap: nowrap;
  align-items: center;
  gap: clamp(4px, 1vw, 8px);
  inline-size: 100%;
  min-inline-size: 0;
  padding-block: 2px;
  overflow-x: auto;
  overflow-y: hidden;
  overscroll-behavior-inline: contain;
  scrollbar-width: thin;
}

.attachment-chip {
  display: inline-flex;
  flex: 0 1 clamp(160px, 30vw, 288px);
  align-items: center;
  gap: 6px;
  min-inline-size: min(160px, 75vw);
  max-inline-size: min(288px, 85vw);
  min-block-size: 36px;
  padding: 6px 10px;
  border: 1px solid var(--phy-color-border-subtle);
  border-radius: var(--phy-radius-pill);
  color: var(--phy-color-text-secondary);
  background: var(--phy-color-bg-elevated);
  box-shadow: var(--phy-shadow-soft);
  font: inherit;
  white-space: nowrap;
  cursor: pointer;
}

.attachment-chip:hover:not(:disabled) {
  border-color: var(--phy-color-border-control);
  background: var(--phy-color-fill-subtle);
}

.attachment-chip:focus-visible {
  outline: 2px solid var(--phy-color-focus);
  outline-offset: 2px;
}

.attachment-chip:disabled {
  color: var(--phy-color-text-disabled);
  cursor: not-allowed;
}

.attachment-chip__icon {
  flex: none;
  color: var(--phy-color-action-text);
}

.attachment-chip__suffix {
  flex: none;
  color: var(--phy-color-accent-text);
  font-size: 0.6875rem;
  font-weight: 700;
  letter-spacing: 0.04em;
}

.attachment-chip__name {
  flex: 1 1 auto;
  min-inline-size: 2.5rem;
  overflow: hidden;
  color: var(--phy-color-text);
  font-size: 0.8125rem;
  font-weight: 600;
  text-overflow: ellipsis;
}

.attachment-chip__status,
.attachment-chip__metric {
  flex: none;
  font-size: 0.6875rem;
}

.attachment-chip__metric {
  color: var(--phy-color-text-muted);
}

.attachment-chip--overflow {
  flex: none;
  min-inline-size: auto;
  max-inline-size: none;
  color: var(--phy-color-action-text);
  font-size: 0.75rem;
  font-weight: 600;
}
</style>
