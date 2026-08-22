<template>
  <div
    v-if="routingNotice"
    class="routing-notice"
    :role="isRoutingFallbackNotice ? 'status' : undefined"
    data-testid="routing-notice"
  >
    {{ routingNotice }}
  </div>
  <div
    v-if="message.contextNotice?.degraded"
    class="context-degraded"
    role="status"
  >
    {{ $t("chat.contextDegraded") }}
  </div>
  <div
    v-if="showStandaloneCot"
    class="message-text phy-bubble-assistant agent-wait"
    :data-test="showWaitProgress ? 'agent-wait' : 'agent-wait-flush'"
  >
    <div class="agent-lifecycle" role="status" aria-live="polite">
      <SendProgress
        :started-at="resolvedProgressStartedAt"
        :agent-name="progressAgentName"
        :completing="isFlushingOfficialResult"
        :wait-children="props.lifecycle?.children ?? []"
        @flushed="onCotFlushed"
      />
    </div>
  </div>
  <!-- User message, lifecycle-owned DeepGenome, or an answer without reasoning steps -->
  <div
    v-if="
      message.role === 'user' ||
      (!isWaitOnlyBody &&
        !isFlushingOfficialResult &&
        (hasArtifactPresentation ||
          isDeepGenomeMessage ||
          isResearchNonterminal ||
          (!message.steps && !message.tableHeaders)))
    "
    :class="[
      'message-text',
      message.role === 'user'
        ? 'phy-bubble-user has-user'
        : 'phy-bubble-assistant',
    ]"
  >
    <!-- Streaming assistant messages (AG-UI content blocks) render via
         StreamMessage. Pass page ns=m${index} only when doc_list is nonempty so
         [N] stays literal until real reference rows exist; after the finalizer
         assigns phyto.references → doc_list, the same blocks rerender to
         #m<index>-ref-N links. Live-session only — history reload does not
         invent persisted streaming references. -->
    <div
      v-if="showInlineCot"
      class="agent-wait-inline"
      :data-test="showWaitProgress ? 'agent-wait' : 'agent-wait-flush'"
    >
      <div class="agent-lifecycle" role="status" aria-live="polite">
        <SendProgress
          :started-at="resolvedProgressStartedAt"
          :agent-name="progressAgentName"
          :completing="!showWaitProgress"
          :force-last-stage="cotFlushed && !showWaitProgress"
          :wait-children="props.lifecycle?.children ?? []"
        />
      </div>
    </div>
    <div
      v-if="showLeadingLifecycleStatus && !showWaitProgress"
      class="agent-lifecycle"
      role="status"
      aria-live="polite"
    >
      <span data-test="lifecycle-phase">{{ $t(lifecycleLabel) }}</span>
    </div>
    <template v-if="isResearchNonterminal && !hasArtifactPresentation" />
    <StreamMessage
      v-else-if="
        message.role === 'assistant' &&
        (message.streaming || (message.blocks && message.blocks.length))
      "
      :blocks="message.blocks || []"
      :references="message.doc_list"
      :ns="message.doc_list?.length ? 'm' + index : undefined"
      :message-id="message.id"
      :stream-presentation-key="message.streamPresentationKey"
      :activity-expanded-by-message="activityExpandedByMessage"
      :streaming="!!message.streaming"
      @update:activity-expanded="onActivityExpanded"
      @a2ui-action="(event) => emit('a2ui-action', event)"
      @a2ui-retry="(surfaceId) => emit('a2ui-retry', surfaceId)"
      @citation-activate="(activation) => emit('citation-activate', activation)"
    />
    <!-- GeneNetworkAgent image display -->
    <div
      v-else-if="
        message.role === 'assistant' &&
        message.tool_name === 'GeneNetworkAgent' &&
        !artifactPreview
      "
      class="gene-network-images"
    >
      <div
        v-if="lifecycleLabel && !showWaitProgress"
        class="agent-lifecycle"
        role="status"
        aria-live="polite"
      >
        <span data-test="lifecycle-phase">{{ $t(lifecycleLabel) }}</span>
      </div>
      <ScientificMarkdownTypewriter
        v-if="hasSpecializedReport && message?.instantMessage && isLastMessage"
        :source="chatContentToText(message.content)"
        :citation-namespace="'m' + index"
        surface="chat"
        @finish="emit('finish')"
      />
      <ScientificMarkdown
        v-else-if="hasSpecializedReport"
        :source="chatContentToText(message.content)"
        :citation-namespace="'m' + index"
        surface="chat"
      />
      <div
        v-if="
          !isTerminalLifecycle &&
          !showWaitProgress &&
          (geneNetworkImagesLoading[message.id || ''] ||
            awaitingSpecializedImages)
        "
        class="images-loading"
      >
        <el-icon class="is-loading"><Loading /></el-icon>
        {{ $t("common.loading") }}
      </div>
      <div
        v-else-if="
          !isTerminalLifecycle &&
          geneNetworkImages[message.id || '']?.length > 0
        "
        class="images-container"
      >
        <img
          v-for="(imgUrl, imgIndex) in geneNetworkImages[message.id || '']"
          :key="imgIndex"
          :src="imgUrl"
          :alt="$t('chat.resultImageAlt', { index: imgIndex + 1 })"
          class="result-image"
        />
      </div>
      <div v-else-if="shouldShowSpecializedNoData" class="no-images">
        {{ $t("common.noData") }}
      </div>
    </div>
    <!-- DigitalDesignAgent image display -->
    <div
      v-else-if="
        message.role === 'assistant' &&
        message.tool_name === 'DigitalDesignAgent' &&
        !artifactPreview
      "
      class="gene-network-images"
    >
      <div
        v-if="lifecycleLabel && !showWaitProgress"
        class="agent-lifecycle"
        role="status"
        aria-live="polite"
      >
        <span data-test="lifecycle-phase">{{ $t(lifecycleLabel) }}</span>
      </div>
      <ScientificMarkdownTypewriter
        v-if="hasSpecializedReport && message?.instantMessage && isLastMessage"
        :source="chatContentToText(message.content)"
        :citation-namespace="'m' + index"
        surface="chat"
        @finish="emit('finish')"
      />
      <ScientificMarkdown
        v-else-if="hasSpecializedReport"
        :source="chatContentToText(message.content)"
        :citation-namespace="'m' + index"
        surface="chat"
      />
      <div
        v-if="
          !isTerminalLifecycle &&
          !showWaitProgress &&
          (digitalDesignImagesLoading[message.id || ''] ||
            awaitingSpecializedImages)
        "
        class="images-loading"
      >
        <el-icon class="is-loading"><Loading /></el-icon>
        {{ $t("common.loading") }}
      </div>
      <div
        v-else-if="
          !isTerminalLifecycle &&
          digitalDesignImages[message.id || '']?.length > 0
        "
        class="images-container"
      >
        <img
          v-for="(imgUrl, imgIndex) in digitalDesignImages[message.id || '']"
          :key="imgIndex"
          :src="imgUrl"
          :alt="$t('chat.resultImageAlt', { index: imgIndex + 1 })"
          class="result-image"
        />
      </div>
      <div v-else-if="shouldShowSpecializedNoData" class="no-images">
        {{ $t("common.noData") }}
      </div>
    </div>
    <ResearchArtifactPreview
      v-else-if="hasArtifactPresentation && artifactPreview"
      :title="artifactPreview.title"
      :kind="artifactPreview.kind"
      :summary="artifactPreview.summary"
      :open-label="artifactPreview.openLabel"
      :format-scientific-agent-name="
        message.tool_name === 'InSilicoResearchAgent'
      "
      @open="emit('open-artifact')"
    />
    <template v-else-if="isDeepGenomeMessage">
      <DeepGenomeResultViewer
        v-if="hasMeaningfulDeepGenomeReport"
        :markdown="
          artifactPresentation?.report ?? chatContentToText(message.content)
        "
        :references="message.doc_list || []"
        :ns="'m' + index"
        :rendering-file-id="message.id"
        :show-actions="showDeepGenomeFinalActions"
        :show-references="hasDeepGenomeReferences"
        embedded
      />
      <p
        v-else-if="showDeepGenomeResultUnavailable"
        class="deep-genome-result-unavailable"
      >
        {{ $t("chat.lifecycle.resultUnavailable") }}
      </p>
    </template>
    <CitedAnswer
      v-else-if="
        message.doc_list &&
        message.doc_list.length > 0 &&
        message.role === 'assistant'
      "
      :content="chatContentToText(message.content)"
      :references="message.doc_list"
      :ns="'m' + index"
      surface="chat"
      :instant-message="(message?.instantMessage && isLastMessage) || false"
      @finish="emit('finish')"
    />
    <ScientificMarkdownTypewriter
      v-else-if="
        message?.instantMessage && isLastMessage && !hideWaitPlaceholderBody
      "
      :source="chatContentToText(message.content)"
      :citation-namespace="'m' + index"
      surface="chat"
      @finish="emit('finish')"
    />
    <ScientificMarkdown
      v-else-if="!hideWaitPlaceholderBody"
      :source="chatContentToText(message.content)"
      :citation-namespace="'m' + index"
      surface="chat"
    />
  </div>
  <!-- Table data display -->
  <div
    v-else-if="
      !isWaitOnlyBody && !isFlushingOfficialResult && message.tableHeaders
    "
    class="table-response"
  >
    <el-table
      :data="chatContentToRows(message.content)"
      border
      style="width: 100%"
    >
      <el-table-column
        v-for="header in message.tableHeaders"
        :key="header.prop"
        :prop="header.prop"
        :label="header.label"
        align="center"
      />
    </el-table>
  </div>
  <!-- Assistant answer with reasoning steps; currently unused 2025/07/21 -->
  <div
    v-else-if="!isWaitOnlyBody && !isFlushingOfficialResult"
    class="ai-response"
  >
    <!-- Reasoning steps -->
    <div v-if="message.steps && message.steps.length > 0">
      <div class="steps-title">{{ $t("chat.stepResult") }}:</div>
      <div
        v-for="(step, stepIndex) in message.steps"
        :key="stepIndex"
        class="step-item"
      >
        <div v-if="stepIndex === 0" class="step-label">
          {{ $t("chat.useTool") }}
        </div>
        <div v-else class="step-label">
          {{ $t("chat.stepResult") }}
        </div>
        <div class="step-text">{{ step }}</div>
      </div>
    </div>
    <!-- Final answer -->
    <div class="final-answer">
      <ScientificMarkdownTypewriter
        v-if="message?.instantMessage && isLastMessage"
        :source="chatContentToText(message.content)"
        :citation-namespace="'m' + index"
        surface="chat"
        @finish="emit('finish')"
      />
      <ScientificMarkdown
        v-else
        :source="chatContentToText(message.content)"
        :citation-namespace="'m' + index"
        surface="chat"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { Loading } from "@element-plus/icons-vue";
