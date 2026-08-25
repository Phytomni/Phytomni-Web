<template>
  <article
    class="execution-work-trace"
    aria-labelledby="execution-work-trace-title"
  >
    <header class="execution-work-trace__header">
      <div>
        <h3 id="execution-work-trace-title">
          {{ localized(operation.labelKey, operation.fallbackLabel) }}
        </h3>
        <p>
          {{ operationStatus(operation.status) }} ·
          {{ formatDuration(operation.durationMs) }}
        </p>
      </div>
      <span :class="`is-${trace.health}`" role="status" aria-live="polite">
        {{ t(`chat.execution.trace.health.${trace.health}`) }}
      </span>
    </header>

    <dl class="execution-work-trace__clocks">
      <template v-if="trace.lastSemanticActivityAt">
        <dt>{{ t("chat.execution.trace.lastSemanticActivity") }}</dt>
        <dd>
          <time>{{ trace.lastSemanticActivityAt }}</time>
        </dd>
      </template>
      <template v-if="trace.lastProviderContactAt">
        <dt>{{ t("chat.execution.trace.lastProviderContact") }}</dt>
        <dd>
          <time>{{ trace.lastProviderContactAt }}</time>
        </dd>
      </template>
    </dl>

    <ol
      class="execution-work-trace__feed"
      :aria-label="t('chat.execution.trace.feed')"
    >
      <li v-for="item in trace.items" :key="`${item.seq}:${item.itemId}`">
        <details :open="item.status === 'running'">
          <summary>
            <span
              class="execution-work-trace__marker"
              aria-hidden="true"
            ></span>
            <span>
              <span class="execution-work-trace__kind">
                {{ t(`chat.execution.trace.kind.${item.kind}`) }}
              </span>
              <strong>{{
                localized(item.labelKey, item.fallbackLabel)
              }}</strong>
              <small>
                {{ operationStatus(item.status) }} ·
                {{ formatDuration(item.durationMs ?? 0) }}
              </small>
            </span>
          </summary>
          <div class="execution-work-trace__detail">
            <p v-if="item.summary">
              <strong
                v-if="
                  item.kind === 'reasoning_summary' || item.kind === 'decision'
                "
              >
                {{ t(`chat.execution.trace.kind.${item.kind}`) }}:
              </strong>
              {{ item.summary }}
            </p>
            <p v-if="item.progress">
              {{ item.progress.completed }}/{{ item.progress.total }}
              {{ counterUnit(item.progress.unit) }}
            </p>
            <dl v-if="Object.keys(item.detail).length">
              <template v-for="(value, key) in item.detail" :key="key">
                <dt>{{ detailLabel(String(key)) }}</dt>
                <dd>{{ value }}</dd>
              </template>
            </dl>
            <ol
              v-if="item.attempts.length"
              :aria-label="t('chat.execution.attemptHistory')"
            >
              <li v-for="attempt in item.attempts" :key="attempt.attempt">
                {{
                  t("chat.execution.attempt", {
                    attempt: attempt.attempt,
                    status: operationStatus(attempt.status),
                  })
                }}
                · {{ formatDuration(attempt.durationMs) }}
              </li>
            </ol>
            <button
              v-if="item.target"
              type="button"
              class="execution-work-trace__result"
              @click="
                emit(
                  'open-target',
                  item.target,
                  localized(item.labelKey, item.fallbackLabel)
                )
              "
            >
              {{ t("chat.execution.openResult") }}
            </button>
          </div>
        </details>
      </li>
    </ol>
  </article>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import type {
  ExecutionOperationAttemptStatus,
  ExecutionOperationStatus,
  ExecutionTarget,
  ExecutionTraceResolution,
} from "../streaming/executionEvents";

const props = defineProps<{ trace: ExecutionTraceResolution }>();
const emit = defineEmits<{
  "open-target": [target: ExecutionTarget, title: string];
}>();
const { t, te } = useI18n();
const operation = computed(() => props.trace.operation);

function localized(key: string, fallback: string): string {
  if (te(key)) return t(key);
  const chatKey = `chat.${key}`;
  return te(chatKey) ? t(chatKey) : fallback;
}

function operationStatus(
  status: ExecutionOperationStatus | ExecutionOperationAttemptStatus | "pending"
): string {
  return t(`chat.execution.operationStatus.${status}`);
}

function formatDuration(durationMs: number): string {
  if (durationMs < 1000) {
    return t("chat.execution.durationMs", { duration: durationMs });
  }
  return t("chat.execution.durationSeconds", {
    duration: (durationMs / 1000).toFixed(1),
  });
}

function detailLabel(key: string): string {
  const translationKey = `chat.execution.operationDetail.${key}`;
  return te(translationKey) ? t(translationKey) : key;
}

function counterUnit(unit: string): string {
  const translationKey = `chat.execution.counterUnit.${unit}`;
  return te(translationKey) ? t(translationKey) : unit;
}
</script>

<style scoped>
.execution-work-trace {
  display: grid;
  gap: 18px;
  max-width: 920px;
  margin: 0 auto;
}
.execution-work-trace__header {
  display: flex;
  justify-content: space-between;
  gap: 16px;
  padding-bottom: 14px;
  border-bottom: 1px solid var(--phy-color-border-subtle);
}
.execution-work-trace__header h3,
.execution-work-trace__header p {
  margin: 0;
}
.execution-work-trace__header p,
.execution-work-trace__header > span,
.execution-work-trace__feed small {
  color: var(--phy-color-text-muted);
  font-size: 12px;
}
.execution-work-trace__clocks,
.execution-work-trace__detail dl {
  display: grid;
  grid-template-columns: max-content minmax(0, 1fr);
  gap: 6px 14px;
  margin: 0;
}
.execution-work-trace__clocks dt,
.execution-work-trace__detail dt {
  color: var(--phy-color-text-muted);
}
.execution-work-trace__clocks dd,
.execution-work-trace__detail dd {
  margin: 0;
  overflow-wrap: anywhere;
}
.execution-work-trace__feed {
  display: grid;
  gap: 10px;
  margin: 0;
  padding: 0;
  list-style: none;
}
.execution-work-trace__feed > li {
  border: 1px solid var(--phy-color-border-subtle);
  border-radius: 10px;
  background: var(--phy-color-bg-surface);
}
.execution-work-trace__feed summary {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 12px;
  cursor: pointer;
}
.execution-work-trace__feed summary > span:last-child {
  display: grid;
  gap: 3px;
}
.execution-work-trace__kind {
  color: var(--phy-color-text-muted);
  font-size: 11px;
}
.execution-work-trace__marker {
  width: 8px;
  height: 8px;
  margin-top: 5px;
  border-radius: 50%;
  background: var(--phy-color-brand-primary);
}
.execution-work-trace__detail {
  display: grid;
  gap: 10px;
  padding: 0 12px 12px 30px;
}
.execution-work-trace__detail p,
.execution-work-trace__detail ol {
  margin: 0;
}
.execution-work-trace__result {
  justify-self: start;
}
@media (max-width: 640px) {
  .execution-work-trace__header {
    flex-direction: column;
    gap: 8px;
  }
  .execution-work-trace__clocks,
  .execution-work-trace__detail dl {
    grid-template-columns: 1fr;
    gap: 2px;
  }
  .execution-work-trace__detail {
    padding-left: 12px;
  }
}
</style>
