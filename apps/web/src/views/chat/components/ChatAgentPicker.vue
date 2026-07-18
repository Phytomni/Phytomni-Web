<template>
  <div class="chat-agent-picker" data-testid="chat-agent-picker">
    <div
      v-if="rolesLoading"
      class="picker-status"
      data-testid="agent-picker-loading"
      role="status"
      aria-live="polite"
    >
      <span class="picker-status-dot" aria-hidden="true" />
      <span>{{ t("chat.agentPicker.loading") }}</span>
    </div>

    <div
      v-else-if="safeOptions.length === 0"
      class="picker-status"
      data-testid="agent-picker-empty"
      role="status"
      aria-live="polite"
    >
      <span class="picker-agent-mark" aria-hidden="true">@</span>
      <span>{{ t("chat.agentPicker.empty") }}</span>
    </div>

    <div v-else class="picker-combobox-wrap">
      <div
        class="picker-control"
        :class="{ 'is-open': open, 'has-selection': selectedAgent }"
        :data-testid="
          selectedAgent ? 'agent-picker-chip' : 'agent-picker-trigger'
        "
        @click="focusPicker"
      >
        <span class="picker-agent-mark" aria-hidden="true">@</span>
        <input
          ref="inputRef"
          type="text"
          role="combobox"
          class="picker-combobox"
          :value="inputValue"
          :placeholder="open ? t('chat.agentPicker.searchPlaceholder') : ''"
          :aria-label="t('chat.agentPicker.label')"
          :aria-expanded="open ? 'true' : 'false'"
          :aria-controls="listboxId"
          :aria-activedescendant="activeDescendant"
          :aria-disabled="disabled ? 'true' : 'false'"
          aria-autocomplete="list"
          autocomplete="off"
          spellcheck="false"
          :readonly="!open"
          :disabled="disabled"
          @focus="openList"
          @input="onInput"
          @click="openList"
          @keydown="onKeydown"
          @blur="onBlur"
        />
        <button
          v-if="selectedAgent"
          type="button"
          class="picker-clear"
          data-testid="agent-picker-clear"
          :aria-label="t('chat.agentPicker.remove', { agent: selectedLabel })"
          :disabled="disabled"
          @mousedown.prevent.stop
          @click.stop="clearSelection"
        >
          ×
        </button>
        <span v-else class="picker-chevron" aria-hidden="true" />
      </div>

      <div v-if="open" class="picker-popover">
        <ul
          :id="listboxId"
          role="listbox"
          class="picker-listbox"
          :aria-label="t('chat.agentPicker.label')"
        >
          <li
            v-for="(option, index) in filteredOptions"
            :id="optionId(index)"
            :key="option.tool"
            role="option"
            :aria-selected="option.tool === selectedAgent ? 'true' : 'false'"
            class="picker-option"
            :class="{ 'is-active': index === activeIndex }"
            @mousedown.prevent="selectOption(option)"
          >
            {{ option.label }}
          </li>
          <li
            v-if="filteredOptions.length === 0"
            class="picker-no-results"
            role="presentation"
          >
            {{ t("chat.agentPicker.noResults") }}
          </li>
        </ul>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useI18n } from "vue-i18n";

export type ChatAgentPickerOption = {
  tool: string;
  label: string;
  labelKey: string;
};

const props = withDefaults(
  defineProps<{
    options?: ChatAgentPickerOption[];
    rolesLoading: boolean;
    selectedAgent: string;
    disabled?: boolean;
  }>(),
  {
    options: () => [],
    disabled: false,
  }
);

const emit = defineEmits<{
  select: [command: string];
  clear: [];
}>();

const { t } = useI18n();

const listboxId = `agent-picker-listbox-${Math.random().toString(36).slice(2)}`;
const inputRef = ref<HTMLInputElement | null>(null);
const open = ref(false);
const query = ref("");
const activeIndex = ref(0);

const safeOptions = computed(() => props.options ?? []);
const permittedTools = computed(
  () => new Set(safeOptions.value.map((o) => o.tool))
);

const selectedLabel = computed(() => {
  const match = safeOptions.value.find((o) => o.tool === props.selectedAgent);
  return match?.label ?? props.selectedAgent;
});

const triggerLabel = computed(() =>
  props.selectedAgent ? selectedLabel.value : t("chat.agentPicker.auto")
);

const inputValue = computed(() =>
  open.value ? query.value : triggerLabel.value
);

const filteredOptions = computed(() => {
  const q = query.value.trim().toLowerCase();
  if (!q) return safeOptions.value;
  return safeOptions.value.filter(
    (option) =>
      option.label.toLowerCase().includes(q) ||
      option.tool.toLowerCase().includes(q)
  );
});

