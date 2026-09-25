<template>
  <section class="execution-diagnostics" aria-labelledby="diagnostics-title">
    <header class="execution-diagnostics__header">
      <div>
        <h3 id="diagnostics-title">
          {{ t("chat.execution.technicalDetails") }}
        </h3>
        <p class="execution-diagnostics__counts">
          <span data-test="diagnostics-total">{{ totalFacts }}</span>
          {{ t("chat.execution.diagnostics.total") }} ·
          <span data-test="diagnostics-displayed">{{
            displayedEvents.length
          }}</span>
          {{ t("chat.execution.diagnostics.displayed") }}
          <template v-if="isTruncated">
            · {{ t("chat.execution.diagnostics.truncated") }}
          </template>
        </p>
      </div>
      <button
        data-test="diagnostics-export"
        type="button"
        class="execution-diagnostics__action"
        @click="exportLedger"
      >
        {{ t("chat.execution.diagnostics.export") }}
      </button>
    </header>

    <div class="execution-diagnostics__filters">
      <label>
        {{ t("chat.execution.diagnostics.kind") }}
        <select v-model="kindFilter">
          <option value="">{{ t("chat.execution.diagnostics.all") }}</option>
          <option v-for="kind in kinds" :key="kind" :value="kind">
            {{ kind }}
          </option>
        </select>
      </label>
      <label>
        {{ t("chat.execution.diagnostics.source") }}
        <select v-model="sourceFilter">
          <option value="">{{ t("chat.execution.diagnostics.all") }}</option>
          <option v-for="source in sources" :key="source" :value="source">
            {{ source }}
          </option>
        </select>
      </label>
      <label>
        {{ t("chat.execution.diagnostics.status") }}
        <select v-model="statusFilter">
          <option value="">{{ t("chat.execution.diagnostics.all") }}</option>
          <option v-for="status in statuses" :key="status" :value="status">
            {{ status }}
          </option>
        </select>
      </label>
    </div>

    <section class="execution-diagnostics__groups">
      <h4>{{ t("chat.execution.diagnostics.groups") }}</h4>
      <ul>
        <li
          v-for="group in displayedGroups"
          :key="group.key"
          class="execution-diagnostics__group"
        >
          <span>{{ group.kind }}</span>
          <span>{{ group.source }}</span>
          <span>{{ group.workUnit }}</span>
          <strong>{{ group.count }}</strong>
          <small>{{ group.firstAt }} — {{ group.lastAt }}</small>
        </li>
      </ul>
      <p
        v-if="groups.length > displayedGroups.length"
        class="execution-diagnostics__notice"
      >
        {{
          t("chat.execution.diagnostics.groupsBounded", {
            displayed: displayedGroups.length,
            total: groups.length,
          })
        }}
      </p>
    </section>

    <section class="execution-diagnostics__ledger">
      <h4>{{ t("chat.execution.diagnostics.ledger") }}</h4>
      <ol :start="pageStart + 1">
        <li
          v-for="event in displayedEvents"
          :key="event.eventId"
          class="execution-diagnostics__event"
        >
          <button
            v-if="event.target"
            type="button"
            @click="emit('open-target', event.target, event.summary.text)"
          >
            <span>{{ event.eventId }}</span>
            <span>{{ event.kind }}</span>
            <span>{{ event.summary.text }}</span>
            <time :datetime="event.occurredAt">{{ event.occurredAt }}</time>
          </button>
          <div v-else>
            <span>{{ event.eventId }}</span>
            <span>{{ event.kind }}</span>
            <span>{{ event.summary.text }}</span>
            <time :datetime="event.occurredAt">{{ event.occurredAt }}</time>
          </div>
        </li>
      </ol>
      <nav
        v-if="pageCount > 1"
        class="execution-diagnostics__pagination"
        :aria-label="t('chat.execution.diagnostics.pagination')"
      >
        <button type="button" :disabled="page === 0" @click="page -= 1">
          {{ t("common.previous") }}
        </button>
        <span>{{ page + 1 }} / {{ pageCount }}</span>
        <button
          data-test="diagnostics-next"
          type="button"
          :disabled="page + 1 >= pageCount"
          @click="page += 1"
        >
          {{ t("common.next") }}
        </button>
      </nav>
    </section>
  </section>
</template>

