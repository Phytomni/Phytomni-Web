<template>
  <div
    class="send-progress"
    data-test="send-progress"
    role="progressbar"
    :aria-valuemin="0"
    :aria-valuemax="100"
    :aria-valuenow="percentInt"
    :aria-valuetext="valueText"
  >
    <div class="send-progress__meta">
      <span
        class="send-progress__label"
        data-test="progress-label"
        aria-live="polite"
      >
        {{ displayLabel }}
      </span>
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
        :style="{ width: widthPct + '%' }"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { progressAt, progressConfigFor } from "../utils/agentProgress";

const props = defineProps<{
  startedAt: number | null;
  agentName: string;
  completing: boolean;
  /** Real event-derived stage copy only; never inferred from elapsed time. */
  stageLabel?: string;
}>();

const { t } = useI18n();
const config = computed(() => progressConfigFor(props.agentName));

const nowTick = ref(Date.now());
let timer: ReturnType<typeof setInterval> | undefined;

function startTicking() {
  stopTicking();
  timer = setInterval(() => {
    nowTick.value = Date.now();
  }, 150);
}
function stopTicking() {
  if (timer) {
    clearInterval(timer);
    timer = undefined;
  }
}

onMounted(() => {
  if (props.startedAt != null && !props.completing) startTicking();
});
watch(
  () => [props.startedAt, props.completing] as const,
  ([started, completing]) => {
    if (started != null && !completing) startTicking();
    else stopTicking();
  }
);
onBeforeUnmount(stopTicking);

const elapsedMs = computed(() =>
  props.startedAt == null ? 0 : Math.max(0, nowTick.value - props.startedAt)
);

const widthPct = computed(() => {
  if (props.completing) return 100;
  return progressAt(elapsedMs.value, config.value.halfLifeMs);
});

const percentInt = computed(() => Math.round(widthPct.value));

const displayLabel = computed(() => {
  const stage = props.stageLabel?.trim();
  if (stage) return stage;
  return t("chat.progress.processing");
});

const valueText = computed(() =>
  t("chat.progress.valueText", { percent: percentInt.value })
);
</script>

<style scoped>
.send-progress {
  display: flex;
  flex-direction: column;
  gap: 5px;
  margin-top: 9px;
}
.send-progress__meta {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
  font-size: 12px;
  line-height: 1.4;
}
.send-progress__label {
  min-width: 0;
  overflow-wrap: anywhere;
  color: var(--phy-color-text-secondary);
  font-weight: 600;
}
.send-progress__percent {
  flex: none;
  color: var(--phy-color-text-muted);
  font-size: 10.5px;
  font-variant-numeric: tabular-nums;
  letter-spacing: 0.02em;
  opacity: 0.72;
}
.send-progress__track {
  width: 100%;
  height: 3px;
  background: color-mix(
    in srgb,
    var(--phy-color-border-subtle) 76%,
    transparent
  );
  border-radius: var(--phy-radius-pill);
  overflow: hidden;
}
.send-progress__fill {
  height: 100%;
  background: linear-gradient(
    90deg,
    var(--phy-color-accent),
    var(--phy-color-primary)
  );
  border-radius: var(--phy-radius-pill);
  transition: width var(--phy-motion-normal) ease-out;
}

@media (prefers-reduced-motion: reduce) {
  .send-progress__fill {
    transition: none;
  }
}
</style>
