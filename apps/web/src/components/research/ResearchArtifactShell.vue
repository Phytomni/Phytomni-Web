<template>
  <section
    ref="shellRef"
    class="research-artifact-shell research-artifact-shell--desktop-column research-artifact-shell--mobile-fullscreen"
    data-scroll-owner="artifact-body"
  >
    <div class="research-artifact-shell__chrome">
      <slot name="header">
        <ResearchArtifactHeader
          :title="title"
          :metadata="metadata"
          :status="status"
          :back-label="backLabel"
          :close-label="closeLabel"
          :action-label="actionLabel"
          @back="emit('back')"
          @close="emit('close')"
          @action="emit('action')"
        />
      </slot>

      <div
        class="research-artifact-shell__tabs"
        role="tablist"
        :aria-label="tablistLabel"
      >
        <button
          v-for="item in tabItems"
          :id="tabId(item.id)"
          :key="item.id"
          type="button"
          role="tab"
          class="research-artifact-shell__tab"
          :class="{ 'is-active': selectedTab === item.id }"
          :aria-selected="selectedTab === item.id"
          :aria-controls="panelId(item.id)"
          :tabindex="selectedTab === item.id ? 0 : -1"
          :data-tab-id="item.id"
          @click="activateTab(item.id)"
          @keydown="handleTabKeydown($event, item.id)"
        >
          {{ item.label }}
        </button>
      </div>
    </div>

    <div class="research-artifact-shell__body">
      <aside v-if="$slots.toc" class="research-artifact-shell__toc">
        <slot name="toc" />
      </aside>

      <div class="research-artifact-shell__panels">
        <section
          v-for="item in tabItems"
          :id="panelId(item.id)"
          :key="item.id"
          role="tabpanel"
          class="research-artifact-shell__panel"
          :aria-labelledby="tabId(item.id)"
          :hidden="selectedTab !== item.id"
          :data-panel-id="item.id"
        >
          <div
            :class="{
              'research-artifact-shell__narrative-content phy-reading':
                item.id === 'content',
              'research-artifact-shell__narrative-content--wide':
                item.id === 'content' && contentLayout === 'wide',
              'research-artifact-shell__supporting-content':
                item.id !== 'content',
            }"
          >
            <slot :name="item.id" />
          </div>
        </section>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, getCurrentInstance, nextTick, ref, watch } from "vue";
import ResearchArtifactHeader from "./ResearchArtifactHeader.vue";

type ResearchArtifactTab = "content" | "evidence" | "activity" | "downloads";
type ResearchArtifactTabLabels = Partial<Record<ResearchArtifactTab, string>>;
type ResearchArtifactContentLayout = "reading" | "wide";

const DEFAULT_TAB_LABELS: Record<ResearchArtifactTab, string> = {
  content: "Report",
  evidence: "Evidence",
  activity: "Activity",
  downloads: "Downloads",
};
const TAB_ORDER: ResearchArtifactTab[] = [
  "content",
  "evidence",
  "activity",
  "downloads",
];

const props = withDefaults(
  defineProps<{
    title: string;
    metadata?: string | string[];
    status?: string;
    tab?: ResearchArtifactTab;
    tabLabels?: ResearchArtifactTabLabels;
    contentLayout?: ResearchArtifactContentLayout;
    tablistLabel?: string;
    artifactId?: string;
    backLabel: string;
    closeLabel: string;
    actionLabel: string;
  }>(),
  {
    tab: "content",
    tabLabels: () => ({}),
    contentLayout: "reading",
    tablistLabel: "Report sections",
  }
);

const emit = defineEmits<{
  (event: "back"): void;
  (event: "close"): void;
  (event: "action"): void;
  (event: "tab", tab: ResearchArtifactTab): void;
}>();

const shellRef = ref<HTMLElement | null>(null);
const selectedTab = ref<ResearchArtifactTab>(props.tab);
const instanceId = getCurrentInstance()?.uid ?? 0;
const idBase = computed(
  () => props.artifactId || `research-artifact-${instanceId}`
);
const tabItems = computed(() =>
  TAB_ORDER.map((id) => ({
    id,
    label: props.tabLabels[id] || DEFAULT_TAB_LABELS[id],
  }))
);

watch(
  () => props.tab,
  (tab) => {
    selectedTab.value = tab;
  }
);

function tabId(tab: ResearchArtifactTab): string {
  return `${idBase.value}-tab-${tab}`;
}

function panelId(tab: ResearchArtifactTab): string {
  return `${idBase.value}-panel-${tab}`;
}

function activateTab(tab: ResearchArtifactTab, moveFocus = false): void {
  selectedTab.value = tab;
  emit("tab", tab);

  if (moveFocus) {
    nextTick(() => {
      shellRef.value
        ?.querySelector<HTMLElement>(`[data-tab-id="${tab}"]`)
        ?.focus();
    });
  }
}

