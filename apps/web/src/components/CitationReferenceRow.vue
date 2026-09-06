<template>
  <div class="citation-reference-row">
    <span class="citation-reference-row__number">{{ index }}.</span>
    <div class="citation-reference-row__body">
      <template v-if="presentation">
        <span class="citation-reference-row__sentence"
          ><template
            v-for="(run, position) in presentation.runs"
            :key="position"
            ><strong v-if="run.bold"
              ><em v-if="run.italic">{{ run.text }}</em
              ><template v-else>{{ run.text }}</template></strong
            ><em v-else-if="run.italic">{{ run.text }}</em
            ><template v-else>{{ run.text }}</template></template
          ></span
        >
        <div
          v-if="presentation.links.length"
          class="citation-reference-row__links"
        >
          <a
            v-for="(link, position) in presentation.links"
            :key="position"
            :href="link.href"
            target="_blank"
            rel="noopener noreferrer"
            >{{ link.label }}</a
          >
        </div>
      </template>
      <span v-else>{{ $t("chat.referenceUnavailable") }}</span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import {
  decodeCitationPresentation,
  type CitationPresentation,
} from "@/utils/citation-presentation";

const props = defineProps<{
  index: number;
  citation: CitationPresentation | null;
}>();
const presentation = computed(() => decodeCitationPresentation(props.citation));
</script>

<style scoped>
.citation-reference-row {
  display: grid;
  grid-template-columns: max-content minmax(0, 1fr);
  gap: var(--phy-space-8);
  min-width: 0;
  max-width: 100%;
  line-height: 1.6;
}
.citation-reference-row__body {
  min-width: 0;
  overflow-wrap: anywhere;
}
.citation-reference-row__sentence {
  white-space: pre-wrap;
}
.citation-reference-row__links {
  display: flex;
  flex-wrap: wrap;
  gap: var(--phy-space-4) var(--phy-space-12);
  margin-top: var(--phy-space-4);
}
.citation-reference-row__links a {
  min-width: 0;
  color: var(--phy-color-action-text);
  text-underline-offset: 0.15em;
  overflow-wrap: anywhere;
}
.citation-reference-row__links a:hover {
  color: var(--phy-color-action-text-hover);
}
.citation-reference-row__links a:focus-visible {
  outline: 2px solid var(--phy-color-focus);
  outline-offset: 2px;
  border-radius: var(--phy-radius-sm);
}
</style>
