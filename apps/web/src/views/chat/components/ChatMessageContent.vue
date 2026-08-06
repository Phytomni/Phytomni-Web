<template>
  <div
    v-if="message.contextNotice?.degraded"
    class="context-degraded"
    role="status"
  >
    {{ $t("chat.contextDegraded") }}
  </div>
  <!-- User message, or an answer without reasoning steps -->
  <div
    v-if="message.role === 'user' || (!message.steps && !message.tableHeaders)"
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
      v-if="showLeadingLifecycleStatus"
      class="agent-lifecycle"
      role="status"
      aria-live="polite"
    >
      {{ $t(lifecycleLabel) }}
    </div>
    <StreamMessage
      v-if="
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
    />
    <!-- GeneNetworkAgent image display -->
    <div
      v-else-if="
        message.role === 'assistant' && message.tool_name === 'GeneNetworkAgent'
      "
      class="gene-network-images"
    >
      <div
        v-if="lifecycleLabel"
        class="agent-lifecycle"
        role="status"
        aria-live="polite"
      >
        {{ $t(lifecycleLabel) }}
      </div>
      <MarkdownViewer
        v-if="hasSpecializedReport"
        :instantMessage="(message?.instantMessage && isLastMessage) || false"
        :content="chatContentToText(message.content)"
        surface="chat"
        @finish="emit('finish')"
      />
      <div
        v-if="
          !isTerminalLifecycle &&
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
        message.tool_name === 'DigitalDesignAgent'
      "
      class="gene-network-images"
    >
      <div
        v-if="lifecycleLabel"
        class="agent-lifecycle"
        role="status"
        aria-live="polite"
      >
        {{ $t(lifecycleLabel) }}
      </div>
      <MarkdownViewer
        v-if="hasSpecializedReport"
        :instantMessage="(message?.instantMessage && isLastMessage) || false"
        :content="chatContentToText(message.content)"
        surface="chat"
        @finish="emit('finish')"
      />
      <div
        v-if="
          !isTerminalLifecycle &&
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
      v-else-if="artifactPreview"
      :title="artifactPreview.title"
      :kind="artifactPreview.kind"
      :summary="artifactPreview.summary"
      :open-label="artifactPreview.openLabel"
      :format-scientific-agent-name="
        message.tool_name === 'InSilicoResearchAgent'
      "
      @open="emit('open-artifact')"
    />
    <!-- Ineligible DeepGenome results (streaming, missing id, failed, or
         transient file loading) retain the embedded compatibility viewer. -->
    <DeepGenomeResultViewer
      v-else-if="
        message.role === 'assistant' && message.tool_name === 'DeepGenomeAgent'
      "
      :markdown="chatContentToText(message.content).replace(/\n/g, '\\n')"
      :references="message.doc_list || []"
      :ns="'m' + index"
      embedded
    />
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
    <MarkdownViewer
      v-else
      :instantMessage="(message?.instantMessage && isLastMessage) || false"
      :content="chatContentToText(message.content)"
      surface="chat"
      @finish="emit('finish')"
    />
  </div>
  <!-- Table data display -->
  <div v-else-if="message.tableHeaders" class="table-response">
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
  <div v-else class="ai-response">
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
      <MarkdownViewer
        :instantMessage="(message?.instantMessage && isLastMessage) || false"
        :content="chatContentToText(message.content)"
        surface="chat"
        @finish="emit('finish')"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { Loading } from "@element-plus/icons-vue";
import MarkdownViewer from "@/components/MarkdownViewer.vue";
import CitedAnswer from "@/components/CitedAnswer.vue";
import DeepGenomeResultViewer from "@/components/DeepGenomeResultViewer.vue";
import ResearchArtifactPreview from "@/components/research/ResearchArtifactPreview.vue";
import StreamMessage from "./StreamMessage.vue";
import { computed } from "vue";
import type { AgentTaskLifecycle } from "@/api/types";
import type { ChatMessage } from "../types";
import type { A2uiSurfaceActionEvent } from "../composables/useA2uiInteraction";
import { chatContentToRows, chatContentToText } from "../messageTypes";

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
}>();

const emit = defineEmits<{
  finish: [];
  "open-artifact": [];
  "update:activity-expanded": [stateKey: string, expanded: boolean];
  "a2ui-action": [event: A2uiSurfaceActionEvent];
  "a2ui-retry": [surfaceId: string];
}>();

const onActivityExpanded = (stateKey: string, expanded: boolean) => {
  emit("update:activity-expanded", stateKey, expanded);
};

function messageLifecyclePhase(): AgentTaskLifecycle["phase"] | null {
  const status = props.message.status?.trim().toUpperCase();
  if (status === "PENDING" || status === "SUBMITTED") return "PREPARING";
  if (status === "TIMEOUT" || status === "TIMED_OUT") return "FAILED";
  if (status === "CANCELED") return "CANCELLED";
  if (
    status === "PREPARING" ||
    status === "RUNNING" ||
    status === "SUCCEEDED" ||
    status === "FAILED" ||
    status === "CANCELLED"
  ) {
    return status;
  }
  return null;
}

const effectiveLifecyclePhase = computed(
  () => props.lifecycle?.phase ?? messageLifecyclePhase()
);
const lifecycleLabel = computed(() =>
  effectiveLifecyclePhase.value
    ? `chat.lifecycle.${effectiveLifecyclePhase.value.toLowerCase()}`
    : ""
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
    !props.message.streaming &&
    !(props.message.blocks && props.message.blocks.length) &&
    !isSpecializedImageAgent.value
);
const isTerminalLifecycle = computed(
  () =>
    effectiveLifecyclePhase.value === "FAILED" ||
    effectiveLifecyclePhase.value === "CANCELLED"
);
const hasSpecializedReport = computed(
  () =>
    typeof props.message.content === "string" &&
    props.message.content.trim() !== ""
);
const activeSpecializedLifecycle = computed(
  () =>
    effectiveLifecyclePhase.value === "PREPARING" ||
    effectiveLifecyclePhase.value === "RUNNING"
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
.context-degraded {
  margin: 0 0 var(--phy-space-8);
  color: var(--phy-color-text-muted);
  font-size: 13px;
  line-height: 1.4;
}

.agent-lifecycle {
  margin-bottom: var(--phy-space-8);
  color: var(--phy-color-text-muted);
  font-size: 13px;
}

/* Content owns internal overflow so wide children cannot stretch the transcript. */
.message-text {
  position: relative;
  min-width: 0;
  max-width: 100%;
  overflow-x: auto;
  word-break: break-word;
  white-space: pre-wrap;
  box-sizing: border-box;

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