<script setup lang="ts">
import { saveAs } from "file-saver";
import { computed, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import type {
  ExecutionEvent,
  ExecutionRunState,
  ExecutionTarget,
} from "../streaming/executionEvents";

const PAGE_SIZE = 100;
const MAX_GROUPS = 100;
const props = defineProps<{ run: ExecutionRunState }>();
const emit = defineEmits<{
  "open-target": [target: ExecutionTarget, title: string];
}>();
const { t } = useI18n();
const kindFilter = ref("");
const sourceFilter = ref("");
const statusFilter = ref("");
const page = ref(0);

const orderedEvents = computed(() =>
  [...props.run.events].sort((left, right) => left.seq - right.seq)
);
const totalFacts = computed(() =>
  Math.max(props.run.latestSeq, orderedEvents.value.length)
);
const kinds = computed(() =>
  unique(orderedEvents.value.map((event) => event.kind))
);
const sources = computed(() =>
  unique(orderedEvents.value.map((event) => event.source ?? "unknown"))
);
const statuses = computed(() =>
  unique(orderedEvents.value.map((event) => event.status))
);
const filteredEvents = computed(() =>
  orderedEvents.value.filter(
    (event) =>
      (!kindFilter.value || event.kind === kindFilter.value) &&
      (!sourceFilter.value ||
        (event.source ?? "unknown") === sourceFilter.value) &&
      (!statusFilter.value || event.status === statusFilter.value)
  )
);
const pageCount = computed(() =>
  Math.max(1, Math.ceil(filteredEvents.value.length / PAGE_SIZE))
);
const pageStart = computed(() => page.value * PAGE_SIZE);
const displayedEvents = computed(() =>
  filteredEvents.value.slice(pageStart.value, pageStart.value + PAGE_SIZE)
);
const isTruncated = computed(
  () => displayedEvents.value.length < filteredEvents.value.length
);
const groups = computed(() => groupEvents(filteredEvents.value));
const displayedGroups = computed(() => groups.value.slice(0, MAX_GROUPS));

watch([kindFilter, sourceFilter, statusFilter], () => (page.value = 0));
watch(pageCount, (count) => {
  if (page.value >= count) page.value = count - 1;
});

function unique(values: string[]): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function groupEvents(events: readonly ExecutionEvent[]) {
  const grouped = new Map<
    string,
    {
      key: string;
      kind: string;
      source: string;
      workUnit: string;
      count: number;
      firstAt: string;
      lastAt: string;
    }
  >();
  for (const event of events) {
    const source = event.source ?? "unknown";
    const workUnit = event.workUnitId ?? "execution";
    const key = `${event.kind}\u0000${source}\u0000${workUnit}`;
    const current = grouped.get(key);
    if (current) {
      current.count += 1;
      current.lastAt = event.occurredAt;
    } else {
      grouped.set(key, {
        key,
        kind: event.kind,
        source,
        workUnit,
        count: 1,
        firstAt: event.occurredAt,
        lastAt: event.occurredAt,
      });
    }
  }
  return [...grouped.values()].sort(
    (left, right) =>
      right.count - left.count || left.key.localeCompare(right.key)
  );
}

function exportLedger(): void {
  const body = JSON.stringify(
    {
      schema_version: 2,
      execution_id: props.run.executionId,
      latest_seq: props.run.latestSeq,
      retained_event_count: props.run.events.length,
      events: orderedEvents.value,
    },
    null,
    2
  );
  saveAs(
    new Blob([body], { type: "application/json;charset=utf-8" }),
    `execution-${props.run.executionId}-events.json`
  );
}
</script>

<style scoped>
.execution-diagnostics {
  display: grid;
  gap: 18px;
}
.execution-diagnostics__header,
.execution-diagnostics__pagination,
.execution-diagnostics__event > button,
.execution-diagnostics__event > div {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
.execution-diagnostics h3,
.execution-diagnostics h4,
.execution-diagnostics p {
  margin: 0;
}
.execution-diagnostics__counts,
.execution-diagnostics__notice {
  color: var(--phy-color-text-muted);
  font-size: 12px;
}
.execution-diagnostics__action,
.execution-diagnostics__pagination button {
  min-height: 32px;
  border: 1px solid var(--phy-color-border-subtle);
  border-radius: var(--phy-radius-sm);
  background: var(--phy-color-bg-page);
  cursor: pointer;
}
.execution-diagnostics__filters {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px;
}
.execution-diagnostics__filters label {
  display: grid;
  gap: 5px;
  color: var(--phy-color-text-secondary);
  font-size: 12px;
}
.execution-diagnostics__filters select {
  min-height: 34px;
  border: 1px solid var(--phy-color-border-subtle);
  border-radius: var(--phy-radius-sm);
  background: var(--phy-color-bg-page);
}
.execution-diagnostics__groups ul,
.execution-diagnostics__ledger ol {
  display: grid;
  gap: 5px;
  margin: 8px 0 0;
  padding: 0;
  list-style: none;
}
.execution-diagnostics__group {
  display: grid;
  grid-template-columns:
    minmax(140px, 1fr) minmax(90px, 0.5fr) minmax(120px, 1fr)
    auto minmax(210px, 1fr);
  gap: 10px;
  padding: 7px;
  border-bottom: 1px solid var(--phy-color-border-subtle);
  font-size: 12px;
}
.execution-diagnostics__group small {
  color: var(--phy-color-text-muted);
}
.execution-diagnostics__event > button,
.execution-diagnostics__event > div {
  box-sizing: border-box;
  width: 100%;
  padding: 7px;
  border: 0;
  border-bottom: 1px solid var(--phy-color-border-subtle);
  background: transparent;
  color: inherit;
  font: inherit;
  font-size: 12px;
  text-align: left;
}
.execution-diagnostics__event span:nth-child(3) {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.execution-diagnostics__event time {
  color: var(--phy-color-text-muted);
}
.execution-diagnostics__pagination {
  justify-content: center;
  margin-top: 12px;
}
@media (max-width: 720px) {
  .execution-diagnostics__filters {
    grid-template-columns: 1fr;
  }
  .execution-diagnostics__group,
  .execution-diagnostics__event > button,
  .execution-diagnostics__event > div {
    display: grid;
    grid-template-columns: 1fr;
  }
}
</style>
