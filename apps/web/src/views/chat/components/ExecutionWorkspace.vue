<template>
  <section
    class="execution-workspace"
    aria-labelledby="execution-workspace-title"
  >
    <header class="execution-workspace__header">
      <button
        data-test="execution-workspace-back"
        type="button"
        class="execution-workspace__back"
        @click="emit('close-workspace')"
      >
        <span aria-hidden="true">←</span> {{ t("chat.execution.backToChat") }}
      </button>
      <h2 id="execution-workspace-title">
        {{ t("chat.execution.workspace") }}
      </h2>
      <button
        data-test="execution-workspace-close"
        type="button"
        :aria-label="t('common.close')"
        @click="emit('close-workspace')"
      >
        ×
      </button>
    </header>
    <div
      ref="tablistRef"
      class="execution-workspace__tabs"
      role="tablist"
      :aria-label="t('chat.execution.workspaceTabs')"
      @keydown="onTabKeydown"
    >
      <div
        v-for="tab in tabs"
        :key="tab.key"
        class="execution-workspace__tab-wrap"
      >
        <button
          :id="`execution-tab-${domKey(tab.key)}`"
          type="button"
          role="tab"
          :aria-selected="tab.key === activeKey"
          :tabindex="tab.key === activeKey ? 0 : -1"
          @click="emit('select-tab', tab.key)"
        >
          {{ tab.title }}
        </button>
        <button
          type="button"
          class="execution-workspace__tab-close"
          :aria-label="t('chat.execution.closeTab', { title: tab.title })"
          @click="emit('close-tab', tab.key)"
        >
          ×
        </button>
      </div>
    </div>
    <div
      v-if="activeTab"
      ref="bodyRef"
      class="execution-workspace__body"
      :class="{ 'is-report': activeTab.target.kind === 'report' }"
      role="tabpanel"
      :aria-labelledby="`execution-tab-${domKey(activeTab.key)}`"
      @scroll="onBodyScroll"
    >
      <p v-if="loading" class="execution-workspace__notice" role="status">
        {{ t("chat.execution.loadingTarget") }}
      </p>
      <p
        v-else-if="error"
        class="execution-workspace__notice is-error"
        role="alert"
      >
        {{ t("chat.execution.targetUnavailable") }}
      </p>
      <template v-if="activeTab.target.kind === 'report'">
        <slot name="report" :tab="activeTab">
          <h3>{{ activeTab.title }}</h3>
          <p>{{ t("chat.execution.authorizedPreviewHint") }}</p>
        </slot>
      </template>
      <ExecutionDiagnostics
        v-else-if="activeTab.localView === 'diagnostics' && run"
        :run="run"
        @open-target="(target, title) => emit('open-target', target, title)"
      />
      <template v-else-if="activeTab.target.kind === 'todo'">
        <h3>{{ t("chat.execution.todo") }}</h3>
        <ul
          v-if="run?.todoDeclared && run.todos.length"
          class="execution-workspace__todo"
        >
          <li v-for="item in run?.todos ?? []" :key="item.id">
            {{ te(item.labelKey) ? t(item.labelKey) : item.labelKey }} —
            {{ t(`chat.execution.todoStatus.${item.status}`) }}
          </li>
        </ul>
        <p v-else class="execution-workspace__notice">
          {{ t("chat.execution.todoUnavailable") }}
        </p>
      </template>
      <ExecutionWorkTrace
        v-else-if="activeTab.target.kind === 'trace' && detail?.trace"
        :trace="detail.trace"
        @open-target="(target, title) => emit('open-target', target, title)"
      />
      <template v-else-if="activeEvent">
        <h3>{{ activeEvent.summary.text }}</h3>
        <dl class="execution-workspace__metadata">
          <dt>{{ t("chat.execution.eventKind") }}</dt>
          <dd>{{ activeEvent.kind }}</dd>
          <dt>{{ t("chat.execution.eventStatus") }}</dt>
          <dd>{{ activeEvent.status }}</dd>
          <dt>{{ t("chat.execution.occurredAt") }}</dt>
          <dd>{{ activeEvent.occurredAt }}</dd>
        </dl>
        <pre
          v-if="Object.keys(activeEvent.payload).length"
          class="execution-workspace__json"
          >{{ JSON.stringify(activeEvent.payload, null, 2) }}</pre>
      </template>
      <template v-else-if="activeResult">
        <h3>{{ detail?.name ?? activeResult.name }}</h3>
        <dl class="execution-workspace__metadata">
          <dt>{{ t("chat.execution.mediaType") }}</dt>
          <dd>{{ detail?.mediaType ?? activeResult.mediaType }}</dd>
          <dt>{{ t("chat.execution.size") }}</dt>
          <dd>{{ detail?.sizeBytes ?? activeResult.sizeBytes }} B</dd>
          <dt>{{ t("chat.execution.targetType") }}</dt>
          <dd>{{ activeTab.target.kind }}</dd>
        </dl>
        <ScientificMarkdown
          v-if="detailRenderer === 'markdown' && renderedText"
          class="execution-workspace__markdown"
          :source="renderedText"
          surface="document"
        />
        <pre
          v-else-if="detailRenderer === 'log' && renderedText"
          class="execution-workspace__log"
          >{{ renderedText }}</pre>
        <div
          v-else-if="detailRenderer === 'table' && renderedTable"
          class="execution-workspace__table-wrap"
        >
          <table class="execution-workspace__table">
            <thead>
              <tr>
                <th v-for="header in renderedTable.headers" :key="header">
                  {{ header }}
                </th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="(row, rowIndex) in renderedTable.rows" :key="rowIndex">
                <td v-for="(cell, cellIndex) in row" :key="cellIndex">
                  {{ cell }}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <pre
          v-else-if="detailRenderer === 'structured' && renderedJson"
          class="execution-workspace__json"
          >{{ renderedJson }}</pre>
        <img
          v-else-if="detailRenderer === 'image' && previewBlobUrl"
          class="execution-workspace__image"
          :src="previewBlobUrl"
          :alt="detailName"
        />
        <object
          v-else-if="detailRenderer === 'pdf' && previewBlobUrl"
          class="execution-workspace__pdf"
          :data="previewBlobUrl"
          type="application/pdf"
          :aria-label="detailName"
        />
        <p
          v-else-if="previewLoading"
          class="execution-workspace__notice"
          role="status"
        >
          {{ t("chat.execution.loadingTarget") }}
        </p>
        <p v-else-if="previewUnavailable" class="execution-workspace__notice">
          {{ t("chat.execution.previewUnavailable") }}
        </p>
        <p>{{ t("chat.execution.authorizedPreviewHint") }}</p>
        <button
          v-if="detail?.deliveryUrl || detail?.artifactId"
          type="button"
          class="execution-workspace__action"
          @click="emit('authorize-target', activeTab.target)"
        >
          {{ t("common.download") }}
        </button>
      </template>
      <template v-else>
        <h3>{{ activeTab.title }}</h3>
        <dl class="execution-workspace__metadata">
          <dt>{{ t("chat.execution.targetType") }}</dt>
          <dd>{{ activeTab.target.kind }}</dd>
          <dt>{{ t("chat.execution.targetId") }}</dt>
          <dd>{{ activeTab.target.id }}</dd>
        </dl>
        <p>{{ t("chat.execution.authorizedPreviewHint") }}</p>
      </template>
    </div>
    <div v-else class="execution-workspace__empty">
      {{ t("chat.execution.noOpenTabs") }}
    </div>
  </section>
