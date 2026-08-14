<template>
  <main
    class="deep-genome-visual-fixture"
    data-testid="deep-genome-visual-root"
  >
    <DeepGenomeArtifact
      :title="title"
      :metadata="metadata"
      :status="status"
      :markdown="markdown"
      :references="DEEP_GENOME_CASE_REFERENCES"
      :resources="resources"
      ns="deep-genome-visual"
      artifact-id="deep-genome-visual-artifact"
      :tab-labels="tabLabels"
      :tablist-label="t('common.operation')"
      :back-label="t('common.back')"
      :close-label="t('common.close')"
      :action-label="t('common.operation')"
      @back="recordAction('back')"
      @close="recordAction('close')"
      @action="recordAction('action')"
    />
    <output class="sr-only" data-testid="deep-genome-visual-action">
      {{ action }}
    </output>
  </main>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import { useI18n } from "vue-i18n";
import { DeepGenomeArtifact } from "@/components/research";
import {
  DEEP_GENOME_CASE_REFERENCES,
  DEEP_GENOME_CASE_MARKDOWN,
} from "@/views/deep-genome-agent/deep-genome-case";
import {
  CONTRACT_DEEP_GENOME_MARKDOWN,
  CONTRACT_DEEP_GENOME_RESOURCES,
} from "./fixture-data";

const { t } = useI18n();
const action = ref("idle");
const title = "Os01g0177400 functional analysis";
const metadata = ["Deep Genome Agent", "Oryza sativa", "Os01g0177400"];
const status = computed(() => t("common.finished"));
const isContract =
  new URLSearchParams(window.location.search).get("case") === "contract";
const markdown = isContract
  ? CONTRACT_DEEP_GENOME_MARKDOWN
  : DEEP_GENOME_CASE_MARKDOWN;
const resources = isContract ? CONTRACT_DEEP_GENOME_RESOURCES : [];
const tabLabels = computed(() => ({
  content: t("common.view"),
  evidence: t("agents.deepGenome.references"),
  activity: t("chat.log.activityLabel"),
  downloads: t("chat.actions.downloadAttachments"),
}));

function recordAction(nextAction: string): void {
  action.value = nextAction;
}
</script>

<style scoped>
.deep-genome-visual-fixture {
  width: 100vw;
  height: 100vh;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  background: var(--phy-color-bg-elevated);
}

.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}
</style>
