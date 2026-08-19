<template>
  <div
    class="send-progress"
    data-test="send-progress"
    role="progressbar"
    :aria-valuemin="0"
    :aria-valuemax="100"
    :aria-valuenow="percentInt"
    :aria-valuetext="valueText"
    :aria-describedby="etaId"
  >
    <div class="send-progress__meter">
      <div class="send-progress__meta">
        <div class="send-progress__copy">
          <span
            class="send-progress__label"
            data-test="progress-label"
            aria-live="polite"
          >
            {{ displayLabel }}
          </span>
          <span :id="etaId" class="send-progress__eta" data-test="progress-eta">
            {{ etaLabel }}
          </span>
        </div>
        <small
          class="send-progress__percent"
          data-test="progress-percent"
          aria-hidden="true"
        >
          {{ percentInt }}%
        </small>
      </div>
      <div class="send-progress__track">
        <div
          class="send-progress__fill"
          data-test="progress-fill"
          :style="{ transform: `scaleX(${widthPct / 100})` }"
        />
      </div>
    </div>
    <details
      v-if="visibleSteps.length > 0"
      class="send-progress__cot"
      data-test="progress-cot"
      :open="cotOpen"
    >
      <summary
        class="send-progress__cot-toggle"
        data-test="progress-cot-toggle"
      >
        {{ t("chat.progress.cotLabel") }}
        <span class="send-progress__cot-count">
          {{
            t("chat.progress.cotCount", {
              shown: visibleSteps.length,
              total: config.stageKeys.length,
            })
          }}
        </span>
      </summary>
      <ol class="send-progress__cot-list">
        <li
          v-for="(step, index) in visibleSteps"
          :key="step.key"
          class="send-progress__cot-item"
          :data-current="index === currentStepIndex"
          :aria-current="index === currentStepIndex ? 'step' : undefined"
          :data-test="
            index === visibleSteps.length - 1
              ? 'progress-cot-current'
              : undefined
          "
        >
          <span class="send-progress__cot-marker" aria-hidden="true">
            <span
              v-if="index === currentStepIndex"
              class="send-progress__cot-spin"
              data-test="progress-cot-spin"
            />
          </span>
          <span class="send-progress__cot-index">{{ index + 1 }}.</span>
          <span class="send-progress__cot-copy">
            {{ step.label }}{{ index === visibleSteps.length - 1 ? "..." : "" }}
          </span>
        </li>
      </ol>
    </details>
  </div>
</template>

<script setup lang="ts">
import {
  computed,
  getCurrentInstance,
  onBeforeUnmount,
  onMounted,
  ref,
  watch,
} from "vue";
import { useI18n } from "vue-i18n";
import {
  COT_FLUSH_STEP_MS,
  ETA_I18N_KEYS,
  etaRangeFor,
  progressAt,
  progressConfigFor,
  revealedStageCount,
  stepDurationMs,
} from "../utils/agentProgress";

const props = defineProps<{
  startedAt: number | null;
  agentName: string;
  completing: boolean;
  stageLabel?: string;
  forceLastStage?: boolean;
}>();

const emit = defineEmits<{
  flushed: [];
}>();

const { t } = useI18n();
const config = computed(() => progressConfigFor(props.agentName));
const etaId = `send-progress-eta-${getCurrentInstance()?.uid ?? "default"}`;
const cotOpen = ref(true);
const flushed = ref(false);
const flushShown = ref(0);

const nowTick = ref(Date.now());
let timer: ReturnType<typeof setInterval> | undefined;
let stepTimer: ReturnType<typeof setTimeout> | undefined;
let flushTimer: ReturnType<typeof setInterval> | undefined;

function clearStepTimer() {
  if (stepTimer) {
    clearTimeout(stepTimer);
    stepTimer = undefined;
  }
}

function scheduleNextStepReveal() {
  clearStepTimer();
  if (props.startedAt == null || props.completing || props.forceLastStage) {
    return;
  }
  const elapsed = Math.max(0, Date.now() - props.startedAt);
  const cfg = config.value;
  if (revealedStageCount(elapsed, cfg) >= cfg.stageKeys.length) return;
  const stepMs = stepDurationMs(cfg);
  const nextElapsed = (Math.floor(elapsed / stepMs) + 1) * stepMs;
  stepTimer = setTimeout(
    () => {
      nowTick.value = Date.now();
      scheduleNextStepReveal();
    },
    Math.max(0, nextElapsed - elapsed)
  );
}

function startTicking() {
  stopTicking();
  nowTick.value = Date.now();
  timer = setInterval(() => {
    nowTick.value = Date.now();
  }, 150);
  scheduleNextStepReveal();
}
function stopTicking() {
  if (timer) {
    clearInterval(timer);
    timer = undefined;
  }
  clearStepTimer();
}
function stopFlush() {
  if (flushTimer) {
    clearInterval(flushTimer);
    flushTimer = undefined;
  }
}

onMounted(() => {
  if (props.startedAt != null && !props.completing && !props.forceLastStage) {
    startTicking();
  }
});
watch(
  () => [props.startedAt, props.completing, props.forceLastStage] as const,
  ([started, completing, forceLast]) => {
    if (started != null && !completing && !forceLast) startTicking();
    else stopTicking();
  }
);
onBeforeUnmount(() => {
  stopTicking();
  stopFlush();
});

const elapsedMs = computed(() =>
  props.startedAt == null ? 0 : Math.max(0, nowTick.value - props.startedAt)
);

const timedShown = computed(() =>
  revealedStageCount(elapsedMs.value, config.value)
);

