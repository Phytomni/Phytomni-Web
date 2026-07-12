<template>
  <div class="chat-activity">
    <!-- Missing presentation key: never hide content behind a disclosure. -->
    <template v-if="!stateKey">
      <div class="chat-activity__body chat-activity__body--forced">
        <template v-for="(block, i) in blocks" :key="i">
          <component
            :is="renderer(block.type)"
            v-if="renderer(block.type)"
            :block="block"
            :ns="ns"
            :within-activity="block.type === 'reasoning'"
          />
        </template>
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
        <span class="chat-activity__label">{{ t("chat.activity.label") }}</span>
        <span class="chat-activity__count">{{
          t("chat.activity.count", { count: blocks.length })
        }}</span>
        <span class="chat-activity__status">{{ statusLabel }}</span>
      </button>
      <div
        v-if="expanded"
        :id="regionId"
        class="chat-activity__body"
        role="region"
      >
        <template v-for="(block, i) in blocks" :key="i">
          <component
            :is="renderer(block.type)"
            v-if="renderer(block.type)"
            :block="block"
            :ns="ns"
            :within-activity="block.type === 'reasoning'"
          />
        </template>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import type { ContentBlock } from "../types";
import { resolveBlockRenderer } from "../streaming/blockRegistry";
import { activityRegionDomId } from "../streaming/presentation";

const props = withDefaults(
  defineProps<{
    blocks: ContentBlock[];
    /** When null/empty, render safe content expanded with no disclosure. */
    stateKey?: string | null;
    expanded?: boolean;
    streaming?: boolean;
    ns?: string;
  }>(),
  {
    stateKey: null,
    expanded: false,
    streaming: false,
    ns: "",
  }
);

const emit = defineEmits<{
  "update:expanded": [value: boolean];
}>();

const { t } = useI18n();

const regionId = computed(() =>
  props.stateKey ? activityRegionDomId(props.stateKey) : ""
);

const statusLabel = computed(() =>
  props.streaming
    ? t("chat.activity.status.running")
    : t("chat.activity.status.done")
);

const renderer = (type: string) => resolveBlockRenderer(type);

const onToggle = () => {
  emit("update:expanded", !props.expanded);
};
</script>

<style scoped lang="scss">
.chat-activity {
  margin: 4px 0 8px;
  min-width: 0;
}

.chat-activity__toggle {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 4px 0;
  border: 0;
  background: transparent;
  color: var(--phy-color-text-muted, #6b7280);
  font: inherit;
  font-size: 13px;
  cursor: pointer;
  text-align: left;

  &:hover {
    color: var(--phy-color-text, #111827);
  }
}

.chat-activity__count {
  opacity: 0.85;
}

.chat-activity__body {
  margin-top: 6px;
  padding-left: 2px;
  min-width: 0;
}
</style>
