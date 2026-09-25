<template>
  <ol
    class="execution-timeline execution-timeline__workflow"
    :aria-label="t('chat.execution.activity')"
  >
    <li
      v-for="item in workflowItems"
      :key="item.id"
      class="execution-timeline__item"
      :class="[
        item.kind === 'operation'
          ? 'execution-timeline__operation'
          : 'execution-timeline__workflow-event',
        `is-${item.kind === 'operation' ? item.operation.status : item.event.status}`,
        {
          'is-actionable':
            (item.kind === 'event' && Boolean(item.event.target)) ||
            (item.kind === 'operation' &&
              item.operation.target?.kind === 'trace'),
        },
      ]"
    >
      <details v-if="item.kind === 'operation'">
        <summary
          class="execution-timeline__row"
          @click="activateOperation($event, item.operation)"
        >
          <span class="execution-timeline__content">
            <span class="execution-timeline__icon" aria-hidden="true"></span>
            <span class="execution-timeline__copy">
              <span class="execution-timeline__label">
                {{ operationLabel(item.operation) }}
                <small v-if="operationContext(item.operation)">
                  {{ operationContext(item.operation) }}
                </small>
              </span>
              <span class="execution-timeline__meta">
                {{ operationMeta(item.operation) }}
              </span>
              <span
                v-if="item.operation.progress"
                class="execution-timeline__progress"
              >
                {{
                  t("chat.execution.progress", {
                    completed: item.operation.progress.completed,
                    total: item.operation.progress.total,
                    unit: counterUnitLabel(item.operation.progress.unit),
                  })
                }}
              </span>
            </span>
          </span>
        </summary>
        <div class="execution-timeline__operation-detail">
          <p v-if="item.operation.summary" class="execution-timeline__summary">
            <strong v-if="item.operation.summary.kind !== 'operation'">
              {{ operationSummaryLabel(item.operation.summary.kind) }}:
            </strong>
            {{ item.operation.summary.text }}
          </p>
          <dl v-if="Object.keys(item.operation.detail).length">
            <template v-for="(value, key) in item.operation.detail" :key="key">
              <dt>{{ operationDetailLabel(key) }}</dt>
              <dd>{{ value }}</dd>
            </template>
          </dl>
          <ol
            v-if="item.operation.attempts.length"
            class="execution-timeline__attempts"
            :aria-label="t('chat.execution.attemptHistory')"
          >
            <li
              v-for="attempt in item.operation.attempts"
              :key="attempt.attempt"
            >
              <span>
                {{
                  t("chat.execution.attempt", {
                    attempt: attempt.attempt,
                    status: operationStatusLabel(attempt.status),
                  })
                }}
              </span>
              <span>{{ formatDuration(attempt.durationMs) }}</span>
              <span v-if="attempt.retry">
                {{
                  t("chat.execution.retryDelay", {
                    delay: formatDuration(attempt.retry.delayMs),
                  })
                }}
              </span>
              <span v-if="attempt.failure">
                {{
                  t("chat.execution.failureCode", {
                    code: attempt.failure.code,
                  })
                }}
              </span>
            </li>
          </ol>
          <section
            v-if="item.groupedOperations.length"
            class="execution-timeline__branches"
          >
            <h4>{{ t("chat.execution.analysisBranches") }}</h4>
            <ol>
              <li
                v-for="branch in item.groupedOperations"
                :key="branch.workUnitId"
              >
                <button
                  v-if="branch.target"
                  type="button"
                  @click="
                    emit('open-target', branch.target, operationLabel(branch))
                  "
                >
                  <span>{{ operationLabel(branch) }}</span>
                  <small>{{ operationMeta(branch) }}</small>
                </button>
                <span v-else>
                  <span>{{ operationLabel(branch) }}</span>
                  <small>{{ operationMeta(branch) }}</small>
                </span>
              </li>
            </ol>
          </section>
          <section
            v-if="item.relatedOperations.length"
            class="execution-timeline__related"
          >
            <h4>{{ t("chat.execution.submissionAttempts") }}</h4>
            <ol>
              <li
                v-for="related in item.relatedOperations"
                :key="related.workUnitId"
              >
                <span>{{ operationLabel(related) }}</span>
                <small>{{ operationMeta(related) }}</small>
                <small v-if="related.attempts.length">
                  {{
                    t("chat.execution.attemptCount", {
                      count: related.attempts.length,
                    })
                  }}
                </small>
              </li>
            </ol>
          </section>
          <button
            v-if="item.operation.target"
            type="button"
            class="execution-timeline__target"
            @click="
              emit(
                'open-target',
                item.operation.target,
                operationLabel(item.operation)
              )
            "
          >
            {{ t("chat.execution.openResult") }}
          </button>
        </div>
      </details>
      <template v-else>
        <button
          v-if="item.event.target"
          type="button"
          class="execution-timeline__row"
          :style="{ '--execution-depth': executionDepth(item.event) }"
          @click="
            emit('open-target', item.event.target, eventLabel(item.event))
          "
        >
          <span class="execution-timeline__content">
            <span class="execution-timeline__icon" aria-hidden="true"></span>
            <span class="execution-timeline__copy">
              <span class="execution-timeline__label">
                {{ eventLabel(item.event) }}
              </span>
              <span class="execution-timeline__meta">
                {{ eventMeta(item.event, item.occurredAt) }}
              </span>
              <span
                v-if="publicEventSummary(item.event)"
                class="execution-timeline__summary"
              >
                {{ publicEventSummary(item.event) }}
              </span>
            </span>
            <span class="execution-timeline__open" aria-hidden="true">›</span>
          </span>
        </button>
        <div
          v-else
          class="execution-timeline__row"
          :style="{ '--execution-depth': executionDepth(item.event) }"
        >
          <span class="execution-timeline__content">
            <span class="execution-timeline__icon" aria-hidden="true"></span>
            <span class="execution-timeline__copy">
              <span class="execution-timeline__label">
                {{ eventLabel(item.event) }}
              </span>
              <span class="execution-timeline__meta">
                {{ eventMeta(item.event, item.occurredAt) }}
              </span>
              <span
                v-if="publicEventSummary(item.event)"
                class="execution-timeline__summary"
              >
                {{ publicEventSummary(item.event) }}
              </span>
            </span>
          </span>
        </div>
      </template>
    </li>
  </ol>
  <button
    v-if="technicalEventCount"
    type="button"
    class="execution-timeline__technical"
    @click="emit('open-diagnostics')"
  >
    <span>
      {{ t("chat.execution.technicalDetails") }} ·
      {{
        t("chat.execution.technicalEventCount", {
          count: technicalEventCount,
        })
      }}
    </span>
    <span aria-hidden="true">›</span>
  </button>
  <p
    v-if="livenessLabel"
    class="execution-timeline__liveness"
    :class="`is-${run.delivery}`"
    role="status"
    aria-live="polite"
  >
    {{ livenessLabel }}
  </p>
  <p
    v-if="providerContactLabel"
    class="execution-timeline__liveness"
    data-clock="provider"
  >
    {{ providerContactLabel }}
  </p>
  <p
    v-if="streamContactLabel"
    class="execution-timeline__liveness"
    data-clock="stream"
  >
    {{ streamContactLabel }}
  </p>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from "vue";