import ScientificMarkdown from "@/components/ScientificMarkdown.vue";
import ScientificMarkdownTypewriter from "@/components/ScientificMarkdownTypewriter.vue";
import CitedAnswer from "@/components/CitedAnswer.vue";
import DeepGenomeResultViewer from "@/components/DeepGenomeResultViewer.vue";
import ResearchArtifactPreview from "@/components/research/ResearchArtifactPreview.vue";
import StreamMessage from "./StreamMessage.vue";
import SendProgress from "./SendProgress.vue";
import { computed, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import type { AgentTaskLifecycle } from "@/api/types";
import type { ChatMessage } from "../types";
import {
  isAgentWaitPhase,
  isStreamWaitProgressMessage,
  parseProgressStartedAt,
  progressStartedAtFor,
} from "../utils/agentProgress";
import {
  CANONICAL_AGENT_DISPLAY_NAMES,
  CANONICAL_AGENT_ZH_NAMES,
  type CanonicalAgentTool,
} from "@/constants/agents";
import type { A2uiSurfaceActionEvent } from "../composables/useA2uiInteraction";
import type { ScientificCitationActivation } from "@/utils/scientific-markdown/types";
import { chatContentToRows, chatContentToText } from "../messageTypes";
import { normalizePositiveTaskRowId } from "@/api/task";
import {
  artifactPresentationForMessage,
  isDeepGenomeTransportPlaceholder,
  isMeaningfulDeepGenomeReport,
} from "../utils/artifact-policy";
import { isApprovedReportText } from "../utils/valid-report-ledger";

const props = defineProps<{
  message: ChatMessage;
  index: number;
  isLastMessage: boolean;
  artifactPreview?: {
    title: string;
    kind: string;
    summary: string;
    openLabel: string;
  } | null;
  activityExpandedByMessage?: Record<string, boolean>;
  geneNetworkImages: Record<string, string[]>;
  geneNetworkImagesLoading: Record<string, boolean>;
  digitalDesignImages: Record<string, string[]>;
  digitalDesignImagesLoading: Record<string, boolean>;
  lifecycle?: AgentTaskLifecycle;
  progressStartedAt?: number | null;
}>();

const emit = defineEmits<{
  finish: [];
  "open-artifact": [];
  "update:activity-expanded": [stateKey: string, expanded: boolean];
  "a2ui-action": [event: A2uiSurfaceActionEvent];
  "a2ui-retry": [surfaceId: string];
  "citation-activate": [activation: ScientificCitationActivation];
}>();

const { t, locale } = useI18n();

const onActivityExpanded = (stateKey: string, expanded: boolean) => {
  emit("update:activity-expanded", stateKey, expanded);
};

function routedAgentLabel(): string {
  const tool = props.message.tool_name;
  if (!tool || !(tool in CANONICAL_AGENT_ZH_NAMES)) return "";
  const agent =
    locale.value === "zh-CN"
      ? CANONICAL_AGENT_ZH_NAMES[tool as CanonicalAgentTool]
      : CANONICAL_AGENT_DISPLAY_NAMES[tool as CanonicalAgentTool];
  return t("chat.routingSelectedAgent", { agent });
}

const isRoutingFallbackNotice = computed(
  () => props.message.route_reason_code === "CHAT_FALLBACK"
);

const routingNotice = computed(() => {
  if (props.message.role !== "assistant") return "";
  const reason = props.message.route_reason_code;
  if (reason === "CHAT_FALLBACK") {
    return t("chat.routingFallbackChat");
  }
  if (reason === "ROUTER_SELECTED" || reason === "EXPLICIT_SELECTION") {
    return routedAgentLabel();
  }
  if (showWaitProgress.value || isFlushingOfficialResult.value) {
    return routedAgentLabel();
  }
  return "";
});

// Canonical tool_name spelling: 'DeepGenomeAgent'.
const isDeepGenomeMessage = computed(
  () =>
    props.message.role === "assistant" &&
    props.message.tool_name === "DeepGenomeAgent"
);
const isResearchMessage = computed(
  () =>
    props.message.role === "assistant" &&
    props.message.tool_name === "InSilicoResearchAgent"
);
const artifactPresentation = computed(() =>
  artifactPresentationForMessage(props.message)
);
const hasArtifactPresentation = computed(
  () => artifactPresentation.value !== null
);
const hasMeaningfulDeepGenomeReport = computed(
  () =>
    isDeepGenomeMessage.value &&
    (artifactPresentation.value?.kind === "deep-genome" ||
      isMeaningfulDeepGenomeReport(props.message.content))
);
const hasDeepGenomeReferences = computed(
  () => isDeepGenomeMessage.value && (props.message.doc_list?.length ?? 0) > 0
);

function messageLifecyclePhase(): AgentTaskLifecycle["phase"] | null {
  const status = props.message.status?.trim().toUpperCase();
  if (status === "PENDING" || status === "SUBMITTED") return "PREPARING";
  if (status === "TIMEOUT" || status === "TIMED_OUT") return "TIMED_OUT";
  if (status === "CANCELED") return "CANCELLED";
  if (
    isResearchMessage.value &&
    (status === "RESOLVING_INPUTS" ||
      status === "PLANNING" ||
      status === "FINALIZING")
  ) {
    return status;
  }
  if (
    status === "PREPARING" ||
    status === "RUNNING" ||
    status === "FINALIZING" ||
    status === "SUCCEEDED" ||
    status === "FAILED" ||
    status === "TIMED_OUT" ||
    status === "CANCELLED"
  ) {
    return status;
  }
  if (
    isDeepGenomeMessage.value &&
    !hasMeaningfulDeepGenomeReport.value &&
    isDeepGenomeTransportPlaceholder(props.message.content)
  ) {
    try {
      normalizePositiveTaskRowId(props.message.id ?? "");
      return "PREPARING";
    } catch {
      return null;
    }
  }
  return null;
}

const effectiveLifecyclePhase = computed(
  () => props.lifecycle?.phase ?? messageLifecyclePhase()
);
const isResearchNonterminal = computed(
  () =>
    isResearchMessage.value &&
    (effectiveLifecyclePhase.value === "PREPARING" ||
      effectiveLifecyclePhase.value === "RESOLVING_INPUTS" ||
      effectiveLifecyclePhase.value === "PLANNING" ||
      effectiveLifecyclePhase.value === "RUNNING" ||
      effectiveLifecyclePhase.value === "FINALIZING")
);
const lifecycleLabel = computed(() =>
  effectiveLifecyclePhase.value
    ? `chat.lifecycle.${effectiveLifecyclePhase.value.toLowerCase()}`
    : ""
);
const showDeepGenomeFinalActions = computed(
  () =>
    effectiveLifecyclePhase.value === null ||
    effectiveLifecyclePhase.value === "SUCCEEDED"
);
const showDeepGenomeResultUnavailable = computed(
  () =>
    isDeepGenomeMessage.value &&
    effectiveLifecyclePhase.value === "SUCCEEDED" &&
    !hasMeaningfulDeepGenomeReport.value
);
const isSpecializedImageAgent = computed(
  () =>
    props.message.tool_name === "GeneNetworkAgent" ||
    props.message.tool_name === "DigitalDesignAgent"
);
const showLeadingLifecycleStatus = computed(
  () =>
    props.message.role === "assistant" &&
    lifecycleLabel.value !== "" &&
    (isResearchNonterminal.value ||
      (!props.message.streaming &&
        !(props.message.blocks && props.message.blocks.length))) &&
    !isSpecializedImageAgent.value
);
const streamWaitProgress = computed(() =>
  isStreamWaitProgressMessage(props.message)
);
const showWaitProgress = computed(
  () =>
    props.message.role === "assistant" &&
    (isAgentWaitPhase(effectiveLifecyclePhase.value) ||
      streamWaitProgress.value)
);
const sawActiveWait = ref(false);
const cotFlushed = ref(false);
watch(
  showWaitProgress,
  (active) => {
    if (active) {
      sawActiveWait.value = true;
      cotFlushed.value = false;
    }
  },
  { immediate: true }
);
const progressAgentName = computed(() =>
  typeof props.message.tool_name === "string" ? props.message.tool_name : ""
);
const resolvedProgressStartedAt = computed(() =>
  progressStartedAtFor(
    props.message.id || `row-${props.index}`,
    props.progressStartedAt ?? parseProgressStartedAt(props.message.created_at)
  )
);
const isWaitOnlyBodyContent = computed(() => {
  if (isDeepGenomeMessage.value && !hasArtifactPresentation.value) return true;
  if (hasArtifactPresentation.value) return false;
  if (hasMeaningfulDeepGenomeReport.value) return false;
  if (hasSpecializedReport.value && !isDeepGenomeMessage.value) return false;
  if (streamWaitProgress.value) return true;
  if (props.message.streaming) return false;
  if (props.message.blocks && props.message.blocks.length) return false;
  if (props.message.doc_list && props.message.doc_list.length > 0) return false;
  return true;
});
const isWaitOnlyBody = computed(
  () => showWaitProgress.value && isWaitOnlyBodyContent.value
);
const isFlushingOfficialResult = computed(
  () =>
    sawActiveWait.value &&
    !showWaitProgress.value &&
    !cotFlushed.value &&
    effectiveLifecyclePhase.value === "SUCCEEDED" &&
    !isWaitOnlyBodyContent.value
);
const hideWaitPlaceholderBody = computed(
  () =>
    props.message.role === "assistant" &&
    sawActiveWait.value &&
    !showWaitProgress.value &&
    isWaitOnlyBodyContent.value
);
const showStandaloneCot = computed(
  () =>
    (showWaitProgress.value && isWaitOnlyBody.value) ||
    isFlushingOfficialResult.value
);
const showInlineCot = computed(
  () =>
    (showWaitProgress.value && !isWaitOnlyBody.value) ||
    (sawActiveWait.value && cotFlushed.value && !showStandaloneCot.value)
);
function onCotFlushed() {
  cotFlushed.value = true;
}
const isTerminalLifecycle = computed(
  () =>
    effectiveLifecyclePhase.value === "FAILED" ||
    effectiveLifecyclePhase.value === "TIMED_OUT" ||
    effectiveLifecyclePhase.value === "CANCELLED"
);
const hasSpecializedReport = computed(() =>
  isApprovedReportText(props.message.tool_name ?? "", props.message.content)
);
const activeSpecializedLifecycle = computed(
  () =>
    effectiveLifecyclePhase.value === "PREPARING" ||
    effectiveLifecyclePhase.value === "RUNNING" ||
    effectiveLifecyclePhase.value === "FINALIZING"
);
const awaitingSpecializedImages = computed(
  () =>
    activeSpecializedLifecycle.value &&
    (props.lifecycle?.artifact_summary.image_count ?? 0) > 0
);
const selectedImages = computed(() =>
  props.message.tool_name === "GeneNetworkAgent"
    ? props.geneNetworkImages[props.message.id || ""]
    : props.digitalDesignImages[props.message.id || ""]
);
const shouldShowSpecializedNoData = computed(() => {
  if (!props.lifecycle) {
    return (
      (effectiveLifecyclePhase.value === null ||
        effectiveLifecyclePhase.value === "SUCCEEDED") &&
      !hasSpecializedReport.value &&
      (selectedImages.value?.length ?? 0) === 0
    );
  }
  return (
    props.lifecycle.phase === "SUCCEEDED" &&
    !hasSpecializedReport.value &&
    (selectedImages.value?.length ?? 0) === 0 &&
    props.lifecycle.artifact_summary.image_count === 0 &&
    props.lifecycle.artifact_summary.output_directory_count === 0
  );
});
</script>

<style scoped lang="scss">
.routing-notice,
.context-degraded {
  margin: 0 0 var(--phy-space-8);
  color: var(--phy-color-text-muted);
  font-size: 13px;
  line-height: 1.4;
}

.agent-wait {
  width: fit-content;
  max-width: 100%;
}

.agent-wait-inline {
  margin-bottom: var(--phy-space-8);
}

.agent-lifecycle {
  margin-bottom: var(--phy-space-8);
  color: var(--phy-color-text-muted);
  font-size: 13px;
}

.agent-wait .agent-lifecycle,
.agent-wait-inline .agent-lifecycle {
  margin-bottom: 0;
}

.deep-genome-result-unavailable {
  margin: 0;
  padding: var(--phy-space-8) 0;
  color: var(--phy-color-text-muted);
  font-size: 14px;
}

/* Content owns internal overflow so wide children cannot stretch the transcript. */
.message-text {
  position: relative;
  min-width: 0;
  max-width: 100%;
  overflow-x: auto;
  word-break: break-word;
  box-sizing: border-box;

  &.phy-bubble-user {
    white-space: pre-wrap;
  }

  &.phy-bubble-assistant {
    white-space: normal;
  }

  :deep(pre),
  :deep(table),
  :deep(.el-table) {
    max-width: 100%;
    overflow-x: auto;
  }
}

.table-response {
  min-width: 0;
  max-width: 100%;
  overflow-x: auto;
  box-sizing: border-box;
}

.gene-network-images {
  min-width: 0;
  max-width: 100%;
  overflow-x: auto;

  .images-loading {
    display: flex;
    align-items: center;
    gap: var(--phy-space-8);
    color: var(--phy-color-text-muted);
    font-size: 14px;
    padding: var(--phy-space-12) 0;
  }

  .images-container {
    display: flex;
    flex-direction: column;
    gap: var(--phy-space-12);
    min-width: 0;
    max-width: 100%;
    overflow-x: auto;

    .result-image {
      max-width: 100%;
      border-radius: var(--phy-radius-sm);
      box-shadow: var(--phy-shadow-soft);
    }
  }

  .no-images {
    color: var(--phy-color-text-muted);
    font-size: 14px;
    padding: var(--phy-space-12) 0;
  }
}
</style>
