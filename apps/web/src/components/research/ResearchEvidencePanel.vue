<template>
  <section
    ref="panelRef"
    class="research-evidence-panel"
    :aria-label="$t('chat.relatedDocuments')"
  >
    <h2 class="research-evidence-panel__title">
      {{ $t("chat.relatedDocuments") }}
    </h2>

    <div
      v-if="displayReferences.length > 0"
      class="research-evidence-panel__list"
      role="list"
    >
      <div
        v-for="ref in displayReferences"
        :id="ref.id"
        :key="ref.id"
        class="research-evidence-panel__item"
        role="listitem"
        tabindex="-1"
        v-html="ref.html"
      ></div>
    </div>
    <p v-else class="research-evidence-panel__empty">
      {{ $t("common.noData") }}
    </p>
  </section>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref } from "vue";
import { buildDisplayReferences } from "@/utils/reference-renderer";

// Agent-influenced references cross the v-html boundary only after the existing
// canonical helper escapes text and sanitizes external URLs.
const props = defineProps<{
  references?: unknown[];
  ns: string;
}>();

const emit = defineEmits<{
  (event: "activate"): void;
}>();

const displayReferences = computed(() =>
  buildDisplayReferences(props.references || [], props.ns)
);

const panelRef = ref<HTMLElement | null>(null);
let artifactRoot: HTMLElement | null = null;

function findEvidenceRow(href: string | null): HTMLElement | null {
  if (!href || !href.startsWith("#") || href.length === 1 || !panelRef.value) {
    return null;
  }

  const targetId = href.slice(1);
  if (!displayReferences.value.some((reference) => reference.id === targetId)) {
    return null;
  }

  return (
    Array.from(
      panelRef.value.querySelectorAll<HTMLElement>(
        ".research-evidence-panel__item"
      )
    ).find((row) => row.id === targetId) || null
  );
}

async function handleArtifactClick(event: MouseEvent): Promise<void> {
  const eventTarget = event.target;
  if (
    event.defaultPrevented ||
    event.button !== 0 ||
    event.ctrlKey ||
    event.metaKey ||
    event.shiftKey ||
    event.altKey ||
    !(eventTarget instanceof Element) ||
    !artifactRoot
  ) {
    return;
  }

  const citation = eventTarget.closest<HTMLAnchorElement>("a.citation-ref");
  if (!citation || !artifactRoot.contains(citation)) return;
  if (!findEvidenceRow(citation.getAttribute("href"))) return;

  event.preventDefault();
  emit("activate");
  await nextTick();

  const row = findEvidenceRow(citation.getAttribute("href"));
  if (!row) return;
  row.scrollIntoView({ block: "nearest" });
  row.focus();
}

onMounted(() => {
  const closestArtifact = panelRef.value?.closest(".research-artifact-shell");
  artifactRoot =
    closestArtifact instanceof HTMLElement ? closestArtifact : null;
  artifactRoot?.addEventListener("click", handleArtifactClick);
});

onUnmounted(() => {
  artifactRoot?.removeEventListener("click", handleArtifactClick);
  artifactRoot = null;
});
</script>

<style scoped>
.research-evidence-panel {
  min-width: 0;
  color: var(--phy-color-text);
  font-family: var(--phy-font-shell);
}

.research-evidence-panel__title {
  margin: 0 0 var(--phy-space-16);
  color: var(--phy-color-text);
  font-size: 1rem;
  font-weight: 600;
  line-height: 1.4;
}

.research-evidence-panel__list {
  display: grid;
  gap: var(--phy-space-8);
}

.research-evidence-panel__item {
  min-width: 0;
  padding: var(--phy-space-12) 0;
  border-bottom: 1px solid var(--phy-color-border-subtle);
  line-height: 1.6;
  overflow-wrap: anywhere;
  scroll-margin-block: var(--phy-space-16);
}

.research-evidence-panel__item:focus-visible,
:deep(a:focus-visible) {
  outline: 2px solid var(--phy-color-focus);
  outline-offset: 2px;
  border-radius: var(--phy-radius-sm);
}

.research-evidence-panel__empty {
  margin: 0;
  color: var(--phy-color-text-muted);
}

:deep(.doc-citation) {
  line-height: inherit;
}

:deep(.doc-link-inline) {
  overflow-wrap: anywhere;
}

:deep(a) {
  color: var(--phy-color-action-text);
  text-underline-offset: 0.15em;
}

:deep(a:hover) {
  color: var(--phy-color-action-text-hover);
}
</style>
