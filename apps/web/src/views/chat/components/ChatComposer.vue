<template>
  <div data-testid="chat-composer" class="chat-composer" @paste="onPaste">
    <div :ref="bindTourInputTarget" class="chat-composer-surface">
      <div class="phy-composer-frame">
        <div
          v-if="permissionUnavailable"
          class="composer-permission-status"
          data-testid="chat-permission-status"
          role="status"
        >
          {{ t("chat.agentPicker.noAvailableAgents") }}
        </div>
        <div
          v-if="fileList.length > 0 && !isSending"
          class="phy-composer-frame__attachments composer-attachments file-list-container"
        >
          <div class="file-list">
            <div
              v-for="(file, index) in fileList"
              :key="index"
              class="file-item"
            >
              <FilesCard
                :uid="index"
                :name="file.name"
                :file-size="file.size"
                :show-del-icon="true"
                @delete="emit('remove-file', index)"
              />
            </div>
          </div>
        </div>

        <div class="chat-composer-body">
          <MentionSender
            :model-value="modelValue"
            ref="senderRef"
            :loading="isSending"
            :disabled="composerDisabled"
            variant="updown"
            :auto-size="{ minRows: 1, maxRows: 5 }"
            :placeholder="t('chat.inputPlaceholder', { symbol: '@' })"
            :options="mentionOptions"
            :trigger-strings="mentionTriggers"
            trigger-split=","
            :whole="true"
            submit-type="enter"
            @update:model-value="emit('update:modelValue', $event)"
            @submit="emit('submit')"
            @select="emit('select', $event)"
            @search="emit('search', $event)"
            @keydown.enter.capture="onComposerEnterCapture"
          >
            <template #prefix />
            <template #action-list />
          </MentionSender>
        </div>

        <div class="phy-composer-frame__actions composer-toolbar">
          <div
            v-if="showModeSelector || showAgentPicker"
            class="composer-context-controls"
          >
            <ChatModeSelector
              v-if="showModeSelector"
              :model-value="chatMode"
              :instant-enabled="instantModeEnabled && !rolesLoading"
              :expert-enabled="expertModeEnabled && !rolesLoading"
              class="composer-mode-selector"
              @update:model-value="emit('update:chatMode', $event)"
            />
            <ChatAgentPicker
              v-if="showAgentPicker"
              :options="pickerOptions"
              :roles-loading="rolesLoading"
              :selected-agent="selectedAgent"
              :disabled="composerDisabled"
              @select="emit('command', $event)"
              @clear="emit('clear-agent')"
            />
          </div>

          <div class="composer-utility-actions">
            <el-upload
              ref="uploadRef"
              class="upload-demo"
              :limit="10"
              :accept="CHAT_ATTACHMENT_ACCEPT"
              :show-file-list="false"
              :auto-upload="false"
              :disabled="composerDisabled"
              :on-change="onUploadChange"
              :on-exceed="onUploadExceed"
              multiple
              action="#"
            >
              <template #trigger>
                <el-tooltip :content="t('chat.uploadFile')" placement="top">
                  <el-button
                    circle
                    class="composer-tool-button"
                    :disabled="composerDisabled"
                    :aria-label="t('chat.uploadFile')"
                  >
                    <el-icon><Paperclip /></el-icon>
                  </el-button>
                </el-tooltip>
              </template>
            </el-upload>
            <el-dropdown
              v-if="
                expertControlsEnabled && hasMessages && pickerOptions.length > 0
              "
              placement="top-start"
              trigger="click"
              :disabled="composerDisabled"
              @command="emit('command', $event)"
            >
              <el-button
                circle
                class="composer-tool-button"
                :disabled="composerDisabled"
                :aria-label="t('chat.agentPicker.label')"
              >
                <el-icon><Menu /></el-icon>
              </el-button>
              <template #dropdown>
                <el-dropdown-menu>
                  <el-dropdown-item
                    v-for="item in pickerOptions"
                    :key="item.tool"
                    :command="'@' + item.tool + ','"
                    ><AgentDisplayName :label="item.label"
                  /></el-dropdown-item>
                </el-dropdown-menu>
              </template>
            </el-dropdown>
          </div>

          <div class="composer-primary-action">
            <div v-if="isSending" class="stop-btn">
              <el-tooltip :content="t('chat.abortTooltip')" placement="top">
                <el-button
                  circle
                  class="composer-stop-button"
                  :aria-label="t('chat.abortAriaLabel')"
                  @click="emit('stop')"
                >
                  <span class="stop-glyph" aria-hidden="true" />
                </el-button>
              </el-tooltip>
            </div>
            <div v-else class="send-btn">
              <el-tooltip
                :content="
                  canSubmit
                    ? t('chat.sendAriaLabel')
                    : t('chat.inputPlaceholderTip')
                "
                placement="top"
              >
                <span class="composer-tooltip-anchor">
                  <el-button
                    circle
                    class="composer-send-button"
                    :class="{ 'phy-btn-primary': canSubmit }"
                    :disabled="!canSubmit"
                    :aria-label="t('chat.sendAriaLabel')"
                    @click="emit('submit')"
                  >
                    <el-icon><Promotion /></el-icon>
                  </el-button>
                </span>
              </el-tooltip>
            </div>
          </div>
        </div>
      </div>
      <ChatAgentQuickSelect
        v-if="showQuickSelect"
        :options="pickerOptions"
        :roles-loading="rolesLoading"
        :selected-agent="selectedAgent"
        :disabled="composerDisabled"
        @toggle="emit('toggle-agent', $event)"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, unref } from "vue";
