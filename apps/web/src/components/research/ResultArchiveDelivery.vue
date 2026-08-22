<template>
  <slot v-if="!activeV1" name="legacy" />
  <section
    v-else
    class="result-archive-delivery"
    data-test="result-archive-delivery"
    aria-live="polite"
  >
    <template v-if="delivery?.status === 'pending'">
      <el-icon class="result-archive-delivery__spinner is-loading"
        ><Loading
      /></el-icon>
      <span>{{ t("chat.resultArchive.preparing") }}</span>
    </template>

    <template v-else-if="delivery?.status === 'ready' && readyArtifact">
      <span class="result-archive-delivery__name">{{
        readyArtifact.name
      }}</span>
      <el-tooltip :content="downloadLabel" placement="top">
        <el-button
          text
          circle
          :aria-label="downloadLabel"
          :data-artifact-id="readyArtifact.id"
          data-test="result-archive-download"
          @click="emit('download', readyArtifact)"
        >
          <el-icon><Download /></el-icon>
        </el-button>
      </el-tooltip>
    </template>

    <template v-else-if="delivery?.status === 'failed' && delivery.retryable">
      <span>{{ t("chat.resultArchive.generationFailed") }}</span>
      <el-tooltip :content="retryLabel" placement="top">
        <el-button
          text
          circle
          :loading="retrying"
          :disabled="retrying"
          :aria-label="retrying ? retryingLabel : retryLabel"
          data-test="result-archive-retry"
          @click="emit('retry')"
        >
          <el-icon><RefreshRight /></el-icon>
        </el-button>
      </el-tooltip>
    </template>

    <template
      v-else-if="
        delivery?.status === 'failed' &&
        delivery.error_code === 'no_user_deliverables'
      "
    >
      <span data-test="result-archive-none">{{
        t("chat.resultArchive.none")
      }}</span>
    </template>

    <template v-else>
      <span>{{ t("chat.resultArchive.unavailable") }}</span>
    </template>
  </section>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { Download, Loading, RefreshRight } from "@element-plus/icons-vue";
import { useI18n } from "vue-i18n";
import type {
  AgentResultDelivery,
  ConversationArtifactLink,
} from "@/api/types";

const props = withDefaults(
  defineProps<{
    activeV1?: boolean;
    delivery?: AgentResultDelivery;
    artifacts?: readonly ConversationArtifactLink[];
    retrying?: boolean;
  }>(),
  {
    activeV1: true,
    artifacts: () => [],
    retrying: false,
  }
);

const emit = defineEmits<{
  retry: [];
  download: [artifact: ConversationArtifactLink];
}>();

const { t } = useI18n();

const readyArtifact = computed<ConversationArtifactLink | null>(() => {
  if (props.delivery?.status !== "ready" || props.artifacts.length !== 1) {
    return null;
  }
  const [artifact] = props.artifacts;
  if (
    artifact.kind !== "archive" ||
    artifact.name !== props.delivery.name ||
    artifact.id.trim() === ""
  ) {
    return null;
  }
  return artifact;
});

const downloadLabel = computed(() =>
  t("chat.resultArchive.download", { name: readyArtifact.value?.name ?? "" })
);
const retryLabel = computed(() => t("chat.resultArchive.retry"));
const retryingLabel = computed(() => t("chat.resultArchive.retrying"));
</script>

<style scoped>
.result-archive-delivery {
  display: flex;
  align-items: center;
  gap: var(--phy-space-8);
  min-width: 0;
  padding: var(--phy-space-8) 0;
  border-bottom: 1px solid var(--phy-color-border-subtle);
  color: var(--phy-color-text-secondary);
  font-size: 14px;
  line-height: 1.4;
}

.result-archive-delivery__spinner {
  flex: 0 0 auto;
}

.result-archive-delivery__name {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