</template>

<script setup lang="ts">
import ScientificMarkdown from "@/components/ScientificMarkdown.vue";
import ExecutionDiagnostics from "./ExecutionDiagnostics.vue";
import ExecutionWorkTrace from "./ExecutionWorkTrace.vue";
import { computed, nextTick, onBeforeUnmount, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { abortRequest } from "@/utils/request";
import type {
  ExecutionRunState,
  ExecutionTarget,
  ExecutionTargetResolution,
  ExecutionWorkspaceTab,
} from "../streaming/executionEvents";
import {
  executionDetailRenderer,
  safeStructuredRows,
  safeTextPayload,
} from "../executionDetailRenderers";
import {
  loadExecutionArtifactPreview,
  type ExecutionArtifactPreview,
} from "../executionArtifactPreview";

const props = withDefaults(
  defineProps<{
    tabs: ExecutionWorkspaceTab[];
    activeKey: string | null;
    run?: ExecutionRunState | null;
    detail?: ExecutionTargetResolution;
    loading?: boolean;
    error?: boolean;
    scrollTop?: number;
  }>(),
  { run: null, scrollTop: 0 }
);
const emit = defineEmits<{
  "select-tab": [key: string];
  "close-tab": [key: string];
  "close-workspace": [];
  "authorize-target": [target: ExecutionTarget];
  "open-target": [target: ExecutionTarget, title: string];
  "update-scroll": [scrollTop: number];
}>();
const { t, te } = useI18n();
const tablistRef = ref<HTMLElement | null>(null);
const bodyRef = ref<HTMLElement | null>(null);
const activeTab = computed(
  () => props.tabs.find((tab) => tab.key === props.activeKey) ?? null
);
const activeResult = computed(() =>
  activeTab.value && props.run
    ? (props.run.results.find(
        (result) =>
          result.target.kind === activeTab.value?.target.kind &&
          result.target.id === activeTab.value?.target.id
      ) ?? null)
    : null
);
const activeEvent = computed(() =>
  activeTab.value?.target.kind === "event" && props.run
    ? (props.run.events.find(
        (event) => event.eventId === activeTab.value?.target.id
      ) ?? null)
    : null
);
const detailPayload = computed(
  () => props.detail?.event?.payload ?? activeEvent.value?.payload
);
const detailName = computed(
  () =>
    props.detail?.name ??
    activeResult.value?.name ??
    activeTab.value?.title ??
    ""
);
const detailRenderer = computed(() =>
  activeTab.value
    ? executionDetailRenderer(
        activeTab.value.target,
        props.detail?.mediaType ?? activeResult.value?.mediaType,
        detailName.value
      )
    : "metadata"
);
const detailText = computed(() => safeTextPayload(detailPayload.value));
const detailTable = computed(() => safeStructuredRows(detailPayload.value));
const detailJson = computed(() => {
  if (!detailPayload.value) return null;
  const value = JSON.stringify(detailPayload.value, null, 2);
  return value.length <= 65_536 ? value : null;
});
const artifactPreview = ref<ExecutionArtifactPreview | null>(null);
const previewLoading = ref(false);
const previewFailed = ref(false);
const previewBlobUrl = ref<string | null>(null);
const renderedText = computed(() =>
  artifactPreview.value?.kind === "text"
    ? artifactPreview.value.text
    : detailText.value
);
const renderedTable = computed(() =>
  artifactPreview.value?.kind === "table"
    ? artifactPreview.value.table
    : detailTable.value
);
const renderedJson = computed(() =>
  artifactPreview.value?.kind === "structured"
    ? artifactPreview.value.text
    : detailJson.value
);
const previewUnavailable = computed(
  () =>
    previewFailed.value ||
    artifactPreview.value?.kind === "unavailable" ||
    (detailRenderer.value === "metadata" && !!props.detail?.deliveryUrl)
);

function releasePreviewBlob(): void {
  if (
    previewBlobUrl.value?.startsWith("blob:") &&
    typeof URL.revokeObjectURL === "function"
  ) {
    URL.revokeObjectURL(previewBlobUrl.value);
  }
  previewBlobUrl.value = null;
}

let previewGeneration = 0;
watch(
  () =>
    [
      props.detail?.deliveryUrl,
      detailRenderer.value,
      detailName.value,
      props.detail?.sizeBytes ?? activeResult.value?.sizeBytes,
      activeTab.value?.key,
    ] as const,
  async (
    [deliveryUrl, renderer, name, sizeBytes, tabKey],
    _previous,
    onCleanup
  ) => {
    previewGeneration += 1;
    const generation = previewGeneration;
    releasePreviewBlob();
    artifactPreview.value = null;
    previewFailed.value = false;
    previewLoading.value = false;
    if (!deliveryUrl || !tabKey) return;

    const requestId = `execution-preview-${domKey(tabKey)}`;
    let disposed = false;
    onCleanup(() => {
      disposed = true;
      abortRequest(requestId);
    });
    previewLoading.value = true;
    try {
      const loaded = await loadExecutionArtifactPreview({
        deliveryUrl,
        renderer,
        name,
        sizeBytes,
        requestId,
      });
      if (disposed || generation !== previewGeneration) return;
      artifactPreview.value = loaded;
      if (loaded.kind === "image" || loaded.kind === "pdf") {
        if (typeof URL.createObjectURL !== "function") {
          artifactPreview.value = {
            kind: "unavailable",
            reason: "invalid_content",
          };
          return;
        }
        previewBlobUrl.value = URL.createObjectURL(loaded.blob);
      }
    } catch {
      if (!disposed && generation === previewGeneration) {
        previewFailed.value = true;
      }
    } finally {
      if (!disposed && generation === previewGeneration) {
        previewLoading.value = false;
      }
    }
  },
  { immediate: true }
);
onBeforeUnmount(() => releasePreviewBlob());
function domKey(value: string): string {
  return value.replace(/[^A-Za-z0-9_-]/g, "-");
}
function onBodyScroll(event: Event): void {
  emit("update-scroll", (event.currentTarget as HTMLElement).scrollTop);
}
watch(
  () => [props.activeKey, props.scrollTop] as const,
  async () => {
    await nextTick();
    if (bodyRef.value && bodyRef.value.scrollTop !== props.scrollTop) {
      bodyRef.value.scrollTop = props.scrollTop;
    }
  },
  { immediate: true }
);
function onTabKeydown(event: KeyboardEvent): void {
  if (
    !["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key) ||
    props.tabs.length === 0
  )
    return;
  event.preventDefault();
  const current = Math.max(
    0,
    props.tabs.findIndex((tab) => tab.key === props.activeKey)
  );
  const next =
    event.key === "Home"
      ? 0
      : event.key === "End"
        ? props.tabs.length - 1
        : event.key === "ArrowRight"
          ? (current + 1) % props.tabs.length
          : (current - 1 + props.tabs.length) % props.tabs.length;
  emit("select-tab", props.tabs[next].key);
  requestAnimationFrame(() =>
    tablistRef.value
      ?.querySelectorAll<HTMLElement>('[role="tab"]')
      [next]?.focus()
  );
}
</script>

<style scoped>
.execution-workspace {
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;
  min-width: 0;
  background: var(--phy-color-bg-page);
}
.execution-workspace__header {
  display: flex;
  align-items: center;
  min-height: 48px;
  gap: 10px;
  padding: 0 12px;
  border-bottom: 1px solid var(--phy-color-border-subtle);
}
.execution-workspace__header h2 {
  flex: 1;
  margin: 0;
  font-size: 14px;
}
.execution-workspace__header button,
.execution-workspace__tabs button {
  border: 0;
  background: transparent;
  color: var(--phy-color-text-secondary);
  cursor: pointer;
}
.execution-workspace__back {
  display: none;
}
.execution-workspace__tabs {
  display: flex;
  min-height: 39px;
  padding: 0 8px;
  border-bottom: 1px solid var(--phy-color-border-subtle);
  overflow-x: auto;
}
.execution-workspace__tab-wrap {
  display: flex;
  align-items: center;
  flex: 0 0 auto;
  border-bottom: 2px solid transparent;
}
.execution-workspace__tab-wrap:has([aria-selected="true"]) {
  border-bottom-color: var(--phy-color-accent);
}
.execution-workspace__tab-wrap > [role="tab"] {
  max-width: 190px;
  padding: 10px 5px 8px 10px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.execution-workspace__tab-close {
  padding: 8px 8px 8px 3px;
}
.execution-workspace button:focus-visible {
  outline: 2px solid var(--phy-color-focus);
  outline-offset: -2px;
}
.execution-workspace__body {
  flex: 1;
  min-height: 0;
  padding: 20px;
  overflow: auto;
  color: var(--phy-color-text-secondary);
  font-size: 13px;
}
.execution-workspace__body.is-report {
  padding: 0;
}
.execution-workspace__body h3 {
  color: var(--phy-color-text);
  font-size: 17px;
}
.execution-workspace__metadata {
  display: grid;
  grid-template-columns: max-content minmax(0, 1fr);
  gap: 8px 14px;
  padding: 14px;
  border: 1px solid var(--phy-color-border-subtle);
  border-radius: var(--phy-radius-md);
}
.execution-workspace__metadata dt {
  color: var(--phy-color-text-muted);
}
.execution-workspace__metadata dd {
  margin: 0;
  overflow-wrap: anywhere;
}
.execution-workspace__todo {
  line-height: 1.8;
}
.execution-workspace__json {
  max-width: 100%;
  margin-top: 14px;
  padding: 14px;
  border-radius: var(--phy-radius-md);
  background: var(--phy-color-bg-elevated);
  overflow: auto;
  font-size: 12px;
  white-space: pre-wrap;
}
.execution-workspace__log {
  max-height: 55vh;
  margin-top: 14px;
  padding: 14px;
  border-radius: var(--phy-radius-md);
  background: var(--phy-color-bg-elevated);
  overflow: auto;
  font:
    12px/1.6 ui-monospace,
    SFMono-Regular,
    Consolas,
    monospace;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.execution-workspace__table-wrap {
  max-width: 100%;
  margin-top: 14px;
  overflow: auto;
}
.execution-workspace__table {
  width: 100%;
  border-collapse: collapse;
}
.execution-workspace__table th,
.execution-workspace__table td {
  padding: 8px 10px;
  border: 1px solid var(--phy-color-border-subtle);
  text-align: left;
  overflow-wrap: anywhere;
}
.execution-workspace__image {
  display: block;
  max-width: 100%;
  max-height: 62vh;
  margin: 14px auto 0;
  object-fit: contain;
}
.execution-workspace__pdf {
  display: block;
  width: 100%;
  min-height: 62vh;
  margin-top: 14px;
  border: 1px solid var(--phy-color-border-subtle);
  border-radius: var(--phy-radius-sm);
  background: var(--phy-color-bg-elevated);
}
.execution-workspace__empty {
  display: grid;
  flex: 1;
  place-items: center;
  color: var(--phy-color-text-muted);
}
.execution-workspace__action {
  padding: 8px 12px;
  border: 0;
  border-radius: var(--phy-radius-sm);
  background: var(--phy-color-primary);
  color: white;
  cursor: pointer;
}
.execution-workspace__notice {
  padding: 10px 12px;
  border-radius: var(--phy-radius-sm);
  background: var(--phy-color-bg-elevated);
  color: var(--phy-color-text-muted);
}
.execution-workspace__notice.is-error {
  color: var(--el-color-danger);
}
@media (max-width: 899px) {
  .execution-workspace__back {
    display: inline-flex;
    gap: 5px;
  }
}
</style>