const optionId = (index: number) => `${listboxId}-agent-option-${index}`;

const activeDescendant = computed(() => {
  if (!open.value || filteredOptions.value.length === 0) return undefined;
  const clamped = Math.min(activeIndex.value, filteredOptions.value.length - 1);
  return optionId(clamped);
});

const closeList = () => {
  open.value = false;
  query.value = "";
};

watch(
  () => props.options,
  () => {
    activeIndex.value = 0;
    query.value = "";
  }
);

watch(filteredOptions, (options) => {
  if (activeIndex.value >= options.length) {
    activeIndex.value = Math.max(0, options.length - 1);
  }
});

watch(
  () => [props.disabled, props.rolesLoading, safeOptions.value.length] as const,
  ([disabled, loading, optionCount]) => {
    if (disabled || loading || optionCount === 0) closeList();
  }
);

const openList = () => {
  if (props.disabled || props.rolesLoading || safeOptions.value.length === 0) {
    return;
  }
  if (!open.value) {
    query.value = "";
    const selectedIndex = safeOptions.value.findIndex(
      (option) => option.tool === props.selectedAgent
    );
    activeIndex.value = selectedIndex >= 0 ? selectedIndex : 0;
  }
  open.value = true;
};

const focusPicker = () => {
  if (props.disabled) return;
  inputRef.value?.focus();
  openList();
};

const onInput = (event: Event) => {
  openList();
  query.value = (event.target as HTMLInputElement).value;
  activeIndex.value = 0;
};

const onBlur = () => {
  window.setTimeout(() => {
    closeList();
  }, 0);
};

const clearSelection = () => {
  if (props.disabled) return;
  emit("clear");
  closeList();
};

const trySelect = (command: string) => {
  const match = command.match(/@([^,]+),/);
  const tool = match?.[1] ?? "";
  if (!permittedTools.value.has(tool)) return false;
  emit("select", command);
  query.value = "";
  closeList();
  return true;
};

const selectOption = (option: ChatAgentPickerOption) => {
  if (props.disabled) return;
  trySelect(`@${option.tool},`);
};

const onKeydown = (event: KeyboardEvent) => {
  if (props.disabled) {
    event.preventDefault();
    return;
  }

  if (!open.value && ["ArrowDown", "ArrowUp", "Enter"].includes(event.key)) {
    event.preventDefault();
    openList();
    if (event.key === "ArrowUp") {
      activeIndex.value = Math.max(0, filteredOptions.value.length - 1);
    }
    return;
  }

  const options = filteredOptions.value;
  if (event.key === "ArrowDown") {
    event.preventDefault();
    if (options.length === 0) return;
    activeIndex.value = Math.min(activeIndex.value + 1, options.length - 1);
    return;
  }

  if (event.key === "ArrowUp") {
    event.preventDefault();
    if (options.length === 0) return;
    activeIndex.value = Math.max(activeIndex.value - 1, 0);
    return;
  }

  if (event.key === "Home") {
    event.preventDefault();
    activeIndex.value = 0;
    return;
  }

  if (event.key === "End") {
    event.preventDefault();
    activeIndex.value = Math.max(0, options.length - 1);
    return;
  }

  if (event.key === "Enter") {
    event.preventDefault();
    const option = options[activeIndex.value];
    if (option) selectOption(option);
    return;
  }

  if (event.key === "Escape") {
    event.preventDefault();
    closeList();
    inputRef.value?.focus();
  }
};

defineExpose({ trySelect });
</script>

<style scoped>
.chat-agent-picker {
  display: inline-flex;
  align-items: center;
  width: fit-content;
  max-width: 100%;
}

.picker-status {
  display: inline-flex;
  align-items: center;
  gap: var(--phy-space-8);
  min-height: var(--phy-control-height-compact);
  max-width: 100%;
  box-sizing: border-box;
  padding: var(--phy-space-4) var(--phy-space-12);
  border: 1px solid var(--phy-color-border-subtle);
  border-radius: var(--phy-radius-pill);
  background: var(--phy-color-fill-subtle);
  color: var(--phy-color-text-muted);
  font-size: 13px;
}

.picker-status-dot {
  width: 7px;
  height: 7px;
  flex: 0 0 auto;
  border-radius: var(--phy-radius-pill);
  background: var(--phy-color-primary);
  opacity: 0.75;
}

.picker-combobox-wrap {
  position: relative;
  display: inline-flex;
  width: min(196px, calc(100vw - var(--phy-space-32)));
  max-width: 100%;
}

