<template>
  <div class="transfer-progress" data-test="transfer-progress">
    <div class="transfer-progress__heading">
      <strong data-test="transfer-phase">{{ phaseLabel }}</strong>
      <span data-test="transfer-progress-text">{{ progressText }}</span>
    </div>
    <div class="transfer-progress__meta">
      <span data-test="transfer-size">
        {{
          snapshot.indeterminate
            ? formatBytes(snapshot.loaded)
            : `${formatBytes(snapshot.loaded)} / ${formatBytes(snapshot.total)}`
        }}
      </span>
      <span
        v-if="formatEta(snapshot.etaSec) != null"
        data-test="transfer-eta"
        class="transfer-progress__eta"
      >
        {{ $t("chat.transferEta", { seconds: formatEta(snapshot.etaSec) }) }}
      </span>
      <button
        type="button"
        class="transfer-progress__cancel"
        data-test="transfer-cancel"
        :aria-label="$t('chat.transferCancel')"
        @click="$emit('cancel', snapshot.requestId)"
      >
        {{ $t("chat.transferCancel") }}
      </button>
    </div>
    <div
      class="transfer-progress__bar"
      role="progressbar"
      :aria-label="phaseLabel"
      aria-valuemin="0"
      aria-valuemax="100"
      :aria-valuenow="snapshot.indeterminate ? undefined : snapshot.percent"
      :aria-valuetext="progressText"
    >
      <el-progress
        :percentage="snapshot.percent"
        :indeterminate="snapshot.indeterminate"
        :stroke-width="8"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import {
  formatBytes,
  formatEta,
  type TransferSnapshot,
} from "@/utils/transfer-progress";
import { computed } from "vue";
import { useI18n } from "vue-i18n";

const props = defineProps<{ snapshot: TransferSnapshot }>();
defineEmits<{ cancel: [requestId: string] }>();
const { t } = useI18n();

const phaseLabel = computed(() =>
  t(`chat.transferPhase.${props.snapshot.phase}`)
);

const progressText = computed(() => {
  const snapshot = props.snapshot;
  const loaded = formatBytes(snapshot.loaded);
  if (snapshot.indeterminate) {
    return t("chat.transferProgressIndeterminate", {
      phase: phaseLabel.value,
      loaded,
    });
  }
  return t("chat.transferProgressText", {
    phase: phaseLabel.value,
    loaded,
    total: formatBytes(snapshot.total),
    percent: snapshot.percent,
  });
});
</script>

<style scoped>
.transfer-progress {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-top: 8px;
}
.transfer-progress__heading {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: var(--phy-space-4) var(--phy-space-8);
  color: var(--phy-color-text-secondary);
  font-size: 0.8125rem;
  line-height: 1.4;
}
.transfer-progress__heading strong {
  color: var(--phy-color-text);
  font-weight: 650;
}
.transfer-progress__meta {
  display: flex;
  align-items: center;
  gap: var(--phy-space-12);
  font-size: 0.75rem;
  color: var(--phy-color-text-secondary);
}
.transfer-progress__bar {
  min-width: 0;
}
.transfer-progress__cancel {
  min-height: var(--phy-control-height-default);
  margin-left: auto;
  padding: 0 var(--phy-space-8);
  background: none;
  border: none;
  color: var(--phy-color-action-text);
  cursor: pointer;
  font: inherit;
  font-size: 0.75rem;
}
.transfer-progress__cancel:hover {
  color: var(--phy-color-action-text-hover);
  text-decoration: underline;
}
.transfer-progress__cancel:focus-visible {
  outline: 2px solid var(--phy-color-focus);
  outline-offset: 2px;
}
</style>
