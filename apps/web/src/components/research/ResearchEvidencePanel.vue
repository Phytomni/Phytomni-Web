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
        :class="[
          'research-evidence-panel__item',
          {
            'research-evidence-panel__item--active': activeReferenceIds.has(
              ref.id
            ),
          },
        ]"
        role="listitem"
        tabindex="-1"
        :aria-current="activeReferenceIds.has(ref.id) ? 'true' : undefined"
        v-html="ref.html"
      ></div>
    </div>
    <p v-else class="research-evidence-panel__empty">
      {{ $t("common.noData") }}
    </p>
    <span
      v-if="activeAnnouncement"
      :key="announcementNonce"
      class="sr-only"
      aria-live="polite"
      >{{ activeAnnouncement }}</span
    >
  </section>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { buildDisplayReferences } from "@/utils/reference-renderer";
import { focusReferenceRows } from "@/utils/scientific-markdown/reference-focus";

// Agent-influenced references cross the v-html boundary only after the existing
// canonical helper escapes text and sanitizes external URLs.
const props = defineProps<{
  references?: readonly unknown[];
  ns: string;
}>();

const displayReferences = computed(() =>
  buildDisplayReferences(props.references || [], props.ns)
);

const { t } = useI18n();
const panelRef = ref<HTMLElement | null>(null);
const activeReferenceIds = ref<ReadonlySet<string>>(new Set());
const activeAnnouncement = ref("");
const announcementNonce = ref(0);

function focusReferences(indices: readonly number[]): boolean {
  const ids = indices.map((index) => displayReferences.value[index - 1]?.id);
  if (!panelRef.value || indices.length === 0 || ids.some((id) => !id)) {
    return false;
  }

  if (
    !focusReferenceRows({
      root: panelRef.value,
      namespace: props.ns,
      indices,
    })
  ) {
    return false;
  }

  activeReferenceIds.value = new Set(
    ids.filter((id): id is string => typeof id === "string")
  );
  activeAnnouncement.value = `${t("chat.relatedDocuments")}: ${indices.join(", ")}`;
  announcementNonce.value += 1;
  return true;
}

watch(displayReferences, () => {
  activeReferenceIds.value = new Set();
  activeAnnouncement.value = "";
});

defineExpose({ focusReferences });
</script>

<style scoped>
.research-evidence-panel {
  min-width: 0;
  max-width: 100%;
  color: var(--phy-color-text);
  font-family: var(--phy-font-shell);
  overflow-wrap: anywhere;
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

.research-evidence-panel__item--active {
  background: var(--phy-color-accent-soft);
  box-shadow: inset 3px 0 0 var(--phy-color-accent);
}

.research-evidence-panel__item.is-citation-target {
  background: var(--phy-color-accent-soft);
  box-shadow: inset 3px 0 0 var(--phy-color-accent);
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