.picker-control {
  display: flex;
  align-items: center;
  width: 100%;
  min-height: var(--phy-control-height-compact);
  box-sizing: border-box;
  padding: 0 var(--phy-space-8);
  border: 1px solid var(--phy-color-border-subtle);
  border-radius: var(--phy-radius-pill);
  background: var(--phy-color-fill-subtle);
  transition: border-color var(--phy-motion-fast) ease,
    background-color var(--phy-motion-fast) ease;
}

.picker-control:hover:not(.is-open) {
  border-color: var(--phy-color-border-control);
}

.picker-control.is-open {
  border-color: var(--phy-color-focus);
  background: var(--phy-color-bg-elevated);
}

.picker-control:focus-within {
  outline: 2px solid var(--phy-color-focus);
  outline-offset: 2px;
}

.picker-agent-mark {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  flex: 0 0 auto;
  border-radius: var(--phy-radius-pill);
  background: var(--phy-color-accent-soft);
  color: var(--phy-color-accent-text);
  font-size: 12px;
  font-weight: 700;
}

.picker-combobox {
  width: 100%;
  min-width: 0;
  height: calc(var(--phy-control-height-compact) - 2px);
  padding: 0 var(--phy-space-8);
  overflow: hidden;
  border: 0;
  background: transparent;
  color: var(--phy-color-text-secondary);
  font: inherit;
  font-size: 13px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.picker-combobox:focus-visible {
  outline: 2px solid var(--phy-color-focus);
  outline-offset: -2px;
  border-radius: var(--phy-radius-sm);
}

.picker-control.has-selection .picker-combobox {
  color: var(--phy-color-text);
  font-weight: 500;
}

.picker-combobox::placeholder {
  color: var(--phy-color-text-placeholder);
}

.picker-combobox[readonly] {
  cursor: pointer;
}

.picker-combobox:disabled {
  color: var(--phy-color-text-disabled);
  cursor: not-allowed;
}

.picker-clear {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  flex: 0 0 auto;
  padding: 0;
  border: 0;
  border-radius: var(--phy-radius-pill);
  background: transparent;
  color: var(--phy-color-text-muted);
  cursor: pointer;
  font-size: 16px;
  line-height: 1;
}

.picker-clear:hover {
  background: var(--phy-color-primary-soft);
  color: var(--phy-color-action-text);
}

.picker-clear:focus-visible {
  outline: 2px solid var(--phy-color-focus);
  outline-offset: -2px;
}

.picker-clear:disabled {
  cursor: not-allowed;
  opacity: 0.6;
}

.picker-chevron {
  width: 7px;
  height: 7px;
  flex: 0 0 auto;
  margin-inline: var(--phy-space-4);
  border-right: 1.5px solid var(--phy-color-text-muted);
  border-bottom: 1.5px solid var(--phy-color-text-muted);
  transform: translateY(-2px) rotate(45deg);
  transition: transform var(--phy-motion-fast) ease;
}

.picker-control.is-open .picker-chevron {
  transform: translateY(2px) rotate(225deg);
}

.picker-popover {
  position: absolute;
  inset-inline-start: 0;
  inset-block-end: calc(100% + var(--phy-space-8));
  z-index: 30;
  width: min(320px, calc(100vw - 24px));
  max-width: calc(100vw - 24px);
  box-sizing: border-box;
  border: 1px solid var(--phy-color-border-subtle);
  border-radius: var(--phy-radius-md);
  background: var(--phy-color-bg-elevated);
  box-shadow: var(--phy-shadow-soft);
}

.picker-listbox {
  margin: 0;
  padding: var(--phy-space-4);
  list-style: none;
  max-height: min(240px, 42vh);
  overflow-y: auto;
  overscroll-behavior: contain;
}

.picker-option {
  display: flex;
  align-items: center;
  min-height: var(--phy-control-height-default);
  box-sizing: border-box;
  padding: var(--phy-space-8) var(--phy-space-12);
  border-radius: var(--phy-radius-sm);
  color: var(--phy-color-text-secondary);
  cursor: pointer;
  font-size: 13px;
}

.picker-option.is-active,
.picker-option:hover {
  background: var(--phy-color-primary-soft);
  color: var(--phy-color-action-text);
}

.picker-no-results {
  padding: var(--phy-space-16) var(--phy-space-12);
  color: var(--phy-color-text-muted);
  font-size: 13px;
  text-align: center;
}

@media (max-width: 480px) {
  .picker-combobox-wrap {
    width: min(180px, calc(100vw - var(--phy-space-32)));
  }

  .picker-popover {
    width: min(320px, calc(100vw - 24px));
    max-width: calc(100vw - 24px);
  }
}

@media (prefers-reduced-motion: reduce) {
  .picker-control,
  .picker-chevron {
    transition: none;
  }
}
</style>
