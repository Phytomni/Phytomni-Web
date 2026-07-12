<template>
  <div data-testid="chat-composer" class="chat-composer">
    <ChatModeSelector
      v-if="showModeSelector"
      :model-value="chatMode"
      :expert-enabled="expertModeEnabled"
      class="empty-chat-mode"
      @update:model-value="emit('update:chatMode', $event)"
    />
    <div
      :ref="bindTourInputTarget"
      class="chat-composer-surface"
    >
      <PhyComposerFrame>
        <ChatAgentPicker
          v-if="showAgentPicker"
          :options="pickerOptions"
          :roles-loading="rolesLoading"
          :selected-agent="selectedAgent"
          :disabled="isSending"
          @select="emit('command', $event)"
          @clear="emit('clear-agent')"
        />
        <div class="chat-composer-body">
          <div v-if="isSending" class="abort-button-overlay">
            <el-tooltip :content="t('chat.abortTooltip')" placement="top">
              <el-button
                round
                color="#f56c6c"
                :aria-label="t('chat.abortAriaLabel')"
                @click="emit('stop')"
              >
                <el-icon>
                  <Close />
                </el-icon>
              </el-button>
            </el-tooltip>
          </div>

          <MentionSender
            :model-value="modelValue"
            ref="senderRef"
            :loading="isSending"
            :disabled="isSending"
            variant="updown"
            :auto-size="{ minRows: 1, maxRows: 5 }"
            clearable
            allow-speech
            :placeholder="t('chat.inputPlaceholder', { symbol: '@' })"
            :options="rolesTool.map((x) => ({ value: x }))"
            :trigger-strings="['@']"
            trigger-split=","
            :whole="true"
            submit-type="enter"
            @update:model-value="emit('update:modelValue', $event)"
            @submit="emit('submit')"
            @select="emit('select', $event)"
            @search="emit('search', $event)"
            @keydown.enter.capture="onComposerEnterCapture"
          >
            <template #header>
              <div class="header-self-wrap">
                <div
                  v-if="fileList.length > 0 && !isSending"
                  class="file-list-container"
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
              </div>
            </template>

            <template #prefix>
              <div class="composer-prefix">
                <el-upload
                  ref="uploadRef"
                  class="upload-demo"
                  :limit="10"
                  accept=".pdf,.doc,.xlsx,.ppt,.txt,.png"
                  :show-file-list="false"
                  :auto-upload="false"
                  :disabled="isSending"
                  :on-change="(file) => emit('file-change', file)"
                  multiple
                  action="#"
                >
                  <template #trigger>
                    <el-tooltip :content="t('chat.uploadFile')" placement="top">
                      <el-button
                        round
                        plain
                        class="phy-btn-primary"
                        :aria-label="t('chat.uploadFile')"
                      >
                        <el-icon>
                          <Paperclip />
                        </el-icon>
                      </el-button>
                    </el-tooltip>
                  </template>
                </el-upload>
                <el-dropdown
                  v-if="hasMessages"
                  placement="top-start"
                  trigger="click"
                  :disabled="isSending"
                  @command="emit('command', $event)"
                >
                  <el-button round plain class="phy-btn-primary">
                    <el-icon>
                      <Menu />
                    </el-icon>
                  </el-button>
                  <template #dropdown>
                    <el-dropdown-menu v-if="rolesTool.length > 0">
                      <el-dropdown-item
                        v-for="(item, index) in rolesTool"
                        :key="index"
                        :command="'@' + item + ','"
                        >{{ item }}</el-dropdown-item
                      >
                    </el-dropdown-menu>
                  </template>
                </el-dropdown>
              </div>
            </template>

            <template #action-list>
              <div class="composer-actions">
                <div v-if="!modelValue.trim() || isSending" class="send-btn">
                  <el-tooltip
                    :content="t('chat.inputPlaceholderTip')"
                    placement="top"
                  >
                    <el-button round color="#cbcdcd" :aria-label="t('chat.sendAriaLabel')">
                      <el-icon>
                        <Promotion />
                      </el-icon>
                    </el-button>
                  </el-tooltip>
                </div>
                <div v-else class="send-btn" @click="emit('submit')">
                  <el-button round class="phy-btn-primary" :aria-label="t('chat.sendAriaLabel')">
                    <el-icon>
                      <Promotion />
                    </el-icon>
                  </el-button>
                </div>
              </div>
            </template>
          </MentionSender>
        </div>
      </PhyComposerFrame>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, unref } from "vue";
import type { VNodeRef } from "vue";
import { useI18n } from "vue-i18n";
import { MentionSender, FilesCard } from "vue-element-plus-x";
import ChatModeSelector from "@/components/ChatModeSelector.vue";
import ChatAgentPicker, {
  type ChatAgentPickerOption,
} from "./ChatAgentPicker.vue";
import { PhyComposerFrame } from "@/components/shell";
import {
  Close,
  Paperclip,
  Promotion,
  Menu,
} from "@element-plus/icons-vue";
import type { ChatComposerHandle, UploadFile } from "../types";
import { guardEnterSubmit } from "../utils/guardEnterSubmit";

const props = defineProps<{
  modelValue: string;
  isSending: boolean;
  chatMode: "instant" | "expert";
  expertModeEnabled: boolean;
  showModeSelector: boolean;
  fileList: UploadFile[];
  rolesTool: string[];
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
  select: [option: unknown];
  search: [query: string];
  command: [cmd: string];
  "file-change": [file: unknown];
  "remove-file": [index: number];
  "clear-agent": [];
}>();

const { t } = useI18n();
const senderRef = ref<{
  openHeader?: () => void;
  closeHeader?: () => void;
  popoverVisible?: boolean;
} | null>(null);
const uploadRef = ref();

const showAgentPicker = computed(() => props.chatMode === "instant");

const popoverVisible = computed(() =>
  unref(senderRef.value?.popoverVisible as boolean | undefined)
);

const onComposerEnterCapture = (e: KeyboardEvent) => {
  guardEnterSubmit(e, popoverVisible.value);
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

.empty-chat-mode {
  display: flex;
  justify-content: center;
  margin: 0 auto var(--phy-space-8);
}

.chat-composer-surface {
  position: relative;
  min-height: var(--phy-control-height-primary);
}

.chat-composer-body {
  position: relative;
  min-height: var(--phy-control-height-primary);
}

.composer-prefix,
.composer-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.header-self-wrap {
  padding: 3px 2px 2px 3px;
  box-sizing: border-box;
  width: 100%;
  display: flex;
  flex-direction: column;
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
.abort-btn {
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
}

.abort-button-overlay {
  position: absolute;
  top: -50px;
  right: 20px;
  z-index: 1000;
  pointer-events: auto;
}
</style>
