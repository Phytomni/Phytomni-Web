<template>
  <AgentDemoShell
    :title="$t('agents.deepGenome.title')"
    :subtitle="$t('agents.deepGenome.subtitle')"
    @back="goBack"
  >
    <template #question>{{ DEEP_GENOME_CASE_QUESTION }}</template>

    <template #result>
      <DeepGenomeArtifact
        :title="$t('agents.deepGenome.title')"
        :metadata="$t('agents.deepGenome.subtitle')"
        :markdown="DEEP_GENOME_CASE_MARKDOWN"
        :references="DEEP_GENOME_CASE_REFERENCES"
        ns="deep-genome-demo"
        :tab-labels="artifactTabLabels"
        :tabs="artifactTabs"
        :tablist-label="t('common.operation')"
        artifact-id="deep-genome-demo-artifact"
        :back-label="t('common.back')"
        :close-label="t('common.close')"
        :action-label="t('common.operation')"
        :menu-items="artifactMenuItems"
        ref="artifactRef"
        @back="goBack"
        @close="goBack"
        @action="onArtifactMenu"
      />
    </template>

    <template #footer>{{ $t("common.aiDisclaimer") }}</template>
  </AgentDemoShell>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import { useRouter } from "vue-router";
import { useI18n } from "vue-i18n";
import { ElMessage } from "element-plus";
import { AgentDemoShell } from "@/components/demo";
import {
  DeepGenomeArtifact,
  copyDownloadCloseArtifactMenuItems,
} from "@/components/research";
import {
  artifactChrome,
  artifactDownloadFormat,
} from "@/views/chat/utils/artifact-chrome";
import {
  DEEP_GENOME_CASE_MARKDOWN,
  DEEP_GENOME_CASE_QUESTION,
  DEEP_GENOME_CASE_REFERENCES,
} from "./deep-genome-case";

const { t } = useI18n();
const router = useRouter();

const goBack = () => {
  router.back();
};

const artifactChromeState = computed(() =>
  artifactChrome({
    tool: "DeepGenomeAgent",
    referenceCount: DEEP_GENOME_CASE_REFERENCES.length,
    hasAttachments: false,
    runComplete: true,
    surface: "client",
  })
);
const artifactTabs = computed(() => artifactChromeState.value.tabs);
const artifactMenuItems = computed(() =>
  copyDownloadCloseArtifactMenuItems(t, artifactChromeState.value.exportFormats)
);
const artifactRef = ref<{
  download: (format: "pdf" | "markdown") => Promise<void>;
} | null>(null);

const onArtifactMenu = (command: string) => {
  if (command === "close") {
    goBack();
    return;
  }
  const format = artifactDownloadFormat(command);
  const artifact = artifactRef.value;
  if (format === "PDF") {
    if (artifact) void artifact.download("pdf").catch(() => undefined);
    return;
  }
  if (format === "Markdown") {
    if (artifact) void artifact.download("markdown").catch(() => undefined);
    return;
  }
  if (command !== "copy") return;
  const text = DEEP_GENOME_CASE_MARKDOWN.trim();
  if (!text) {
    ElMessage.error(t("chat.copyFailed"));
    return;
  }
  void navigator.clipboard.writeText(text).then(
    () => {
      ElMessage.success(t("chat.copySuccess"));
    },
    () => {
      ElMessage.error(t("chat.copyFailed"));
    }
  );
};

const artifactTabLabels = computed(() => ({
  content: t("common.view"),
  evidence: t("agents.deepGenome.references"),
  activity: t("chat.log.activityLabel"),
  downloads: t("chat.actions.attachments"),
}));
</script>
