<template>
  <div class="chat-agent-picker" data-testid="chat-agent-picker">
    <div
      v-if="rolesLoading"
      class="picker-status"
      data-testid="agent-picker-loading"
    >
      {{ t("chat.agentPicker.loading") }}
    </div>

    <div
      v-else-if="safeOptions.length === 0"
      class="picker-status"
      data-testid="agent-picker-empty"
    >
      {{ t("chat.agentPicker.empty") }}
    </div>

    <template v-else>
      <div
        v-if="selectedAgent"
        class="picker-chip"
        data-testid="agent-picker-chip"
      >
        <span>{{ selectedLabel }}</span>
        <button
          type="button"
          class="picker-chip-remove"
          :aria-label="t('chat.agentPicker.remove', { agent: selectedLabel })"
          :disabled="disabled"
          @click="emit('clear')"
        >
          ×
        </button>
      </div>

      <div class="picker-combobox-wrap">
        <input
          ref="inputRef"
          type="text"
          role="combobox"
          class="picker-combobox"
          :value="query"
          :placeholder="t('chat.agentPicker.searchPlaceholder')"
          :aria-expanded="open ? 'true' : 'false'"
          :aria-controls="listboxId"
          :aria-activedescendant="activeDescendant"
          :aria-disabled="disabled ? 'true' : 'false'"
          :disabled="disabled"
          @input="onInput"
          @click="openList"
          @keydown="onKeydown"
          @blur="onBlur"
        />

        <ul
          v-if="open"
          :id="listboxId"
          role="listbox"
          class="picker-listbox"
        >
          <li
            v-for="(option, index) in filteredOptions"
            :id="`agent-option-${index}`"
            :key="option.tool"
            role="option"
            :aria-selected="index === activeIndex ? 'true' : 'false'"
            class="picker-option"
            :class="{ 'is-active': index === activeIndex }"
            @mousedown.prevent="selectOption(option)"
          >
            {{ option.label }}
          </li>
        </ul>
      </div>
    </template>
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

const filteredOptions = computed(() => {
  const q = query.value.trim().toLowerCase();
  if (!q) return safeOptions.value;
  return safeOptions.value.filter(
    (option) =>
      option.label.toLowerCase().includes(q) ||
      option.tool.toLowerCase().includes(q)
  );
});

const activeDescendant = computed(() => {
  if (!open.value || filteredOptions.value.length === 0) return undefined;
  const clamped = Math.min(activeIndex.value, filteredOptions.value.length - 1);
  return `agent-option-${clamped}`;
});

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

const openList = () => {
  if (props.disabled || props.rolesLoading || safeOptions.value.length === 0) {
    return;
  }
  open.value = true;
};

const closeList = () => {
  open.value = false;
};

const onInput = (event: Event) => {
  query.value = (event.target as HTMLInputElement).value;
  openList();
  activeIndex.value = 0;
};

const onBlur = () => {
  window.setTimeout(() => {
    closeList();
  }, 0);
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
    openList();
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
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  width: 100%;
  margin-bottom: 6px;
}

.picker-status {
  width: 100%;
  color: var(--phy-color-text-muted, #909399);
  font-size: 13px;
  padding: 4px 0;
}

.picker-chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 8px;
  border-radius: 999px;
  background: var(--phy-color-accent-soft, #e8f4f8);
  color: var(--phy-color-accent-text, #2b738f);
  font-size: 13px;
}

.picker-chip-remove {
  border: 0;
  background: transparent;
  color: inherit;
  cursor: pointer;
  font-size: 16px;
  line-height: 1;
  padding: 0 2px;
}

.picker-chip-remove:disabled {
  cursor: not-allowed;
  opacity: 0.6;
}

.picker-combobox-wrap {
  position: relative;
  flex: 1;
  min-width: 160px;
}

.picker-combobox {
  width: 100%;
  box-sizing: border-box;
  min-height: var(--phy-control-height-compact, 32px);
  padding: 4px 10px;
  border: 1px solid var(--phy-color-border, #d4d4d4);
  border-radius: 8px;
  font: inherit;
  font-size: 13px;
}

.picker-combobox:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.picker-listbox {
  position: absolute;
  left: 0;
  right: 0;
  top: calc(100% + 4px);
  margin: 0;
  padding: 4px 0;
  list-style: none;
  max-height: 200px;
  overflow-y: auto;
  background: #fff;
  border: 1px solid var(--phy-color-border, #d4d4d4);
  border-radius: 8px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.08);
  z-index: 20;
}

.picker-option {
  padding: 8px 12px;
  cursor: pointer;
  font-size: 13px;
}

.picker-option.is-active,
.picker-option:hover {
  background: var(--phy-color-fill-subtle, #f5f7fa);
}
</style>