import { useI18n } from "vue-i18n";
import type {
  ExecutionEvent,
  ExecutionOperationRecord,
  ExecutionRunState,
  ExecutionTarget,
} from "../streaming/executionEvents";
import { presentExecutionWorkflowItems } from "../executionActivityPresentation";

const props = defineProps<{ run: ExecutionRunState }>();
const emit = defineEmits<{
  "open-target": [target: ExecutionTarget, title: string];
  "open-diagnostics": [];
}>();
const { t, te } = useI18n();
const now = ref(Date.now());
const timer = window.setInterval(() => (now.value = Date.now()), 15_000);
onBeforeUnmount(() => window.clearInterval(timer));

const workflowItems = computed(() => presentExecutionWorkflowItems(props.run));
const technicalEventCount = computed(() => props.run.events.length);
const terminal = computed(() => props.run.terminal !== null);
const elapsedSeconds = computed(() => {
  const started = props.run.startedAt
    ? Date.parse(props.run.startedAt)
    : Number.NaN;
  return Number.isFinite(started)
    ? Math.max(0, Math.floor((now.value - started) / 1000))
    : 0;
});
const lastActivitySeconds = computed(() => {
  const semanticAt =
    props.run.executionStage?.clocks.lastExecutionFactAt ??
    props.run.lastActivityAt;
  const last = semanticAt ? Date.parse(semanticAt) : Number.NaN;
  return Number.isFinite(last)
    ? Math.max(0, Math.floor((now.value - last) / 1000))
    : 0;
});
const lastContactSeconds = computed(() => {
  const last = props.run.lastContactAt
    ? Date.parse(props.run.lastContactAt)
    : Number.NaN;
  return Number.isFinite(last)
    ? Math.max(0, Math.floor((now.value - last) / 1000))
    : null;
});
const livenessLabel = computed(() => {
  if (props.run.delivery === "reconnecting")
    return t("chat.execution.reconnecting");
  if (props.run.delivery === "gap") return t("chat.execution.gap");
  if (props.run.delivery === "stale" || props.run.delivery === "degraded") {
    return t("chat.execution.stale");
  }
  if (terminal.value)
    return t(`chat.execution.status.${props.run.terminal?.status}`);
  return t("chat.execution.active", {
    elapsed: elapsedSeconds.value,
    quiet: lastActivitySeconds.value,
  });
});
const providerContactLabel = computed(() => {
  const value = props.run.executionStage?.clocks.lastProviderContactAt;
  if (!value) return null;
  return t("chat.execution.providerContact", {
    quiet: secondsSince(value),
  });
});
const streamContactLabel = computed(() => {
  if (lastContactSeconds.value === null) return null;
  return lastContactSeconds.value <= 30
    ? t("chat.execution.streamConnected")
    : t("chat.execution.streamContact", {
        quiet: lastContactSeconds.value,
      });
});

