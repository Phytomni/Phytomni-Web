<template>
  <div class="chat-activity">
    <!-- Missing presentation key: never hide content behind a disclosure. -->
    <template v-if="!stateKey">
      <div class="chat-activity__body chat-activity__body--forced">
        <slot>
          <template v-for="(block, i) in blocks" :key="i">
            <component
              :is="renderer(block.type)"
              v-if="renderer(block.type)"
              :block="block"
              :ns="ns"
              :reference-count="referenceCount"
              :streaming="streaming"
              :within-activity="block.type === 'reasoning'"
            />
          </template>
        </slot>
      </div>
    </template>
    <template v-else>
      <button
        type="button"
        class="chat-activity__toggle"
        :aria-expanded="expanded"
        :aria-controls="regionId"
        @click="onToggle"
      >
        <span class="chat-activity__label">{{ displayLabel }}</span>
        <span v-if="!hideCount" class="chat-activity__count">{{
          t("chat.activity.count", { count: blocks.length })
        }}</span>
        <span
          class="chat-activity__status"
          :class="isActive ? 'is-running' : 'is-done'"
          aria-live="polite"
        >
          {{ statusLabel }}
        </span>
        <span
          class="chat-activity__chevron"
          :class="{ 'is-expanded': expanded }"
          aria-hidden="true"
        ></span>
      </button>
      <div
        v-if="expanded"
        :id="regionId"
        class="chat-activity__body"
        role="region"
      >
        <slot>
          <template v-for="(block, i) in blocks" :key="i">
            <component
              :is="renderer(block.type)"
              v-if="renderer(block.type)"
              :block="block"
              :ns="ns"
              :reference-count="referenceCount"
              :streaming="streaming"
              :within-activity="block.type === 'reasoning'"
            />
          </template>
        </slot>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import type { ContentBlock } from "../types";
import type { AgentTaskLifecycle } from "@/api/types";
import { resolveBlockRenderer } from "../streaming/blockRegistry";
import { activityRegionDomId } from "../streaming/presentation";

const props = withDefaults(
  defineProps<{
    blocks?: ContentBlock[];
    /** When null/empty, render safe content expanded with no disclosure. */
    stateKey?: string | null;
    expanded?: boolean;
    streaming?: boolean;
    ns?: string;
    referenceCount?: number;
    /** Optional disclosure label override (e.g. analyst execution log). */
    label?: string;
    /** Hide the block-count chip (slot-driven bodies such as analyst logs). */
    hideCount?: boolean;
    /** Sanitized async-agent lifecycle, when this disclosure owns a task row. */
    lifecycle?: AgentTaskLifecycle;
  }>(),
  {
    blocks: () => [],
    stateKey: null,
    expanded: false,
    streaming: false,
    ns: "",
    referenceCount: 0,
    hideCount: false,
  }
);

const emit = defineEmits<{
  "update:expanded": [value: boolean];
}>();

const { t } = useI18n();

const regionId = computed(() =>
  props.stateKey ? activityRegionDomId(props.stateKey) : ""
);

const displayLabel = computed(() => props.label || t("chat.activity.label"));

const lifecycleStatusKey = computed(() =>
  props.lifecycle
    ? `chat.lifecycle.${props.lifecycle.phase.toLowerCase()}`
    : null
);
const statusLabel = computed(() =>
  lifecycleStatusKey.value
    ? t(lifecycleStatusKey.value)
    : props.streaming
      ? t("chat.activity.status.running")
      : t("chat.activity.status.done")
);
const isActive = computed(
  () =>
    props.lifecycle?.phase === "PREPARING" ||
    props.lifecycle?.phase === "RUNNING" ||
    props.streaming
);

const renderer = (type: string) => resolveBlockRenderer(type);

const onToggle = () => {
  emit("update:expanded", !props.expanded);
};
</script>

<style scoped lang="scss">
.chat-activity {
  margin: 5px 0 9px;
  max-width: min(100%, 42rem);
  min-width: 0;
}