function handleTabKeydown(
  event: KeyboardEvent,
  tab: ResearchArtifactTab
): void {
  const currentIndex = TAB_ORDER.indexOf(tab);
  let nextIndex: number | null = null;

  if (event.key === "ArrowRight") {
    nextIndex = (currentIndex + 1) % TAB_ORDER.length;
  } else if (event.key === "ArrowLeft") {
    nextIndex = (currentIndex - 1 + TAB_ORDER.length) % TAB_ORDER.length;
  } else if (event.key === "Home") {
    nextIndex = 0;
  } else if (event.key === "End") {
    nextIndex = TAB_ORDER.length - 1;
  }

  if (nextIndex === null) return;

  event.preventDefault();
  activateTab(TAB_ORDER[nextIndex], true);
}
</script>

<style scoped>
.research-artifact-shell {
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  background: var(--phy-color-bg-elevated);
  color: var(--phy-color-text);
  font-family: var(--phy-font-shell);
}

.research-artifact-shell__chrome {
  position: sticky;
  top: 0;
  z-index: var(--phy-z-sticky);
  flex: 0 0 auto;
  border-bottom: 1px solid var(--phy-color-border-subtle);
  background: var(--phy-color-bg-elevated);
}

.research-artifact-shell__tabs {
  display: flex;
  align-items: center;
  gap: var(--phy-space-4);
  min-width: 0;
  padding: 0 var(--phy-space-20);
  overflow-x: auto;
  overflow-y: hidden;
  scrollbar-width: thin;
}

.research-artifact-shell__tab {
  position: relative;
  flex: 0 0 auto;
  min-height: var(--phy-control-height-default);
  padding: 0 var(--phy-space-12);
  border: 0;
  background: transparent;
  color: var(--phy-color-text-secondary);
  font: inherit;
  font-size: 0.875rem;
  font-weight: 600;
  cursor: pointer;
}

.research-artifact-shell__tab::after {
  position: absolute;
  right: var(--phy-space-8);
  bottom: 0;
  left: var(--phy-space-8);
  height: 2px;
  border-radius: var(--phy-radius-pill);
  background: transparent;
  content: "";
}

.research-artifact-shell__tab:hover {
  color: var(--phy-color-action-text-hover);
}

.research-artifact-shell__tab.is-active {
  color: var(--phy-color-action-text);
}

.research-artifact-shell__tab.is-active::after {
  background: var(--phy-color-action-fill);
}

.research-artifact-shell__tab:focus-visible {
  outline: 2px solid var(--phy-color-focus);
  outline-offset: -2px;
}

.research-artifact-shell__body {
  display: flex;
  flex: 1 1 auto;
  align-items: flex-start;
  min-width: 0;
  min-height: 0;
  overflow-x: hidden;
  overflow-y: auto;
  scrollbar-gutter: stable;
}

.research-artifact-shell__toc {
  position: sticky;
  top: 0;
  flex: 0 0 13rem;
  max-height: 100%;
  box-sizing: border-box;
  padding: var(--phy-space-24) var(--phy-space-16) var(--phy-space-32)
    var(--phy-space-20);
  overflow-y: auto;
  border-inline-end: 1px solid var(--phy-color-border-subtle);
  color: var(--phy-color-text-secondary);
}

.research-artifact-shell__panels {
  flex: 1 1 auto;
  min-width: 0;
}

.research-artifact-shell__panel {
  width: 100%;
  min-width: 0;
  box-sizing: border-box;
  padding: var(--phy-space-32) var(--phy-space-32) var(--phy-space-48);
}

.research-artifact-shell__panel[hidden] {
  display: none;
}

.research-artifact-shell__narrative-content,
.research-artifact-shell__supporting-content {
  width: 100%;
  min-width: 0;
  margin-inline: auto;
}

.research-artifact-shell__narrative-content {
  max-width: calc(var(--phy-layout-reading-max-width) - var(--phy-space-20));
  font-family: var(--phy-font-reading);
  line-height: 1.7;
}

.research-artifact-shell__narrative-content--wide {
  max-width: var(--phy-layout-artifact-wide-max-width);
}

.research-artifact-shell__supporting-content {
  max-width: var(--phy-layout-reading-max-width);
  font-family: var(--phy-font-shell);
}

@media (max-width: 899px) {
  .research-artifact-shell--mobile-fullscreen {
    width: 100%;
    height: 100%;
  }

  .research-artifact-shell__tabs {
    padding-inline: var(--phy-space-16);
  }

  .research-artifact-shell__body {
    display: block;
  }

  .research-artifact-shell__toc {
    position: static;
    width: 100%;
    max-height: none;
    padding: var(--phy-space-16);
    overflow-x: auto;
    overflow-y: hidden;
    border-inline-end: 0;
    border-bottom: 1px solid var(--phy-color-border-subtle);
  }

  .research-artifact-shell__panel {
    padding: var(--phy-space-24) var(--phy-space-20) var(--phy-space-40);
  }
}

@media (max-width: 599px) {
  .research-artifact-shell__tabs {
    padding-inline: var(--phy-space-8);
  }

  .research-artifact-shell__tab {
    min-height: calc(var(--phy-control-height-default) + var(--phy-space-4));
    padding-inline: var(--phy-space-12);
  }

  .research-artifact-shell__panel {
    padding: var(--phy-space-20) var(--phy-space-16) var(--phy-space-32);
  }
}
</style>