function secondsSince(value: string): number {
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp)
    ? Math.max(0, Math.floor((now.value - timestamp) / 1000))
    : 0;
}

function localizedContractKey(key: string, fallback: string): string {
  if (te(key)) return t(key);
  const chatKey = `chat.${key}`;
  return te(chatKey) ? t(chatKey) : fallback;
}

function operationLabel(operation: ExecutionOperationRecord): string {
  return localizedContractKey(operation.labelKey, operation.fallbackLabel);
}

function activateOperation(
  event: MouseEvent,
  operation: ExecutionOperationRecord
): void {
  if (operation.target?.kind !== "trace") return;
  event.preventDefault();
  emit("open-target", operation.target, operationLabel(operation));
}

function operationContext(operation: ExecutionOperationRecord): string | null {
  const ordinal = operation.detail.ordinal;
  const total = operation.detail.total;
  return typeof ordinal === "number" &&
    Number.isSafeInteger(ordinal) &&
    typeof total === "number" &&
    Number.isSafeInteger(total) &&
    total > 0
    ? `${ordinal}/${total}`
    : null;
}

function operationStatusLabel(status: string): string {
  const key = `chat.execution.operationStatus.${status}`;
  return te(key) ? t(key) : status;
}

function counterUnitLabel(unit: string): string {
  const key = `chat.execution.counterUnit.${unit}`;
  return te(key) ? t(key) : unit;
}

function operationDetailLabel(key: string): string {
  const localeKey = `chat.execution.operationDetail.${key}`;
  return te(localeKey) ? t(localeKey) : key.replaceAll("_", " ");
}

