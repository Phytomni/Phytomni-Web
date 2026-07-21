<template>
  <div
    class="chat-agent-quick-select"
    data-testid="chat-agent-quick-select"
    role="group"
    :aria-label="t('chat.agentPicker.label')"
    :aria-busy="rolesLoading"
  >
    <div v-if="rolesLoading" class="agent-quick-status" role="status">
      {{ t("chat.agentPicker.loading") }}
    </div>
    <div
      v-else-if="options.length === 0"
      class="agent-quick-status"
      role="status"
    >
      {{ t("chat.agentPicker.empty") }}
    </div>
    <div v-else class="agent-quick-list">
      <button
        v-for="option in options"
        :key="option.tool"
        type="button"
        class="chat-agent-quick-option"
        data-testid="chat-agent-quick-option"
        :class="{ 'is-selected': selectedAgent === option.tool }"
        :aria-pressed="selectedAgent === option.tool"
        :disabled="disabled"
        @click="emit('toggle', option.tool)"
      >
        {{ option.label }}
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useI18n } from "vue-i18n";
import type { ChatAgentPickerOption } from "./ChatAgentPicker.vue";

defineProps<{
  options: readonly ChatAgentPickerOption[];
  rolesLoading: boolean;
  selectedAgent: string;
  disabled: boolean;
}>();

const emit = defineEmits<{
  toggle: [tool: string];
}>();

const { t } = useI18n();
</script>

<style scoped>
.chat-agent-quick-select {
  min-width: 0;
  padding: var(--phy-space-8) var(--phy-space-4) 0;
}

.agent-quick-list {
  display: flex;
  flex-wrap: wrap;
  gap: var(--phy-space-8);
  min-width: 0;
}

.chat-agent-quick-option {
  min-height: var(--phy-control-height-compact);
  padding: var(--phy-space-4) var(--phy-space-12);
  border: 1px solid var(--phy-color-border-subtle);
  border-radius: var(--phy-radius-pill);
  background: var(--phy-color-bg-elevated);
  color: var(--phy-color-text-secondary);
  font: inherit;
  font-size: 0.8125rem;
  line-height: 1.3;
  cursor: pointer;
  transition: border-color var(--phy-motion-fast) var(--phy-motion-ease-out),
    background-color var(--phy-motion-fast) var(--phy-motion-ease-out),
    color var(--phy-motion-fast) var(--phy-motion-ease-out);
}

.chat-agent-quick-option:hover:not(:disabled) {
  border-color: var(--phy-color-border-control);
  background: var(--phy-color-fill-subtle);
  color: var(--phy-color-text);
}

.chat-agent-quick-option.is-selected {
  border-color: var(--phy-color-action-text);
  background: var(--phy-color-primary-soft);
  color: var(--phy-color-action-text);
}

.chat-agent-quick-option:focus-visible {
  outline: 2px solid var(--phy-color-focus);
  outline-offset: 2px;
}

.chat-agent-quick-option:disabled {
  cursor: not-allowed;
  opacity: 0.55;
}

.agent-quick-status {
  min-height: var(--phy-control-height-compact);
  display: flex;
  align-items: center;
  color: var(--phy-color-text-muted);
  font-size: 0.8125rem;
}

@media (max-width: 599px) {
  .agent-quick-list {
    flex-wrap: nowrap;
    overflow-x: auto;
    overscroll-behavior-inline: contain;
    padding: 2px 2px var(--phy-space-4);
    scrollbar-width: thin;
  }

  .chat-agent-quick-option {
    flex: 0 0 auto;
    min-height: var(--phy-control-height-primary);
  }
}
</style>
