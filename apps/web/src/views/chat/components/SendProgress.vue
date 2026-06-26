<template>
  <div class="send-progress">
    <div class="send-progress__meta">
      <span class="send-progress__eta">{{ $t(etaKey) }}</span>
      <span class="send-progress__elapsed">
        {{ $t("chat.elapsedPrefix") }} {{ elapsedLabel }}
      </span>
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
import { progressAt, progressConfigFor } from "../utils/agentProgress";

const props = defineProps<{
  startedAt: number | null;
  agentName: string;
  completing: boolean;
}>();

const config = computed(() => progressConfigFor(props.agentName));
const etaKey = computed(() => config.value.etaKey);

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

const elapsedLabel = computed(() => {
  const total = Math.floor(elapsedMs.value / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
});
</script>

<style scoped>
.send-progress {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-top: 8px;
}
.send-progress__meta {
  display: flex;
  justify-content: space-between;
  font-size: 12px;
  color: #909399;
}
.send-progress__track {
  width: 100%;
  height: 4px;
  background: #ebeef5;
  border-radius: 2px;
  overflow: hidden;
}
.send-progress__fill {
  height: 100%;
  background: #626aef;
  border-radius: 2px;
  transition: width 0.3s ease-out;
}
</style>