function operationSummaryLabel(kind: "decision" | "reasoning"): string {
  return kind === "decision"
    ? t("chat.execution.decisionNote")
    : t("chat.execution.reasoningSummary");
}

function formatDuration(durationMs: number): string {
  return durationMs < 1000
    ? t("chat.execution.durationMs", { duration: durationMs })
    : t("chat.execution.durationSeconds", {
        duration: (durationMs / 1000).toFixed(1),
      });
}

function operationMeta(operation: ExecutionOperationRecord): string {
  const terminal = [
    "succeeded",
    "partial",
    "failed",
    "cancelled",
    "timed_out",
  ].includes(operation.status);
  const elapsed = terminal
    ? operation.durationMs
    : Math.max(
        operation.durationMs,
        now.value - Date.parse(operation.startedAt)
      );
  const parts = [
    operationStatusLabel(operation.status),
    formatDuration(elapsed),
  ];
  const needsDiagnostics =
    operation.status !== "succeeded" || operation.currentAttempt > 1;
  if (needsDiagnostics) {
    parts.push(
      t("chat.execution.currentAttempt", {
        attempt: operation.currentAttempt,
      }),
      t("chat.execution.lastObserved", {
        time: new Intl.DateTimeFormat(undefined, {
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
        }).format(new Date(operation.lastObservationAt)),
      })
    );
  }
  return parts.join(" · ");
}

function eventLabel(event: ExecutionEvent): string {
  if (event.kind === "todo.snapshot") return t("chat.execution.workflowPlan");
  if (event.kind === "reasoning.summary")
    return t("chat.execution.reasoningSummary");
  if (event.kind === "decision.note") return t("chat.execution.decisionNote");
  const phaseLabel = semanticPhaseLabel(event);
  if (phaseLabel) return phaseLabel;
  if (event.summary.key.startsWith("provider.observation.")) {
    const providerStatus = `chat.execution.provider.${event.status}`;
    if (te(providerStatus)) return t(providerStatus);
  }
  return te(event.summary.key) ? t(event.summary.key) : event.summary.text;
}

function semanticPhaseLabel(event: ExecutionEvent): string | null {
  if (
    ![
      "phase.started",
      "phase.progress",
      "phase.completed",
      "phase.failed",
      "span.started",
      "span.progress",
      "span.succeeded",
      "span.failed",
    ].includes(event.kind)
  ) {
    return null;
  }
  const phase = event.payload.phase;
  if (typeof phase !== "string" || !phase) return null;
  const key = `chat.execution.todoPhase.${phase}`;
  if (!te(key)) return null;
  const label = t(key);
  if (event.kind.endsWith(".progress")) {
    const completed = event.payload.completed;
    const total = event.payload.total;
    if (
      typeof completed === "number" &&
      Number.isInteger(completed) &&
      typeof total === "number" &&
      Number.isInteger(total) &&
      total > 0
    ) {
      return `${label} · ${completed}/${total}`;
    }
  }
  if (event.kind === "span.succeeded" || event.kind === "phase.completed") {
    return t("chat.execution.phaseCompleted", { phase: label });
  }
  if (event.kind === "span.failed") {
    return t("chat.execution.phaseFailed", { phase: label });
  }
  return label;
}

function eventMeta(
  event: ExecutionEvent,
  occurredAt = event.occurredAt
): string {
  const time = new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date(occurredAt));
  const duration = event.payload.duration_ms;
  const todoItems = event.kind === "todo.snapshot" ? event.payload.items : null;
  const parts = Array.isArray(todoItems)
    ? [
        t("chat.execution.workflowPlanSteps", {
          count: todoItems.length,
        }),
        time,
      ]
    : [time];
  if ((event.attempt ?? 1) > 1) parts.push(`attempt ${event.attempt}`);
  if (typeof duration === "number") parts.push(`${duration} ms`);
  return parts.join(" · ");
}

