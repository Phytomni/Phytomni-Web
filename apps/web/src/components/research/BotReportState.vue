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

    <ScientificMarkdown
      v-if="reportText && !showWaitProgress"
      :source="reportText"
      :citation-namespace="ns"
      :reference-count="referenceCount"
      :resources="resources"
      surface="artifact"
      data-test="bot-report-content"
      @citation-activate="emit('citation-activate', $event)"
      @resource-activate="emit('resource-activate', $event)"
    />
    <SendProgress
      v-else-if="showWaitProgress"
      :started-at="resolvedProgressStartedAt"
      :agent-name="agentName"
      :completing="isFlushingOfficialResult"
      :stage-label="statusLabel"
      @flushed="onCotFlushed"
    />
    <p
      v-else-if="
        state.status !== 'TIMED_OUT' &&
        state.status !== 'CANCELLED' &&
        !activeReportHidden
      "
      class="bot-report-state__empty"
      data-test="bot-report-empty"
    >
      {{ emptyReportLabel }}
    </p>

    <p
      v-if="state.failures.length > 0"
      class="bot-report-state__failure"
      data-test="bot-report-failure"
    >
      {{ resolvedFailureLabel }}
    </p>
  </section>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import ScientificMarkdown from "@/components/ScientificMarkdown.vue";
import SendProgress from "@/views/chat/components/SendProgress.vue";
import { formatDisplayDate } from "@/locales/format-display-date";
import { progressStartedAtFor } from "@/views/chat/utils/agentProgress";
import type { BotProgress } from "@/views/chat/botProjection";
import type { BotLifecycleState } from "@/views/chat/streaming/botLifecycleReducer";
import type {
  AuthorizedScientificResource,
  ScientificCitationActivation,
  ScientificResourceActivation,
} from "@/utils/scientific-markdown/types";

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
  if (
    state.status === "FAILED" ||
    state.status === "TIMED_OUT" ||
    state.status === "CANCELLED"
  ) {
    return "failed";
  }
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
    /** Selected report text from the shared Chat artifact policy. */
    report?: string | null;
    ns: string;
    referenceCount?: number;
    resources?: readonly AuthorizedScientificResource[];
    labels?: Partial<Record<BotReportStatus, string>>;
    emptyReportLabel?: string;
    failureLabel?: string;
    hideActiveReport?: boolean;
    agentName?: string;
    progressStartedAt?: number | null;
  }>(),
  {
    progress: null,
    updatedAt: null,
    report: null,
    referenceCount: 0,
    resources: () => [],
    labels: () => ({}),
    hideActiveReport: false,
    agentName: "",
    progressStartedAt: null,
  }
);

const emit = defineEmits<{
  "citation-activate": [activation: ScientificCitationActivation];
  "resource-activate": [activation: ScientificResourceActivation];
}>();

const { t, d } = useI18n();
const lifecycleMetadata = computed(() => props.state as LifecycleMetadata);
const activeReportHidden = computed(
  () =>
    props.hideActiveReport &&
    (props.state.status === "RUNNING" ||
      props.state.status === "INPUT_REQUIRED")
);
const reportStatus = computed(() => {
  const status = reportStatusForLifecycle(props.state);
  return activeReportHidden.value && status === "complete" ? "loading" : status;
});
const reportText = computed(() => {
  if (typeof props.report === "string" && props.report.trim()) {
    return props.report;
  }
  if (activeReportHidden.value) return "";
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
  if (props.state.status === "CANCELLED") {
    return t("chat.lifecycle.cancelled");
  }
  if (props.state.status === "TIMED_OUT") {
    return t("chat.lifecycle.timed_out");
  }
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
  if (props.state.status === "TIMED_OUT") {
    return t("chat.lifecycle.timed_out");
  }
  return reportStatus.value === "failed"
    ? t("common.failed")
    : t("common.loading");
});
const resolvedFailureLabel = computed(() => {
  if (props.state.status === "CANCELLED") {
    return t("chat.lifecycle.cancelled");
  }
  if (props.failureLabel) return props.failureLabel;
  return props.state.status === "TIMED_OUT"
    ? t("chat.lifecycle.timed_out")
    : t("common.failed");
});

const effectiveUpdatedAt = computed(
  () => props.updatedAt ?? lifecycleMetadata.value.reportUpdatedAt ?? null
);
const updatedAtLabel = computed(() =>
  effectiveUpdatedAt.value
    ? formatDisplayDate(d, effectiveUpdatedAt.value, "datetime")
    : ""
);

const resolvedProgressStartedAt = computed(() =>
  progressStartedAtFor(
    props.state.runId || "bot-report",
    props.progressStartedAt
  )
);
const sawActiveWait = ref(false);
const cotFlushed = ref(false);
const isLoadingStatus = computed(() => reportStatus.value === "loading");
watch(
  isLoadingStatus,
  (loading) => {
    if (loading) {
      sawActiveWait.value = true;
      cotFlushed.value = false;
    }
  },
  { immediate: true }
);
const isFlushingOfficialResult = computed(
  () =>
    sawActiveWait.value &&
    reportStatus.value === "complete" &&
    !cotFlushed.value &&
    Boolean(reportText.value)
);
const showWaitProgress = computed(
  () =>
    (isLoadingStatus.value && !reportText.value) ||
    isFlushingOfficialResult.value
);
function onCotFlushed() {
  cotFlushed.value = true;
}
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
