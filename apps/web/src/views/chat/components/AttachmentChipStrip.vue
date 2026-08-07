<template>
  <div
    v-if="items.length > 0"
    class="attachment-chip-strip"
    data-testid="attachment-chip-strip"
    role="group"
    :aria-label="t('chat.upload.attachments')"
    ref="detailAnchor"
  >
    <div class="attachment-chip-strip__row">
      <button
        v-for="item in directItems"
        :key="item.localId"
        type="button"
        class="attachment-chip"
        data-testid="attachment-chip"
        :data-state="item.status"
        :disabled="disabled"
        :aria-label="chipAccessibleName(item)"
        @click="openDetails(item, $event)"
        @keydown.enter.prevent="openDetails(item, $event)"
        @keydown.space.prevent="openDetails(item, $event)"
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
        @click="openOverflowDetails($event)"
        @keydown.enter.prevent="openOverflowDetails($event)"
        @keydown.space.prevent="openOverflowDetails($event)"
      >
        <el-icon class="attachment-chip__icon" aria-hidden="true">
          <MoreFilled />
        </el-icon>
        <span>{{ overflowLabel }}</span>
      </button>
    </div>

    <section
      v-if="activeItem"
      ref="detailSurface"
      class="attachment-chip-detail"
      data-testid="attachment-chip-detail"
      tabindex="-1"
      role="region"
      :aria-label="chipAccessibleName(activeItem)"
      :style="detailSurfaceStyle"
      @keydown.esc.prevent.stop="closeDetails"
    >
      <div class="attachment-chip-detail__heading">
        <span class="attachment-chip-detail__name">{{ activeItem.name }}</span>
        <span class="attachment-chip-detail__status">
          {{ statusLabel(activeItem) }}
        </span>
      </div>
      <div class="attachment-chip-detail__metrics">
        <span
          class="attachment-chip-detail__progress"
          data-testid="attachment-chip-detail-progress"
          role="progressbar"
          :aria-label="
            t('chat.upload.progressLabel', { file: activeItem.name })
          "
          aria-valuemin="0"
          aria-valuemax="100"
          :aria-valuenow="progressPercent(activeItem)"
          :aria-valuetext="detailProgressText(activeItem)"
        >
          {{ detailProgressText(activeItem) }}
        </span>
        <template v-if="showsTransferMetrics(activeItem)">
          <span data-testid="attachment-chip-detail-speed">
            {{ speedText(activeItem) }}
          </span>
          <span
            v-if="etaText(activeItem)"
            data-testid="attachment-chip-detail-eta"
          >
            {{ etaText(activeItem) }}
          </span>
        </template>
      </div>
      <div
        v-if="isHiddenItem(activeItem)"
        class="attachment-chip-detail__overflow-list"
        data-testid="attachment-chip-overflow-list"
      >
        <button
          v-for="item in hiddenItems"
          :key="item.localId"
          type="button"
          class="attachment-chip-detail__overflow-item"
          data-testid="attachment-chip-overflow-item"
          :data-state="item.status"
          :aria-label="chipAccessibleName(item)"
          @click="openHiddenDetails(item, $event)"
          @keydown.enter.prevent="openHiddenDetails(item, $event)"
          @keydown.space.prevent="openHiddenDetails(item, $event)"
        >
          {{ item.name }}
        </button>
      </div>
      <div class="attachment-chip-detail__actions">
        <button
          v-if="canPause(activeItem)"
          type="button"
          class="attachment-chip-detail__action"
          data-testid="attachment-chip-detail-pause"
          :aria-label="
            t('chat.upload.actions.pause', { file: activeItem.name })
          "
          @click="emit('pause', activeItem.localId)"
        >
          {{ t("chat.upload.pause") }}
        </button>
        <button
          v-if="activeItem.status === 'paused'"
          type="button"
          class="attachment-chip-detail__action"
          data-testid="attachment-chip-detail-resume"
          :aria-label="
            t('chat.upload.actions.resume', { file: activeItem.name })
          "
          @click="emit('resume', activeItem.localId)"
        >
          {{ t("chat.upload.resume") }}
        </button>
        <button
          v-if="canRetry(activeItem)"
          type="button"
          class="attachment-chip-detail__action"
          data-testid="attachment-chip-detail-retry"
          :aria-label="
            t('chat.upload.actions.retry', { file: activeItem.name })
          "
          @click="emit('retry', activeItem.localId)"
        >
          {{ t("chat.upload.retry") }}
        </button>
        <button
          v-if="needsReselect(activeItem)"
          type="button"
          class="attachment-chip-detail__action"
          data-testid="attachment-chip-detail-reselect"
          :aria-label="
            t('chat.upload.actions.reselect', { file: activeItem.name })
          "
          @click="requestReselect(activeItem.localId)"
        >
          {{ t("chat.upload.reselect") }}
        </button>
        <button
          v-if="canCancel(activeItem)"
          type="button"
          class="attachment-chip-detail__action attachment-chip-detail__action--quiet"
          data-testid="attachment-chip-detail-cancel"
          :aria-label="
            t('chat.upload.actions.cancel', { file: activeItem.name })
          "
          @click="emit('cancel', activeItem.localId)"
        >
          {{ t("chat.upload.cancel") }}
        </button>
        <button
          type="button"
          class="attachment-chip-detail__action attachment-chip-detail__action--quiet"
          data-testid="attachment-chip-detail-remove"
          :aria-label="
            t('chat.upload.actions.remove', { file: activeItem.name })
          "
          @click="emit('remove', activeItem.localId)"
        >
          {{ t("chat.upload.remove") }}
        </button>
      </div>
    </section>

    <input
      ref="fileInput"
      class="attachment-chip-detail__file-input"
      data-testid="attachment-chip-reselect-input"
      type="file"
      tabindex="-1"
      @change="handleFileChange"
    />
  </div>
  <p
    class="attachment-chip-strip__live-region"
    data-testid="attachment-chip-live-region"
    role="status"
    aria-live="polite"
    aria-atomic="true"
  >
    {{ liveAnnouncement }}
  </p>
