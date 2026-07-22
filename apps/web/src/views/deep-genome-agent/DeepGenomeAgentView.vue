<template>
  <AgentDemoShell
    :title="$t('agents.deepGenome.title')"
    :subtitle="$t('agents.deepGenome.subtitle')"
    @back="goBack"
  >
    <template #question>
      [Species Name: rice (Oryza sativa) Gene Names:
      d18h|GA3ox1|OsGA3OX2|OsGA3ox-2|d18-h|GA3OX2|d18-I|d25|dwf15|ga3ox2|d18-dy|OsGA3ox2|d18|d18-k|d18-AD|D18|GA3ox-2]
      Provide a scientifically rigorous and integrated account of the rice
      (Oryza sativa)
      d18h|GA3ox1|OsGA3OX2|OsGA3ox-2|d18-h|GA3OX2|d18-I|d25|dwf15|ga3ox2|d18-dy|OsGA3ox2|d18|d18-k|d18-AD|D18|GA3ox-2
      gene. Consolidate data for all gene aliases (separated by '|') as
      representing identical genetic entities. Maintain strict adherence to
      evidence-based reporting, excluding unsupported assertions. Prioritize
      conciseness while preserving informational density comparable to source
      materials.
    </template>

    <template #result>
      <DeepGenomeArtifact
        :title="$t('agents.deepGenome.title')"
        :metadata="$t('agents.deepGenome.subtitle')"
        :markdown="DEEP_GENOME_CASE_VIEWER_MARKDOWN"
        :references="DEEP_GENOME_CASE_REFERENCES"
        ns="deep-genome-demo"
        :tab-labels="artifactTabLabels"
        :tablist-label="t('common.operation')"
        artifact-id="deep-genome-demo-artifact"
        :back-label="t('common.back')"
        :close-label="t('common.close')"
        :action-label="t('common.operation')"
        @back="goBack"
        @close="goBack"
      />
    </template>

    <template #footer>{{ $t("common.aiDisclaimer") }}</template>
  </AgentDemoShell>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useRouter } from "vue-router";
import { useI18n } from "vue-i18n";
import { AgentDemoShell } from "@/components/demo";
import { DeepGenomeArtifact } from "@/components/research";
import {
  DEEP_GENOME_CASE_REFERENCES,
  DEEP_GENOME_CASE_VIEWER_MARKDOWN,
} from "./deep-genome-case";

const { t } = useI18n();
const router = useRouter();

const goBack = () => {
  router.back();
};

const artifactTabLabels = computed(() => ({
  content: t("common.view"),
  evidence: t("agents.deepGenome.references"),
  activity: t("chat.log.activityLabel"),
  downloads: t("chat.actions.downloadAttachments"),
}));
</script>
