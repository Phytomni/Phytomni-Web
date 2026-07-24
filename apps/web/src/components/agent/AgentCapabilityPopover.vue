<template>
  <span
    ref="rootRef"
    class="agent-capability-preview"
    @focusout="onFocusOut"
    @keydown="onKeydown"
  >
    <button
      ref="triggerRef"
      v-bind="attrs"
      type="button"
      :class="triggerClass"
      :disabled="disabled"
      :aria-label="t(presentation.labelKey)"
      :aria-expanded="open"
      :aria-controls="panelId"
      @click="select"
      @focus="show"
      @pointerenter="show"
      @pointerleave="scheduleClose"
    >
      <slot />
    </button>

    <section
      v-if="open"
      :id="panelId"
      class="agent-capability-popover"
      role="dialog"
      aria-modal="false"
      :aria-labelledby="headingId"
      @pointerenter="cancelScheduledClose"
      @pointerleave="scheduleClose"
    >
      <div class="agent-capability-popover__header">
        <h3 :id="headingId" class="agent-capability-popover__heading">
          {{ t(presentation.labelKey) }}
        </h3>
        <button
          type="button"
          class="agent-capability-popover__close"
          :aria-label="t('common.close')"
          @click="close({ restoreFocus: true })"
        >
          ×
        </button>
      </div>
      <p class="agent-capability-popover__description">
        {{ t(presentation.descriptionKey) }}
      </p>
      <div class="agent-capability-popover__media is-scrollable">
        <img
          :src="presentation.flowchartSrc"
          :alt="t(presentation.flowchartAltKey)"
        />
      </div>
    </section>
  </span>
</template>

<script lang="ts">
export default {
  name: "AgentCapabilityPopover",
  inheritAttrs: false,
};
</script>

<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, useAttrs } from "vue";
import { useI18n } from "vue-i18n";
import type { AgentPresentation } from "./index";

const props = defineProps<{
  presentation: AgentPresentation;
  disabled?: boolean;
  triggerClass?: string;
}>();

const emit = defineEmits<{
  select: [];
  close: [];
}>();

const { t } = useI18n();
const attrs = useAttrs();
const open = ref(false);
const rootRef = ref<HTMLElement | null>(null);
const triggerRef = ref<HTMLButtonElement | null>(null);
const instanceId = Math.random().toString(36).slice(2);
const panelId = `agent-capability-popover-${instanceId}`;
const headingId = `${panelId}-heading`;
let closeTimer: number | undefined;
let restoringFocus = false;

function show() {
  if (props.disabled || restoringFocus) return;
  cancelScheduledClose();
  open.value = true;
}

function close({ restoreFocus = false } = {}) {
  cancelScheduledClose();
  if (!open.value) return;
  open.value = false;
  emit("close");
  if (restoreFocus) {
    void nextTick(() => {
      restoringFocus = true;
      triggerRef.value?.focus();
      restoringFocus = false;
    });
  }
}

function scheduleClose() {
  cancelScheduledClose();
  closeTimer = window.setTimeout(() => close(), 120);
}

function cancelScheduledClose() {
  if (closeTimer === undefined) return;
  window.clearTimeout(closeTimer);
  closeTimer = undefined;
}

function select() {
  if (props.disabled) return;
  emit("select");
}

function onKeydown(event: KeyboardEvent) {
  if (event.key !== "Escape") return;
  event.preventDefault();
  close({ restoreFocus: true });
}

function onFocusOut(event: FocusEvent) {
  const nextTarget = event.relatedTarget;
  if (nextTarget && rootRef.value?.contains(nextTarget as Node)) return;
  scheduleClose();
}

function onDocumentPointerDown(event: PointerEvent) {
  if (event.target && rootRef.value?.contains(event.target as Node)) {
    return;
  }
  close();
}

onMounted(() => {
  document.addEventListener("pointerdown", onDocumentPointerDown);
});

onBeforeUnmount(() => {
  cancelScheduledClose();
  document.removeEventListener("pointerdown", onDocumentPointerDown);
});
</script>

<style scoped>
.agent-capability-preview {
  position: relative;
  display: inline-flex;
}

.agent-capability-popover {
  position: absolute;
  z-index: var(--phy-z-dropdown);
  top: calc(100% + var(--phy-space-8));
  left: 0;
  width: min(440px, calc(100vw - 32px));
  max-width: var(--phy-layout-agent-preview-max-width);
  max-height: min(720px, calc(100dvh - 32px));
  overflow: auto;
  padding: var(--phy-space-16);
  border: 1px solid var(--phy-color-border-subtle);
  border-radius: var(--phy-radius-lg);
  background: var(--phy-color-bg-elevated);
  box-shadow: var(--phy-shadow-soft);
}

.agent-capability-popover__header {
  display: flex;
  gap: var(--phy-space-8);
  align-items: flex-start;
  justify-content: space-between;
}

.agent-capability-popover__heading {
  margin: 0;
  color: var(--phy-color-text);
  font-size: 1rem;
  line-height: 1.4;
}

.agent-capability-popover__close {
  flex: 0 0 auto;
  min-width: var(--phy-control-height-compact);
  min-height: var(--phy-control-height-compact);
  border: 0;
  border-radius: var(--phy-radius-sm);
  background: transparent;
  color: var(--phy-color-text-secondary);
  font: inherit;
  font-size: 1.25rem;
  line-height: 1;
  cursor: pointer;
}

.agent-capability-popover__close:focus-visible {
  outline: 2px solid var(--phy-color-focus);
  outline-offset: 2px;
}

.agent-capability-popover__description {
  margin: var(--phy-space-8) 0 var(--phy-space-12);
  color: var(--phy-color-text-secondary);
  font-size: 0.875rem;
  line-height: 1.5;
}

.agent-capability-popover__media {
  max-height: var(--phy-layout-scientific-media-max-height);
  overflow: auto;
}

.agent-capability-popover__media img {
  display: block;
  width: 100%;
  height: auto;
  max-width: 100%;
}

@media (max-width: 599px) {
  .agent-capability-popover {
    position: fixed;
    top: auto;
    right: 0;
    bottom: 0;
    left: 0;
    width: 100%;
    max-width: none;
    max-height: min(78dvh, 720px);
    border-radius: var(--phy-radius-lg) var(--phy-radius-lg) 0 0;
  }
}
</style>