const shownCount = computed(() => {
  if (props.forceLastStage) return config.value.stageKeys.length;
  if (props.completing) {
    return Math.max(timedShown.value, flushShown.value);
  }
  return timedShown.value;
});

const allRevealed = computed(
  () => shownCount.value >= config.value.stageKeys.length
);

const visibleSteps = computed(() =>
  config.value.stageKeys.slice(0, shownCount.value).map((key) => ({
    key,
    label: t(key),
  }))
);

const currentStepIndex = computed(() => {
  if (props.forceLastStage || visibleSteps.value.length === 0) return -1;
  return visibleSteps.value.length - 1;
});

const widthPct = computed(() => {
  if (props.completing) return 100;
  return progressAt(elapsedMs.value, config.value.halfLifeMs);
});

const percentInt = computed(() => Math.round(widthPct.value));

const displayLabel = computed(() => {
  const stage = props.stageLabel?.trim();
  if (stage) return stage;
  const keys = config.value.stageKeys;
  const key = keys[Math.max(0, shownCount.value - 1)];
  return t(key ?? "chat.progress.processing");
});

const etaRange = computed(() => etaRangeFor(config.value));
const etaLabel = computed(() =>
  t(ETA_I18N_KEYS[etaRange.value.unit], {
    min: etaRange.value.min,
    max: etaRange.value.max,
  })
);

const valueText = computed(() =>
  t("chat.progress.valueText", { percent: percentInt.value })
);

function emitFlushedOnce() {
  if (flushed.value) return;
  flushed.value = true;
  emit("flushed");
}

function beginFlush() {
  flushShown.value = Math.max(flushShown.value, timedShown.value);
  if (allRevealed.value) {
    emitFlushedOnce();
    return;
  }
  stopFlush();
  flushTimer = setInterval(() => {
    flushShown.value = Math.min(
      config.value.stageKeys.length,
      flushShown.value + 1
    );
    if (flushShown.value >= config.value.stageKeys.length) {
      stopFlush();
      emitFlushedOnce();
    }
  }, COT_FLUSH_STEP_MS);
}

watch(
  () => [props.completing, props.forceLastStage] as const,
  ([completing, forceLast]) => {
    if (forceLast) {
      stopFlush();
      flushShown.value = config.value.stageKeys.length;
      emitFlushedOnce();
      return;
    }
    if (completing) beginFlush();
  },
  { immediate: true }
);
</script>

<style scoped>
.send-progress {
  display: flex;
  flex-direction: column;
  gap: var(--phy-space-8);
  min-width: 12.25rem;
  width: 100%;
}
.send-progress__meter {
  display: flex;
  flex-direction: column;
  gap: var(--phy-space-8);
}
.send-progress__meta {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: var(--phy-space-12);
}
.send-progress__copy {
  min-width: 0;
  flex: 1 1 auto;
}
.send-progress__label {
  display: block;
  overflow-wrap: anywhere;
  color: var(--phy-color-text);
  font-size: 0.8125rem;
  font-weight: 600;
  line-height: 1.4;
}
.send-progress__eta {
  display: block;
  margin-top: 2px;
  color: var(--phy-color-text-secondary);
  font-size: 0.75rem;
  line-height: 1.4;
}
.send-progress__percent {
  flex: none;
  color: var(--phy-color-text-muted);
  font-size: 0.6875rem;
  font-variant-numeric: tabular-nums;
}
.send-progress__track {
  width: 100%;
  height: 3px;
  background: color-mix(
    in srgb,
    var(--phy-color-brand-blue-soft) 70%,
    var(--phy-color-border-subtle)
  );
  border-radius: var(--phy-radius-pill);
  overflow: hidden;
}
.send-progress__fill {
  width: 100%;
  height: 100%;
  transform: scaleX(0);
  transform-origin: left center;
  background: var(--phy-color-brand-blue);
  border-radius: var(--phy-radius-pill);
  transition: transform var(--phy-motion-normal) ease-out;
}
.send-progress__cot {
  min-width: 0;
}
.send-progress__cot-toggle {
  cursor: pointer;
  color: var(--phy-color-text-secondary);
  font-size: 0.75rem;
  line-height: 1.4;
}
.send-progress__cot-count {
  margin-left: var(--phy-space-8);
  font-variant-numeric: tabular-nums;
}
.send-progress__cot-list {
  margin: var(--phy-space-8) 0 0;
  padding: 0;
  list-style: none;
}
.send-progress__cot-item {
  display: flex;
  align-items: flex-start;
  gap: var(--phy-space-8);
  color: var(--phy-color-text-secondary);
  font-size: 0.75rem;
  line-height: 1.45;
}
.send-progress__cot-marker {
  display: flex;
  flex: none;
  align-items: center;
  justify-content: center;
  width: 12px;
  min-height: 1.45em;
}
.send-progress__cot-spin {
  width: 11px;
  height: 11px;
  border: 1.5px solid
    color-mix(in srgb, var(--phy-color-brand-blue) 28%, transparent);
  border-top-color: var(--phy-color-brand-blue);
  border-radius: 50%;
  animation: send-progress-spin 0.7s linear infinite;
}
.send-progress__cot-index {
  flex: none;
  min-width: 1.35em;
  font-variant-numeric: tabular-nums;
}
.send-progress__cot-copy {
  min-width: 0;
}
.send-progress__cot-item[data-current="true"] {
  color: var(--phy-color-text);
  font-weight: 600;
}

@keyframes send-progress-spin {
  to {
    transform: rotate(360deg);
  }
}

@media (prefers-reduced-motion: reduce) {
  .send-progress__fill {
    transition: none;
  }
  .send-progress__cot-spin {
    animation: none;
  }
}
</style>