</template>

<script setup lang="ts">
import {
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  watch,
} from "vue";
import { Document, MoreFilled } from "@element-plus/icons-vue";
import { useI18n } from "vue-i18n";
import { formatBytes, formatEta } from "@/utils/transfer-progress";
import type { ResumableUploadItem } from "../upload/types";

const props = withDefaults(
  defineProps<{
    items: readonly ResumableUploadItem[];
    disabled?: boolean;
    announcement?: string;
    announcementNonce?: number;
  }>(),
  {
    disabled: false,
    announcement: "",
    announcementNonce: 0,
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
const activeLocalId = ref<string | null>(null);
const detailAnchor = ref<HTMLElement | null>(null);
const detailSurface = ref<HTMLElement | null>(null);
const fileInput = ref<HTMLInputElement | null>(null);
const originControl = ref<HTMLButtonElement | null>(null);
const detailMaxBlockSize = ref("20rem");
const liveAnnouncement = ref("");
let liveAnnouncementRevision = 0;

const directItems = computed(() => props.items.slice(0, 3));
const hiddenItems = computed(() =>
  props.items.length > 3 ? props.items.slice(3) : []
);
const activeItem = computed(
  () => props.items.find((item) => item.localId === activeLocalId.value) ?? null
);
const detailSurfaceStyle = computed(() => ({
  "--attachment-chip-detail-max-block-size": detailMaxBlockSize.value,
}));

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

const announcedStatuses = new Set(["completed", "failed", "paused", "expired"]);

const announcePolite = async (announcement: string): Promise<void> => {
  const normalized = announcement.trim();
  const revision = ++liveAnnouncementRevision;
  if (normalized === "") {
    liveAnnouncement.value = "";
    return;
  }
  if (liveAnnouncement.value !== normalized) {
    liveAnnouncement.value = normalized;
    return;
  }
  liveAnnouncement.value = "";
  await nextTick();
  if (revision === liveAnnouncementRevision) {
    liveAnnouncement.value = normalized;
  }
};

const statusSignature = computed(() =>
  props.items.map((item) => ({ localId: item.localId, status: item.status }))
);

watch(statusSignature, (current, previous) => {
  const previousStatuses = new Map(
    previous.map((item) => [item.localId, item.status])
  );
  const announcements = current.flatMap((item) => {
    const previousStatus = previousStatuses.get(item.localId);
    if (
      previousStatus === undefined ||
      previousStatus === item.status ||
      !announcedStatuses.has(item.status)
    ) {
      return [];
    }
    const currentItem = props.items.find(
      (candidate) => candidate.localId === item.localId
    );
    if (!currentItem) return [];
    return [
      t("chat.upload.stateChanged", {
        file: currentItem.name,
        status: statusLabel(currentItem),
      }),
    ];
  });
  if (announcements.length > 0) {
    announcePolite(announcements.join(" · ")).catch(() => undefined);
  }
});

watch(
  [() => props.announcement, () => props.announcementNonce],
  ([announcement]) => {
    announcePolite(announcement).catch(() => undefined);
  },
  { immediate: true }
);

const metricLabel = (item: ResumableUploadItem): string => {
  if (!progressStatuses.has(item.status)) return formatBytes(item.size);
  return t("chat.upload.progress", {
    loaded: formatBytes(item.loadedBytes),
    total: formatBytes(item.size),
    percent: progressPercent(item),
  });
};

const detailProgressText = (item: ResumableUploadItem): string =>
  t("chat.upload.progress", {
    loaded: formatBytes(item.loadedBytes),
    total: formatBytes(item.size),
    percent: progressPercent(item),
  });

const speedText = (item: ResumableUploadItem): string =>
  t("chat.upload.speed", {
    rate: `${formatBytes(item.speedBytesPerSecond)}/s`,
  });

const etaText = (item: ResumableUploadItem): string => {
  const seconds = formatEta(item.etaSeconds);
  return seconds === null ? "" : t("chat.upload.eta", { seconds });
};

const showsTransferMetrics = (item: ResumableUploadItem): boolean =>
  ["creating", "uploading", "completing"].includes(item.status);

const isHiddenItem = (item: ResumableUploadItem): boolean =>
  hiddenItems.value.some((hiddenItem) => hiddenItem.localId === item.localId);

const canPause = (item: ResumableUploadItem): boolean =>
  item.status === "creating" || item.status === "uploading";

const canRetry = (item: ResumableUploadItem): boolean =>
  item.status === "failed" || item.status === "expired";

const canCancel = (item: ResumableUploadItem): boolean =>
  !["completed", "aborted"].includes(item.status);

const needsReselect = (item: ResumableUploadItem): boolean =>
  item.file === null && !["completed", "aborted"].includes(item.status);

const openDetails = (
  item: ResumableUploadItem,
  event: MouseEvent | KeyboardEvent,
  preserveOrigin = false
) => {
  emit("select", item.localId);
  activeLocalId.value = item.localId;
  if (!preserveOrigin) {
    originControl.value =
      event.currentTarget instanceof HTMLButtonElement
        ? event.currentTarget
        : null;
  }
  updateDetailMaxHeight();
  nextTick(() => detailSurface.value?.focus());
};

const openOverflowDetails = (event: MouseEvent | KeyboardEvent) => {
  const item = hiddenItems.value[0];
  if (item) openDetails(item, event);
};

const openHiddenDetails = (
  item: ResumableUploadItem,
  event: MouseEvent | KeyboardEvent
) => {
  openDetails(item, event, true);
};

const closeDetails = () => {
  activeLocalId.value = null;
  nextTick(() => originControl.value?.focus());
};

const requestReselect = (localId: string) => {
  activeLocalId.value = localId;
  fileInput.value?.click();
};

const handleFileChange = (event: Event) => {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = "";
  if (file && activeLocalId.value) emit("reselect", activeLocalId.value, file);
};

watch(activeItem, (item) => {
  if (activeLocalId.value && !item) closeDetails();
});

const updateDetailMaxHeight = () => {
  const anchorTop = detailAnchor.value?.getBoundingClientRect().top;
  if (typeof anchorTop !== "number") return;
  detailMaxBlockSize.value = `${Math.max(1, Math.floor(anchorTop - 16))}px`;
};

const handleViewportResize = () => {
  if (activeLocalId.value) updateDetailMaxHeight();
};

onMounted(() => window.addEventListener("resize", handleViewportResize));
onBeforeUnmount(() =>
  window.removeEventListener("resize", handleViewportResize)
);

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
  position: relative;
  inline-size: 100%;
  min-inline-size: 0;
  padding-block: 2px;
  overflow: visible;
}

.attachment-chip-strip__row {
  display: flex;
  flex-wrap: nowrap;
  align-items: center;
  gap: clamp(4px, 1vw, 8px);
  overflow-x: auto;
  overflow-y: hidden;
  overscroll-behavior-inline: contain;
  scrollbar-width: thin;
}

.attachment-chip-strip__live-region {
  position: absolute;
  inline-size: 1px;
  block-size: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
  clip-path: inset(50%);
  white-space: nowrap;
}

.attachment-chip {
  display: inline-flex;
  flex: 0 1 clamp(160px, 30vw, 288px);
  align-items: center;
  gap: 6px;
  min-inline-size: min(160px, 75vw);
  max-inline-size: min(288px, 85vw);
  min-block-size: var(--phy-control-height-default);
  padding: 6px 10px;
  border: 1px solid var(--phy-color-border-subtle);
  border-radius: var(--phy-radius-pill);
  color: var(--phy-color-text-secondary);
  background: var(--phy-color-bg-elevated);
  box-shadow: var(--phy-shadow-soft);
  font: inherit;
  white-space: nowrap;
  cursor: pointer;
  transition:
    border-color var(--phy-motion-fast) var(--phy-motion-ease-out),
    background-color var(--phy-motion-fast) var(--phy-motion-ease-out),
    color var(--phy-motion-fast) var(--phy-motion-ease-out);
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

.attachment-chip-detail {
  position: absolute;
  z-index: 1;
  inset-block-end: calc(100% + var(--phy-space-8));
  inset-inline-start: 0;
  box-sizing: border-box;
  display: grid;
  gap: var(--phy-space-8);
  inline-size: min(34rem, calc(100vw - var(--phy-space-24)), 100%);
  max-inline-size: min(34rem, calc(100vw - var(--phy-space-24)), 100%);
  max-block-size: var(--attachment-chip-detail-max-block-size);
  padding: var(--phy-space-12);
  overflow-y: auto;
  border: 1px solid var(--phy-color-border-subtle);
  border-radius: var(--phy-radius-md);
  background: var(--phy-color-bg-elevated);
  box-shadow: var(--phy-shadow-soft);
  transition:
    border-color var(--phy-motion-fast) var(--phy-motion-ease-out),
    background-color var(--phy-motion-fast) var(--phy-motion-ease-out);
}

.attachment-chip-detail:focus-visible {
  outline: 2px solid var(--phy-color-focus);
  outline-offset: 2px;
}

.attachment-chip-detail__heading,
.attachment-chip-detail__metrics,
.attachment-chip-detail__actions,
.attachment-chip-detail__overflow-list {
  display: flex;
  align-items: center;
  gap: var(--phy-space-8);
  min-inline-size: 0;
}

.attachment-chip-detail__heading {
  justify-content: space-between;
}

.attachment-chip-detail__name {
  min-inline-size: 0;
  overflow: hidden;
  color: var(--phy-color-text);
  font-size: 0.8125rem;
  font-weight: 600;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.attachment-chip-detail__status {
  flex: none;
  color: var(--phy-color-accent-text);
  font-size: 0.75rem;
  font-weight: 600;
}

.attachment-chip-detail__metrics {
  flex-wrap: wrap;
  color: var(--phy-color-text-muted);
  font-size: 0.75rem;
}

.attachment-chip-detail__progress {
  transition: color var(--phy-motion-fast) var(--phy-motion-ease-out);
}

.attachment-chip-detail__actions {
  flex-wrap: wrap;
}

.attachment-chip-detail__overflow-list {
  flex-wrap: wrap;
}

.attachment-chip-detail__overflow-item {
  min-block-size: var(--phy-control-height-default);
  min-inline-size: 0;
  max-inline-size: 100%;
  padding-inline: var(--phy-space-8);
  overflow: hidden;
  border: 0;
  background: transparent;
  color: var(--phy-color-action-text);
  cursor: pointer;
  font: inherit;
  font-size: 0.75rem;
  text-align: start;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.attachment-chip-detail__overflow-item:focus-visible {
  outline: 2px solid var(--phy-color-focus);
  outline-offset: 2px;
}

.attachment-chip-detail__action {
  min-block-size: var(--phy-control-height-default);
  padding-inline: var(--phy-space-8);
  border: 1px solid transparent;
  border-radius: var(--phy-radius-sm);
  background: var(--phy-color-brand-blue-soft);
  color: var(--phy-color-action-text);
  cursor: pointer;
  font: inherit;
  font-size: 0.75rem;
  transition:
    background-color var(--phy-motion-fast) var(--phy-motion-ease-out),
    color var(--phy-motion-fast) var(--phy-motion-ease-out);
}

.attachment-chip-detail__action:hover {
  background: var(--phy-color-accent-soft);
  color: var(--phy-color-accent-text);
}

.attachment-chip-detail__action:focus-visible {
  outline: 2px solid var(--phy-color-focus);
  outline-offset: 2px;
}

.attachment-chip-detail__action--quiet {
  background: transparent;
  color: var(--phy-color-text-secondary);
}

.attachment-chip-detail__file-input {
  position: absolute;
  inline-size: 1px;
  block-size: 1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
  clip-path: inset(50%);
  white-space: nowrap;
}

@media (forced-colors: active) {
  .attachment-chip,
  .attachment-chip-detail,
  .attachment-chip-detail__overflow-item,
  .attachment-chip-detail__action {
    border-color: ButtonText;
  }

  .attachment-chip[data-state="failed"],
  .attachment-chip[data-state="expired"],
  .attachment-chip-detail__overflow-item[data-state="failed"],
  .attachment-chip-detail__overflow-item[data-state="expired"] {
    border-style: double;
  }

  .attachment-chip__status,
  .attachment-chip-detail__status {
    color: CanvasText;
  }
}

@media (prefers-reduced-motion: reduce) {
  .attachment-chip,
  .attachment-chip-detail,
  .attachment-chip-detail__progress,
  .attachment-chip-detail__action {
    transition: none;
  }
}
</style>