function publicEventSummary(event: ExecutionEvent): string | null {
  return ["reasoning.summary", "decision.note"].includes(event.kind) &&
    typeof event.payload.text === "string"
    ? event.payload.text
    : null;
}

function executionDepth(event: ExecutionEvent): string {
  let depth = 0;
  let parent = event.parentSpanId ?? null;
  const visited = new Set<string>();
  while (parent && depth < 6 && !visited.has(parent)) {
    visited.add(parent);
    depth += 1;
    parent = props.run.spans[parent]?.parentSpanId ?? null;
  }
  return String(depth);
}
</script>

<style scoped>
.execution-timeline {
  list-style: none;
  margin: 0;
  padding: 2px 0;
}
.execution-timeline__item {
  position: relative;
  margin: 0;
}
.execution-timeline__operation details {
  margin-bottom: 6px;
  border: 1px solid var(--phy-color-border-subtle);
  border-radius: var(--phy-radius-sm);
}
.execution-timeline__operation summary {
  cursor: pointer;
  list-style: none;
}
.execution-timeline__operation summary::-webkit-details-marker {
  display: none;
}
.execution-timeline__operation summary:focus-visible {
  outline: 2px solid var(--phy-color-focus);
  outline-offset: 1px;
}
.execution-timeline__operation details[open] {
  background: var(--phy-color-bg-elevated);
}
.execution-timeline__operation-detail {
  padding: 0 10px 10px 21px;
}
.execution-timeline__operation-detail dl {
  display: grid;
  grid-template-columns: minmax(90px, auto) 1fr;
  gap: 4px 10px;
  margin: 8px 0;
  color: var(--phy-color-text-secondary);
  font-size: 11.5px;
}
.execution-timeline__operation-detail dt {
  color: var(--phy-color-text-muted);
}
.execution-timeline__operation-detail dd {
  margin: 0;
  overflow-wrap: anywhere;
}
.execution-timeline__attempts {
  display: grid;
  gap: 4px;
  margin: 8px 0;
  padding-left: 18px;
  color: var(--phy-color-text-muted);
  font-size: 11.5px;
}
.execution-timeline__attempts li {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 8px;
}
.execution-timeline__branches,
.execution-timeline__related {
  margin-top: 10px;
}
.execution-timeline__branches h4,
.execution-timeline__related h4 {
  margin: 0 0 5px;
  color: var(--phy-color-text-secondary);
  font-size: 11.5px;
}
.execution-timeline__branches ol,
.execution-timeline__related ol {
  display: grid;
  gap: 4px;
  margin: 0;
  padding: 0;
  list-style: none;
}
.execution-timeline__branches li > span,
.execution-timeline__branches li > button,
.execution-timeline__related li {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
  padding: 5px 7px;
  border: 1px solid var(--phy-color-border-subtle);
  border-radius: var(--phy-radius-sm);
  color: var(--phy-color-text-secondary);
  font-size: 11.5px;
}
.execution-timeline__branches li > button {
  width: 100%;
  background: var(--phy-color-bg-page);
  cursor: pointer;
  text-align: left;
}
.execution-timeline__branches small,
.execution-timeline__related small {
  color: var(--phy-color-text-muted);
}
.execution-timeline__target {
  min-height: 32px;
  border: 1px solid var(--phy-color-border-subtle);
  border-radius: var(--phy-radius-sm);
  background: var(--phy-color-bg-page);
  color: var(--phy-color-text-secondary);
  cursor: pointer;
}
.execution-timeline__target:focus-visible {
  outline: 2px solid var(--phy-color-focus);
}
.execution-timeline__truncated {
  padding: 7px 4px;
  color: var(--phy-color-text-muted);
  font-size: 11.5px;
}
.execution-timeline__row {
  box-sizing: border-box;
  display: block;
  width: 100%;
  padding: 7px 4px 7px calc(4px + var(--execution-depth, 0) * 14px);
  border: 1px solid var(--phy-color-border-subtle);
  border-radius: var(--phy-radius-sm);
  background: var(--phy-color-bg-page);
  color: inherit;
  font: inherit;
  text-align: left;
}
.execution-timeline__workflow-event .execution-timeline__row {
  margin-bottom: 6px;
}
.execution-timeline__operation .execution-timeline__row {
  border: 0;
  background: transparent;
}
button.execution-timeline__row {
  cursor: pointer;
  border-radius: var(--phy-radius-sm);
}
button.execution-timeline__row:hover {
  background: var(--phy-color-bg-elevated);
}
button.execution-timeline__row:focus-visible {
  outline: 2px solid var(--phy-color-focus);
  outline-offset: 1px;
}
.execution-timeline__content {
  display: flex;
  align-items: flex-start;
  gap: 9px;
  min-width: 0;
}
.execution-timeline__icon {
  flex: 0 0 auto;
  width: 8px;
  height: 8px;
  margin-top: 5px;
  border: 2px solid var(--phy-color-bg-page);
  border-radius: 50%;
  background: var(--phy-color-brand-blue);
  box-shadow: 0 0 0 1px var(--phy-color-border-subtle);
}
.is-running .execution-timeline__icon,
.is-queued .execution-timeline__icon,
.is-waiting_input .execution-timeline__icon,
.is-retry_scheduled .execution-timeline__icon {
  background: var(--phy-color-accent);
}
.is-failed .execution-timeline__icon {
  background: var(--el-color-danger);
}
.is-cancelled .execution-timeline__icon {
  background: var(--phy-color-text-muted);
}
.execution-timeline__copy {
  display: grid;
  flex: 1;
  min-width: 0;
  gap: 2px;
}
.execution-timeline__label {
  color: var(--phy-color-text-secondary);
  font-size: 12.5px;
  line-height: 1.4;
  overflow-wrap: anywhere;
}
.execution-timeline__label small {
  margin-left: 5px;
  color: var(--phy-color-text-muted);
  font-size: 11px;
  font-weight: 500;
}
.execution-timeline__meta {
  color: var(--phy-color-text-muted);
  font-size: 11px;
}
.execution-timeline__progress {
  color: var(--phy-color-text-secondary);
  font-size: 11.5px;
}
.execution-timeline__summary {
  margin-top: 3px;
  color: var(--phy-color-text-secondary);
  font-size: 12px;
  line-height: 1.55;
  white-space: pre-wrap;
}
.execution-timeline__open {
  color: var(--phy-color-text-muted);
  font-size: 18px;
  line-height: 1;
}
.execution-timeline__technical {
  box-sizing: border-box;
  display: flex;
  width: 100%;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin-top: 8px;
  border: 0;
  border-top: 1px solid var(--phy-color-border-subtle);
  padding: 12px 3px 4px;
  background: transparent;
  color: var(--phy-color-text-muted);
  cursor: pointer;
  font: inherit;
  font-size: 11.5px;
  text-align: left;
}
.execution-timeline__technical > span:first-child {
  font-weight: 600;
}
.execution-timeline__technical:focus-visible {
  outline: 2px solid var(--phy-color-focus);
  outline-offset: 1px;
}
.execution-timeline__technical:hover {
  background: var(--phy-color-bg-elevated);
}
.execution-timeline__liveness {
  margin: 6px 3px 2px;
  color: var(--phy-color-text-muted);
  font-size: 11.5px;
}
.execution-timeline__liveness.is-reconnecting,
.execution-timeline__liveness.is-gap,
.execution-timeline__liveness.is-stale,
.execution-timeline__liveness.is-degraded {
  color: var(--el-color-warning);
}
@media (prefers-reduced-motion: reduce) {
  .execution-timeline__icon {
    animation: none;
  }
}
@media (max-width: 640px) {
  .execution-timeline__operation-detail {
    padding-left: 10px;
  }
  .execution-timeline__operation-detail dl {
    grid-template-columns: 1fr;
    gap: 2px;
  }
  .execution-timeline__attempts li {
    display: grid;
  }
}
</style>
