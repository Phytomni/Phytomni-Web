<template>
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
    <StreamMessage
      v-if="
        message.role === 'assistant' &&
        (message.streaming || (message.blocks && message.blocks.length))
      "
      :blocks="message.blocks || []"
      :references="message.doc_list"
      :ns="message.doc_list?.length ? 'm' + index : undefined"
      :run-id="streamRunId"
      :transport="streamTransport"
    />
    <!-- GeneNetworkAgent image display -->
    <div
      v-else-if="
        message.role === 'assistant' && message.tool_name === 'GeneNetworkAgent'
      "
      class="gene-network-images"
    >
      <div
        v-if="geneNetworkImagesLoading[message.id || '']"
        class="images-loading"
      >
        <el-icon class="is-loading"><Loading /></el-icon>
        {{ $t("common.loading") }}
      </div>
      <div
        v-else-if="geneNetworkImages[message.id || '']?.length > 0"
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
      <div v-else class="no-images">
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
        v-if="digitalDesignImagesLoading[message.id || '']"
        class="images-loading"
      >
        <el-icon class="is-loading"><Loading /></el-icon>
        {{ $t("common.loading") }}
      </div>
      <div
        v-else-if="digitalDesignImages[message.id || '']?.length > 0"
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
      <div v-else class="no-images">
        {{ $t("common.noData") }}
      </div>
    </div>
    <!-- DeepGenomeAgent responses use a dedicated viewer component with a references list;
         other tool_name values fall back to the generic MarkdownViewer -->
    <DeepGenomeResultViewer
      v-else-if="
        message.doc_list &&
        message.doc_list.length > 0 &&
        message.role === 'assistant' &&
        message.tool_name === 'DeepGenomeAgent'
      "
      :markdown="message.content.replace(/\n/g, '\\n')"
      :references="message.doc_list || []"
      :ns="'m' + index"
    />
    <CitedAnswer
      v-else-if="
        message.doc_list &&
        message.doc_list.length > 0 &&
        message.role === 'assistant'
      "
      :content="message.content"
      :references="message.doc_list"
      :ns="'m' + index"
      :instant-message="(message?.instantMessage && isLastMessage) || false"
      @finish="emit('finish')"
    />
    <MarkdownViewer
      v-else
      :instantMessage="(message?.instantMessage && isLastMessage) || false"
      :content="message.content"
      @finish="emit('finish')"
    />
  </div>
  <!-- Table data display -->
  <div v-else-if="message.tableHeaders" class="table-response">
    <el-table :data="message.content" border style="width: 100%">
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
      <div class="steps-title">{{ $t("chat.stepResult") }}：</div>
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
        :content="message.content"
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
import StreamMessage from "./StreamMessage.vue";
import type { A2uiActionTransport } from "../streaming/a2uiAction";
import type { ChatMessage } from "../types";

defineProps<{
  message: ChatMessage;
  index: number;
  isLastMessage: boolean;
  streamRunId?: string;
  streamTransport?: A2uiActionTransport | null;
  geneNetworkImages: Record<string, string[]>;
  geneNetworkImagesLoading: Record<string, boolean>;
  digitalDesignImages: Record<string, string[]>;
  digitalDesignImagesLoading: Record<string, boolean>;
}>();

const emit = defineEmits<{
  finish: [];
}>();
</script>

<style scoped lang="scss">
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
