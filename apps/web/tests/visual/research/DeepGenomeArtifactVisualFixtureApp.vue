<template>
  <main
    class="deep-genome-visual-fixture"
    data-testid="deep-genome-visual-root"
    :data-source-lane="sourceLane"
    :class="{ 'deep-genome-visual-fixture--narrow': narrow }"
  >
    <CifFixtureHost :nested="nested" :fullscreen="fullscreen">
      <ScientificMarkdown
        v-if="chatInline"
        :source="markdown"
        :resources="resources"
        surface="chat"
        citation-namespace="deep-genome-visual-inline"
        :registered-resources-only="true"
      />
      <DeepGenomeArtifact
        v-else
        ref="artifactRef"
        :title="title"
        :metadata="metadata"
        :status="status"
        :markdown="markdown"
        :references="references"
        :resources="resources"
        :reference-materials="
          isScientific || isContract || isCif ? [] : referenceMaterials
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
    </CifFixtureHost>
    <output class="sr-only" data-testid="deep-genome-visual-action">
      {{ action }}
    </output>
  </main>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import { useI18n } from "vue-i18n";
import ScientificMarkdown from "@/components/ScientificMarkdown.vue";
import type { DeepGenomeViewerHandle } from "@/components/research/deep-genome-types";
import type { AuthorizedScientificResource } from "@/utils/scientific-markdown/types";
import CifFixtureHost from "./CifFixtureHost.vue";
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
const params = new URLSearchParams(window.location.search);
const isCif = params.get("case") === "cif";
const chatInline = isCif && params.get("host") === "chat";
const nested = isCif && params.get("host") === "nested";
const narrow = isCif && params.get("narrow") === "1";
const runtimeReader = isCif && params.get("source") === "reader";
const fullscreen = ref(true);
const artifactRef = ref<DeepGenomeViewerHandle | null>(null);
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
const sourceLane = isScientific
  ? "synthetic-scientific"
  : isContract
    ? "synthetic-contract"
    : runtimeReader
      ? "synthetic-runtime-reader"
      : "public-case";
const caseLines = DEEP_GENOME_CASE_MARKDOWN.split("\n");
const cifLineIndex = caseLines.findIndex((line) => line.includes(".cif)"));
const cifHeading = caseLines
  .slice(0, cifLineIndex)
  .findLast((line) => /^#{1,6} /.test(line));
const markdown = isScientific
  ? SCIENTIFIC_FORMATTING_MARKDOWN
  : isCif
    ? [
        cifHeading,
        "",
        caseLines[cifLineIndex],
        ...(params.get("multiple") === "1"
          ? ["", caseLines[cifLineIndex].replace(/^!/, "")]
          : []),
      ].join("\n")
    : isContract
      ? CONTRACT_DEEP_GENOME_MARKDOWN
      : DEEP_GENOME_CASE_MARKDOWN;
const references = isScientific
  ? SCIENTIFIC_FORMATTING_REFERENCES
  : isCif
    ? []
    : DEEP_GENOME_CASE_REFERENCES;
const resources: readonly AuthorizedScientificResource[] = isScientific
  ? []
  : isCif
    ? DEEP_GENOME_CASE_RESOURCES.filter(
        (resource) => resource.kind === "cif"
      ).map((resource) => {
        if (!runtimeReader) return resource;
        const { displayUrl, ...registered } = resource;
        if (!displayUrl) throw new Error("Fixture CIF has no public source");
        return {
          ...registered,
          renderSource: {
            kind: "cif-text",
            async read(signal: AbortSignal) {
              const response = await fetch(displayUrl, { signal });
              if (!response.ok) throw new Error("Fixture CIF source failed");
              return response.text();
            },
          },
        };
      })
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

async function recordAction(nextAction: string): Promise<void> {
  action.value = nextAction;
  if (nextAction === "back" || nextAction === "close") fullscreen.value = false;
  if (nextAction === "download:PDF") await artifactRef.value?.download("pdf");
  if (nextAction === "download:Markdown")
    await artifactRef.value?.download("markdown");
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

.deep-genome-visual-fixture--narrow {
  width: min(100vw, 440px);
  margin-inline: auto;
}

.deep-genome-visual-fixture > :deep(.phy-markdown--chat) {
  height: 100%;
  overflow: auto;
  padding: var(--phy-space-4);
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