import type { VNodeRef } from "vue";
import { useI18n } from "vue-i18n";
import { MentionSender, FilesCard } from "vue-element-plus-x";
import type { MentionOption } from "vue-element-plus-x/types/MentionSender";
import AgentDisplayName from "@/components/AgentDisplayName.vue";
import ChatModeSelector from "@/components/ChatModeSelector.vue";
import ChatAgentPicker, {
  type ChatAgentPickerOption,
} from "./ChatAgentPicker.vue";
import ChatAgentQuickSelect from "./ChatAgentQuickSelect.vue";
import { Paperclip, Promotion, Menu } from "@element-plus/icons-vue";
import type { ChatComposerHandle, UploadFile } from "../types";
import { guardEnterSubmit } from "../utils/guardEnterSubmit";
import { CHAT_ATTACHMENT_ACCEPT } from "../composables/useFileUpload";

const props = defineProps<{
  modelValue: string;
  isSending: boolean;
  chatMode: "instant" | "expert";
  instantModeEnabled: boolean;
  expertModeEnabled: boolean;
  modeUsable: boolean;
  showModeSelector: boolean;
  fileList: UploadFile[];
  rolesLoading: boolean;
  hasMessages: boolean;
  selectedAgent: string;
  pickerOptions: ChatAgentPickerOption[];
  setTourInputTarget?: (el: HTMLElement | null) => void;
}>();

const emit = defineEmits<{
  "update:modelValue": [value: string];
  "update:chatMode": [mode: "instant" | "expert"];
  submit: [];
  stop: [];
  select: [option: MentionOption];
  search: [query: string];
  command: [cmd: string];
  "file-change": [file: unknown];
  "paste-files": [files: File[]];
  "remove-file": [index: number];
  "clear-agent": [];
  "toggle-agent": [tool: string];
}>();

const { t } = useI18n();
const senderRef = ref<{
  openHeader?: () => void;
  closeHeader?: () => void;
  popoverVisible?: boolean;
} | null>(null);
const uploadRef = ref();

const expertControlsEnabled = computed(
  () => props.chatMode === "expert" && props.modeUsable && !props.rolesLoading
);
const mentionOptions = computed(() =>
  expertControlsEnabled.value
    ? props.pickerOptions.map((option) => ({ value: option.tool }))
    : []
);
const mentionTriggers = computed(() =>
  expertControlsEnabled.value ? ["@"] : []
);
const composerDisabled = computed(
  () => props.isSending || props.rolesLoading || !props.modeUsable
);
const permissionUnavailable = computed(
  () => !props.rolesLoading && !props.modeUsable
);
const showAgentPicker = computed(
  () => expertControlsEnabled.value && !props.hasMessages
);
const showQuickSelect = computed(
  () => !props.hasMessages && expertControlsEnabled.value
);
const canSubmit = computed(
  () => Boolean(props.modelValue.trim()) && !composerDisabled.value
);

const popoverVisible = computed(() =>
  unref(senderRef.value?.popoverVisible as boolean | undefined)
);

const onComposerEnterCapture = (e: KeyboardEvent) => {
  guardEnterSubmit(e, popoverVisible.value);
};

const onPaste = (event: ClipboardEvent) => {
  if (composerDisabled.value) return;
  const files = Array.from(event.clipboardData?.files ?? []);
  if (files.length === 0) return;
  event.preventDefault();
  emit("paste-files", files);
};

const onUploadExceed = (files: File[]) => {
  if (composerDisabled.value) return;
  emit("paste-files", Array.from(files));
};

const onUploadChange = (file: unknown) => {
  if (composerDisabled.value) return;
  emit("file-change", file);
};

const bindTourInputTarget: VNodeRef = (ref) => {
  const el = (ref as Element | null) ?? null;
  props.setTourInputTarget?.(el as HTMLElement | null);
};

defineExpose<ChatComposerHandle>({
  openHeader: () => senderRef.value?.openHeader?.(),
  closeHeader: () => senderRef.value?.closeHeader?.(),
  get popoverVisible() {
    return popoverVisible.value;
  },
});
</script>

