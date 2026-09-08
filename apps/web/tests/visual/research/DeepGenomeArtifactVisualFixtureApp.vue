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
      :references="references"
      :resources="resources"
      :reference-materials="
        isScientific || isContract ? [] : referenceMaterials
      "
      :read-resource="readResource"
      report-key="deep-genome-frozen-case"
      ns="deep-genome-visual"
      artifact-id="deep-genome-visual-artifact"
      :tab-labels="tabLabels"
      :tabs="chrome.tabs"
      :tablist-label="t('common.operation')"
      :back-label="t('common.back')"
      :close-label="t('common.close')"
      :action-label="t('common.operation')"
      :menu-items="menuItems"
      @back="recordAction('back')"
      @close="recordAction('close')"
      @action="recordAction"
    />
    <output class="sr-only" data-testid="deep-genome-visual-action">
      {{ action }}
    </output>
  </main>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import { useI18n } from "vue-i18n";
import {
  DeepGenomeArtifact,
  copyDownloadCloseArtifactMenuItems,
} from "@/components/research";
import { artifactChrome } from "@/views/chat/utils/artifact-chrome";
import {
  DEEP_GENOME_CASE_REFERENCES,
  DEEP_GENOME_CASE_MARKDOWN,
  DEEP_GENOME_CASE_RESOURCES,
  readDeepGenomeCaseResource,
} from "@/views/deep-genome-agent/deep-genome-case";
import referenceMaterials from "@/views/agent-cases/citations/deep-genome-materials.generated.json";
import type { DeepGenomeResourceReader } from "@/components/research/deep-genome-report";
import {
  CONTRACT_DEEP_GENOME_MARKDOWN,
  CONTRACT_DEEP_GENOME_RESOURCES,
  SCIENTIFIC_FORMATTING_MARKDOWN,
  SCIENTIFIC_FORMATTING_REFERENCES,
} from "./fixture-data";

const { t } = useI18n();
const action = ref("idle");
const materialState = new URLSearchParams(window.location.search).get(
  "material-state"
);
let materialAttempts = 0;
const readResource: DeepGenomeResourceReader = (resourceId, signal) => {
  if (materialState === "loading") {
    return new Promise((_, reject) => {
      const abort = () => reject(new DOMException("Aborted", "AbortError"));
      if (signal.aborted) abort();
      else signal.addEventListener("abort", abort, { once: true });
    });
  }
  if (materialState === "error" && materialAttempts++ === 0) {
    return Promise.reject(new Error("Synthetic visual fixture failure"));
  }
  return readDeepGenomeCaseResource(resourceId, signal);
};
const isScientific =
  new URLSearchParams(window.location.search).get("case") === "scientific";
const title = isScientific
  ? "Scientific formatting validation"
  : "Os01g0177400 functional analysis";
const metadata = isScientific
  ? ["Synthetic report", "No live agent run"]
  : ["Deep Genome Agent", "Oryza sativa", "Os01g0177400"];
const status = computed(() => t("common.finished"));
const isContract =
  new URLSearchParams(window.location.search).get("case") === "contract";
const markdown = isScientific
  ? SCIENTIFIC_FORMATTING_MARKDOWN
  : isContract
    ? CONTRACT_DEEP_GENOME_MARKDOWN
    : DEEP_GENOME_CASE_MARKDOWN;
const references = isScientific
  ? SCIENTIFIC_FORMATTING_REFERENCES
  : DEEP_GENOME_CASE_REFERENCES;
const resources = isScientific
  ? []
  : isContract
    ? CONTRACT_DEEP_GENOME_RESOURCES
    : DEEP_GENOME_CASE_RESOURCES;
const tabLabels = computed(() => ({
  content: t("common.view"),
  evidence: t("agents.deepGenome.references"),
  activity: t("chat.log.activityLabel"),
  downloads: t("chat.actions.attachments"),
}));
const chrome = computed(() =>
  artifactChrome({
    tool: "DeepGenomeAgent",
    referenceCount: references.length,
    hasAttachments: false,
    runComplete: true,
    surface: "client",
  })
);
const menuItems = computed(() =>
  copyDownloadCloseArtifactMenuItems(t, chrome.value.exportFormats)
);

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

.deep-genome-visual-fixture > :deep(.deep-genome-artifact) {
  height: 100%;
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