.chat-activity__toggle {
  display: inline-flex;
  align-items: center;
  min-height: 28px;
  gap: 6px;
  padding: 3px 4px 3px 0;
  border: 0;
  background: transparent;
  color: var(--phy-color-text-muted);
  font: inherit;
  font-size: 12.5px;
  line-height: 1.35;
  cursor: pointer;
  text-align: left;

  &:hover {
    color: var(--phy-color-text-secondary);
  }

  &:focus-visible {
    outline: 2px solid var(--phy-color-focus);
    outline-offset: 2px;
    border-radius: var(--phy-radius-sm);
  }
}

.chat-activity__label {
  color: var(--phy-color-text-secondary);
  font-weight: 600;
}

.chat-activity__count {
  min-width: 18px;
  padding: 1px 5px;
  border-radius: var(--phy-radius-pill);
  background: color-mix(in srgb, var(--phy-color-bg-elevated) 58%, transparent);
  color: var(--phy-color-text-muted);
  font-size: 11px;
  line-height: 16px;
  text-align: center;
}

.chat-activity__status {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  color: var(--phy-color-text-muted);
  font-size: 11.5px;
  white-space: nowrap;

  &::before {
    width: 5px;
    height: 5px;
    border-radius: var(--phy-radius-pill);
    background: var(--phy-color-brand-blue);
    content: "";
    opacity: 0.62;
  }

  &.is-running::before {
    background: var(--phy-color-accent);
    opacity: 0.9;
  }
}

.chat-activity__chevron {
  width: 6px;
  height: 6px;
  margin-left: 1px;
  border-right: 1.5px solid currentColor;
  border-bottom: 1.5px solid currentColor;
  transform: rotate(45deg) translateY(-1px);
  transform-origin: center;
  transition: transform var(--phy-motion-fast) ease;

  &.is-expanded {
    transform: rotate(225deg) translate(-1px, -1px);
  }
}

.chat-activity__body {
  margin: 2px 0 0 3px;
  padding: 4px 0 2px 14px;
  border-left: 1px solid
    color-mix(
      in srgb,
      var(--phy-color-accent) 35%,
      var(--phy-color-brand-blue) 65%
    );
  min-width: 0;

  &--forced {
    margin-left: 0;
    padding-left: 0;
    border-left: 0;
  }

  :deep(.tool-block),
  :deep(.step-block),
  :deep(.reasoning-body) {
    position: relative;
    min-width: 0;
    color: var(--phy-color-text-secondary);
    font-size: 12.5px;
    line-height: 1.55;
  }

  :deep(.tool-block),
  :deep(.step-block) {
    display: flex;
    align-items: baseline;
    gap: 6px;
  }

  :deep(.tool-block)::before,
  :deep(.step-block)::before,
  :deep(.reasoning-body)::before {
    position: absolute;
    top: 7px;
    left: -17px;
    width: 5px;
    height: 5px;
    border: 1px solid var(--phy-color-bg-elevated);
    border-radius: var(--phy-radius-pill);
    background: var(--phy-color-accent);
    content: "";
  }

  :deep(.tool-count) {
    color: var(--phy-color-text-muted);
    font-size: 11px;
  }

  :deep(.reasoning-body) {
    margin-top: 2px;
  }

  :deep(.reasoning-body > :first-child) {
    margin-top: 0;
  }

  :deep(.reasoning-body > :last-child) {
    margin-bottom: 0;
  }
}

.chat-activity__body--forced :deep(.tool-block)::before,
.chat-activity__body--forced :deep(.step-block)::before,
.chat-activity__body--forced :deep(.reasoning-body)::before {
  display: none;
}

@media (prefers-reduced-motion: reduce) {
  .chat-activity__chevron {
    transition: none;
  }
}

@media (forced-colors: active) {
  .chat-activity__body {
    border-left-color: CanvasText;
  }
}
</style>