<style scoped>
.chat-composer {
  width: min(100%, var(--phy-layout-transcript-max-width));
  margin: 0 auto;
  box-sizing: border-box;
  padding: var(--phy-space-8) var(--phy-space-16)
    calc(var(--phy-space-8) + env(safe-area-inset-bottom, 0px));
}

.chat-composer-surface {
  position: relative;
  min-height: var(--phy-control-height-primary);
}

.composer-permission-status {
  padding: var(--phy-space-8) var(--phy-space-12) 0;
  color: var(--phy-color-text-muted);
  font-size: 0.8125rem;
  line-height: 1.4;
}

.phy-composer-frame {
  border: 1px solid var(--phy-color-border);
  border-radius: var(--phy-radius-lg);
  background: var(--phy-color-bg-elevated);
  box-shadow: var(--phy-shadow-soft);
  padding: 10px 12px;
  transition:
    border-color var(--phy-motion-fast) var(--phy-motion-ease-out),
    box-shadow var(--phy-motion-fast) var(--phy-motion-ease-out);
}

.phy-composer-frame:focus-within {
  border-color: var(--phy-color-focus);
  box-shadow:
    var(--phy-shadow-soft),
    0 0 0 2px var(--phy-color-focus);
}

.phy-composer-frame__attachments {
  margin-bottom: 8px;
}

.phy-composer-frame__actions {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 8px;
}

.chat-composer-body {
  position: relative;
  min-height: var(--phy-control-height-primary);
}

.chat-composer-body :deep(.el-sender) {
  border: 0;
  background: transparent;
  box-shadow: none;
}

.chat-composer-body :deep(.el-sender-content) {
  padding: var(--phy-space-4) var(--phy-space-4) 0;
}

.chat-composer-body :deep(.el-sender-updown-wrap) {
  display: none !important;
}

.chat-composer .chat-composer-body :deep(.el-textarea__inner) {
  min-height: 40px;
  margin-bottom: 0 !important;
  padding: var(--phy-space-8) var(--phy-space-4);
  background-color: transparent !important;
  color: var(--phy-color-text);
  box-shadow: none;
  line-height: 1.5;
}

.composer-toolbar {
  width: 100%;
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto auto;
  align-items: center;
  gap: var(--phy-space-8);
}

.composer-context-controls,
.composer-utility-actions,
.composer-primary-action {
  display: flex;
  align-items: center;
  gap: var(--phy-space-8);
}

.composer-context-controls {
  min-width: 0;
  flex-wrap: wrap;
}

.composer-utility-actions {
  gap: var(--phy-space-4);
}

.composer-tooltip-anchor {
  display: inline-flex;
}

.composer-tool-button,
.composer-send-button,
.composer-stop-button {
  width: 34px;
  height: 34px;
  min-height: 34px;
  padding: 0;
  border-radius: var(--phy-radius-pill);
}

.composer-tool-button {
  --el-button-bg-color: var(--phy-color-fill-subtle);
  --el-button-border-color: var(--phy-color-fill-subtle);
  --el-button-text-color: var(--phy-color-text-secondary);
  --el-button-hover-bg-color: var(--phy-color-primary-soft);
  --el-button-hover-border-color: var(--phy-color-primary-soft);
  --el-button-hover-text-color: var(--phy-color-action-text);
}

.composer-send-button:disabled {
  --el-button-disabled-bg-color: var(--phy-color-fill-subtle);
  --el-button-disabled-border-color: var(--phy-color-fill-subtle);
  --el-button-disabled-text-color: var(--phy-color-text-disabled);
}

.composer-stop-button {
  --el-button-bg-color: var(--phy-color-text);
  --el-button-border-color: var(--phy-color-text);
  --el-button-text-color: var(--phy-color-bg-elevated);
  --el-button-hover-bg-color: var(--phy-color-text-secondary);
  --el-button-hover-border-color: var(--phy-color-text-secondary);
  --el-button-hover-text-color: var(--phy-color-bg-elevated);
}

.stop-glyph {
  width: 10px;
  height: 10px;
  border-radius: 2px;
  background: currentColor;
}

.file-list-container .file-list {
  display: flex;
  flex-direction: row;
  gap: 3px;
  flex-wrap: wrap;
  padding: 4px;
}

.file-list-container .file-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 0 4px;
  font-size: 12px;
}

.send-btn,
.stop-btn {
  display: flex;
  align-items: center;
  justify-content: center;
}

@media (max-width: 600px) {
  .composer-toolbar {
    grid-template-columns: minmax(0, 1fr) auto;
  }

  .composer-context-controls {
    grid-column: 1 / -1;
  }

  .composer-context-controls :deep(.picker-combobox-wrap) {
    width: min(168px, calc(100vw - var(--phy-space-32)));
  }
}
</style>
