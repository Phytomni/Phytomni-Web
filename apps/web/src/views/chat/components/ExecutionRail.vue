<template>
  <aside class="execution-rail" :aria-label="t('chat.execution.rail')">
    <div
      v-if="!run.terminal && run.executionId !== 'empty'"
      class="execution-rail__controls"
    >
      <button
        type="button"
        class="execution-rail__cancel"
        @click="emit('cancel')"
      >
        {{ t("chat.execution.cancel") }}
      </button>
    </div>
    <section class="execution-rail__section">
      <h3>{{ t("chat.execution.todo") }}</h3>
      <ol v-if="displayTodos.length" class="execution-rail__list">
        <li
          v-for="item in displayTodos"
          :key="item.id"
          :class="`is-${item.status}`"
        >
          <span class="execution-rail__check" aria-hidden="true">{{
            item.status === "completed" ? "✓" : ""
          }}</span>
          <span>{{
            te(item.labelKey) ? t(item.labelKey) : item.labelKey
          }}</span>
        </li>
      </ol>
      <p v-else class="execution-rail__empty">
        {{ t("chat.execution.todoUnavailable") }}
      </p>
    </section>
    <section class="execution-rail__section execution-rail__results">
      <h3>{{ t("chat.execution.results") }}</h3>
      <ul v-if="run.results.length" class="execution-rail__list">
        <li v-for="result in run.results" :key="result.eventId">
          <button
            type="button"
            @click="emit('open-target', result.target, result.name)"
          >
            <span class="execution-rail__file">▧</span>
            <span class="execution-rail__result-copy">
              <strong>{{ resultLabel(result.name) }}</strong>
              <small
                >{{ result.mediaType }} ·
                {{ formatBytes(result.sizeBytes) }}</small
              >
            </span>
          </button>
        </li>
      </ul>
      <p v-else class="execution-rail__empty">
        {{ t("chat.execution.noResults") }}
      </p>
    </section>
  </aside>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import type {
  ExecutionRunState,
  ExecutionTarget,
} from "../streaming/executionEvents";

const props = defineProps<{ run: ExecutionRunState }>();
const emit = defineEmits<{
  "open-target": [target: ExecutionTarget, title: string];
  cancel: [];
}>();
const { t, te } = useI18n();
const displayTodos = computed(() =>
  props.run.todoDeclared ? props.run.todos : []
);
function resultLabel(name: string): string {
  return name === "execution-log.json"
    ? t("chat.execution.executionLog")
    : name;
}
function formatBytes(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}
</script>

<style scoped>
.execution-rail {
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;
  min-height: 0;
  border-left: 1px solid var(--phy-color-border-subtle);
  background: var(--phy-color-bg-page);
  overflow: auto;
}
.execution-rail__section {
  padding: 16px 14px;
}
.execution-rail__controls {
  display: flex;
  justify-content: flex-end;
  padding: 10px 14px 0;
}
.execution-rail__cancel {
  width: auto !important;
  border: 1px solid var(--phy-color-border-subtle) !important;
  padding: 6px 10px !important;
}
.execution-rail__section + .execution-rail__section {
  border-top: 1px solid var(--phy-color-border-subtle);
}
.execution-rail__section h3 {
  margin: 0 0 12px;
  color: var(--phy-color-text);
  font-size: 13px;
  font-weight: 700;
}
.execution-rail__list {
  display: grid;
  gap: 9px;
  margin: 0;
  padding: 0;
  list-style: none;
}
.execution-rail__list li {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  color: var(--phy-color-text-secondary);
  font-size: 12px;
  line-height: 1.4;
}
.execution-rail__list li.is-completed {
  color: var(--phy-color-text-muted);
}
.execution-rail__check {
  flex: 0 0 auto;
  display: inline-grid;
  place-items: center;
  width: 16px;
  height: 16px;
  border: 1px solid var(--phy-color-border-subtle);
  border-radius: 50%;
  color: var(--phy-color-bg-page);
}
.is-in_progress .execution-rail__check {
  border-color: var(--phy-color-accent);
  box-shadow: inset 0 0 0 4px var(--phy-color-bg-page);
  background: var(--phy-color-accent);
}
.is-completed .execution-rail__check {
  border-color: var(--phy-color-accent);
  background: var(--phy-color-accent);
}
.execution-rail__empty {
  color: var(--phy-color-text-muted);
  font-size: 12px;
  line-height: 1.5;
}
.execution-rail__results {
  flex: 1;
  min-height: 180px;
}
.execution-rail button {
  display: flex;
  width: 100%;
  gap: 8px;
  padding: 5px;
  border: 0;
  border-radius: var(--phy-radius-sm);
  background: transparent;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
}
.execution-rail button:hover {
  background: var(--phy-color-bg-elevated);
}
.execution-rail button:focus-visible {
  outline: 2px solid var(--phy-color-focus);
}
.execution-rail__file {
  color: var(--phy-color-accent);
}
.execution-rail__result-copy {
  display: grid;
  min-width: 0;
  gap: 2px;
}
.execution-rail__result-copy strong {
  overflow: hidden;
  font-size: 12px;
  font-weight: 600;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.execution-rail__result-copy small {
  color: var(--phy-color-text-muted);
  font-size: 10.5px;
}
</style>
