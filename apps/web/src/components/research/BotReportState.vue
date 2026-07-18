<template>
  <section
    class="bot-report-state"
    :data-report-status="reportStatus"
    :aria-busy="reportStatus === 'loading' ? 'true' : undefined"
    aria-live="polite"
  >
    <div class="bot-report-state__status" data-test="bot-report-status">
      <span class="bot-report-state__status-label">{{ statusLabel }}</span>
      <span
        v-if="updatedAtLabel"
        class="bot-report-state__updated-at"
        data-test="bot-report-updated-at"
      >
        {{ updatedAtLabel }}
      </span>
    </div>

    <div
      v-if="progressVisible"
      class="bot-report-state__progress"
      data-test="bot-report-progress"
      aria-live="polite"
    >
      <span>{{ progressLabel }}</span>
      <span>{{ progressSummary }}</span>
    </div>

    <MarkdownViewer
      v-if="reportText"
      :content="reportText"
      :ns="ns"
      surface="artifact"
      data-test="bot-report-content"
    />
    <p v-else class="bot-report-state__empty" data-test="bot-report-empty">
      {{ emptyReportLabel }}
    </p>

    <p
      v-if="state.failures.length > 0"
      class="bot-report-state__failure"
      data-test="bot-report-failure"
    >
      {{ failureLabel }}
    </p>
  </section>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import MarkdownViewer from "@/components/MarkdownViewer.vue";
import { formatDisplayDate } from "@/locales/format-display-date";
import type { BotProgress } from "@/views/chat/botProjection";
import type { BotLifecycleState } from "@/views/chat/streaming/botLifecycleReducer";

type BotReportStatus = "loading" | "degraded" | "complete" | "failed";

type LifecycleMetadata = BotLifecycleState & {
  reportStage?: "waiting_for_brief_gene" | "intermediate" | "final" | null;
  reportUpdatedAt?: string | null;
  progress?: BotProgress | null;
};

function reportStatusForLifecycle(
  lifecycle: BotLifecycleState
): BotReportStatus {
  const state = lifecycle as LifecycleMetadata;
  if (state.status === "FAILED") return "failed";
  if (state.reportStage === "waiting_for_brief_gene") return "loading";
  if (state.status === "INPUT_REQUIRED") return "loading";
  if (state.degraded || state.reportStage === "intermediate") return "degraded";
  if (
    state.reportStage === "final" ||
    state.status === "SUCCEEDED" ||
    state.finalReport.trim() !== ""
  ) {
    return "complete";
  }
  return "loading";
}

const props = withDefaults(
  defineProps<{
    state: BotLifecycleState;
    progress?: BotProgress | null;
    updatedAt?: string | number | Date | null;
    ns?: string;
    labels?: Partial<Record<BotReportStatus, string>>;
    emptyReportLabel?: string;
  }>(),
  {
    progress: null,
    updatedAt: null,
    ns: "",
    labels: () => ({}),
  }
);

const { t, d } = useI18n();
const lifecycleMetadata = computed(() => props.state as LifecycleMetadata);
const reportStatus = computed(() => reportStatusForLifecycle(props.state));
const reportText = computed(() => {
  const state = props.state;
  if (typeof state.visibleReport === "string" && state.visibleReport.trim()) {
    return state.visibleReport;
  }
  if (typeof state.finalReport === "string" && state.finalReport.trim()) {
    return state.finalReport;
  }
  return typeof state.intermediateReport === "string"
    ? state.intermediateReport
    : "";
});

const statusLabel = computed(() => {
  const custom = props.labels[reportStatus.value];
  if (custom) return custom;
  switch (reportStatus.value) {
    case "degraded":
      return t("common.warning");
    case "complete":
      return t("common.finished");
    case "failed":
      return t("common.failed");
    default:
      return t("common.loading");
  }
});

const emptyReportLabel = computed(() => {
  if (props.emptyReportLabel) return props.emptyReportLabel;
  return reportStatus.value === "failed"
    ? t("common.failed")
    : t("common.loading");
});
const failureLabel = computed(() => t("common.failed"));

const effectiveUpdatedAt = computed(
  () => props.updatedAt ?? lifecycleMetadata.value.reportUpdatedAt ?? null
);
const updatedAtLabel = computed(() =>
  effectiveUpdatedAt.value
    ? formatDisplayDate(d, effectiveUpdatedAt.value, "datetime")
    : ""
);

const progressVisible = computed(() => {
  const progress = props.progress ?? lifecycleMetadata.value.progress ?? null;
  if (!progress) return false;
  return (
    progress.total > 0 ||
    progress.completed > 0 ||
    progress.failed > 0 ||
    progress.pending > 0
  );
});
const progressLabel = computed(() => t("chat.log.activityLabel"));
const progressSummary = computed(() => {
  const progress = props.progress ?? lifecycleMetadata.value.progress ?? null;
  if (!progress) return "";
  const completed = Number.isFinite(progress.completed)
    ? progress.completed
    : 0;
  const total = Number.isFinite(progress.total) ? progress.total : 0;
  return `${completed}/${total}`;
});
</script>

<style scoped>
.bot-report-state {
  min-width: 0;
  color: var(--phy-color-text);
  font-family: var(--phy-font-shell);
}

.bot-report-state__status {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: var(--phy-space-12);
  margin-bottom: var(--phy-space-16);
  color: var(--phy-color-text-secondary);
  font-size: 0.8125rem;
}

.bot-report-state__status-label {
  color: var(--phy-color-accent-text);
  font-weight: 600;
}

.bot-report-state__updated-at {
  color: var(--phy-color-text-muted);
}

.bot-report-state__progress {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--phy-space-12);
  margin-bottom: var(--phy-space-16);
  padding: var(--phy-space-8) var(--phy-space-12);
  border: 1px solid var(--phy-color-border-subtle);
  border-radius: var(--phy-radius-sm);
  color: var(--phy-color-text-secondary);
  font-size: 0.8125rem;
}

.bot-report-state__empty,
.bot-report-state__failure {
  margin: 0;
  color: var(--phy-color-text-muted);
}

.bot-report-state__failure {
  margin-top: var(--phy-space-16);
  color: var(--phy-color-danger-text, var(--phy-color-text-muted));
}
</style>
