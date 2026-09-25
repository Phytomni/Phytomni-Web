<template>
  <section
    class="deep-genome-material-detail"
    data-testid="deep-genome-material-detail"
    :aria-busy="state.status === 'loading'"
    :aria-labelledby="headingId"
  >
    <header class="deep-genome-material-detail__header">
      <button
        type="button"
        class="deep-genome-material-detail__back"
        data-testid="material-back"
        @click="$emit('back')"
      >
        <span aria-hidden="true">←</span>
        {{ $t("agents.deepGenome.material.back") }}
      </button>
      <h2 :id="headingId" ref="heading" tabindex="-1">
        {{ title }}
      </h2>
      <button
        v-if="downloadable"
        type="button"
        class="deep-genome-material-detail__download"
        data-testid="material-download"
        @click="$emit('download')"
      >
        {{ $t("agents.deepGenome.material.download") }}
      </button>
    </header>
    <div
      class="deep-genome-material-detail__body"
      data-scroll-owner="material-body"
    >
      <p v-if="state.status === 'loading'" role="status">
        {{ $t("agents.deepGenome.material.loading") }}
      </p>
      <div
        v-else-if="state.status === 'error'"
        role="alert"
        class="deep-genome-material-detail__error"
      >
        <p>
          {{
            $t(
              `agents.deepGenome.material.${state.error === "unavailable" ? "unavailable" : "failed"}`
            )
          }}
        </p>
        <button
          type="button"
          data-testid="material-retry"
          @click="$emit('retry')"
        >
          {{ $t("common.retry") }}
        </button>
      </div>
      <ScientificMarkdown
        v-else-if="state.status === 'ready'"
        :source="state.text"
        surface="document"
        citation-namespace=""
        :reference-count="0"
        :registered-resources-only="true"
      />
    </div>
  </section>
</template>

<script setup lang="ts">
import { onMounted, ref, useId } from "vue";
import ScientificMarkdown from "@/components/ScientificMarkdown.vue";
import type { DeepGenomeMaterialDetailState } from "./deep-genome-report";

defineProps<{
  state: DeepGenomeMaterialDetailState;
  title: string;
  downloadable: boolean;
}>();
defineEmits<{ back: []; retry: []; download: [] }>();
const heading = ref<HTMLElement | null>(null);
const headingId = `deep-genome-material-${useId()}`;
onMounted(() => heading.value?.focus());
</script>

<style scoped>
.deep-genome-material-detail {
  container-type: inline-size;
  display: flex;
  flex-direction: column;
  height: 100%;
  min-width: 0;
  min-height: 0;
  color: var(--phy-color-text);
  background: var(--phy-color-bg-elevated);
}
.deep-genome-material-detail__header {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--phy-space-12);
  padding: var(--phy-space-16);
  border-bottom: 1px solid var(--phy-color-border-subtle);
}
.deep-genome-material-detail__header h2 {
  flex: 1 1 12rem;
  min-width: 0;
  margin: 0;
  font-family: var(--phy-font-shell);
  font-size: 1rem;
  line-height: 1.5;
  overflow-wrap: anywhere;
}
.deep-genome-material-detail button {
  min-height: var(--phy-control-height-default);
  padding: var(--phy-space-8) var(--phy-space-12);
  border: 1px solid var(--phy-color-border-subtle);
  border-radius: var(--phy-radius-md);
  background: var(--phy-color-bg-elevated);
  color: var(--phy-color-action-text);
  font: inherit;
  cursor: pointer;
}
.deep-genome-material-detail button:hover {
  background: var(--phy-color-fill-subtle);
}
.deep-genome-material-detail button:focus-visible,
.deep-genome-material-detail h2:focus-visible {
  outline: 2px solid var(--phy-color-focus);
  outline-offset: 2px;
}
.deep-genome-material-detail__body {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: clamp(16px, 2vw, 32px);
  overscroll-behavior: contain;
}
.deep-genome-material-detail__body > .phy-markdown {
  max-width: var(--phy-layout-artifact-document-max-width);
  margin-inline: auto;
}
.deep-genome-material-detail__error {
  color: var(--phy-color-text-secondary);
}
@container (max-width: 599px) {
  .deep-genome-material-detail__header {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
    gap: var(--phy-space-8);
  }
  .deep-genome-material-detail__header h2 {
    grid-column: 1 / -1;
    grid-row: 1;
  }
  .deep-genome-material-detail__back,
  .deep-genome-material-detail__download {
    grid-row: 2;
    min-width: 0;
    padding-inline: var(--phy-space-8);
    font-size: 14px;
  }
}
</style>
