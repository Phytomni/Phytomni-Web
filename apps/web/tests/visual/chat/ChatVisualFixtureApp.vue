<template>
  <el-config-provider :locale="epLocale">
    <div
      v-if="errorMessage"
      class="chat-visual-fixture-error"
      data-testid="chat-visual-error"
      role="alert"
    >
      {{ errorMessage }}
    </div>

    <div
      v-else
      data-testid="chat-visual-root"
      :data-chat-state="fixture.chatState"
      :data-sidebar-drawer-state="drawerStateAttr"
      class="chat-visual-fixture-root"
    >
      <PhyAdaptiveShell
        :sidebar-collapsed="fixture.sidebarCollapsed"
        :artifact-open="false"
        :artifact-fullscreen="false"
      >
        <template #sidebar>
          <PhyAdaptiveSidebar
            :collapsed="fixture.sidebarCollapsed"
            :drawer-open="fixture.drawerOpen"
            @close="onFixtureAction('sidebar-close')"
            @toggle="onFixtureAction('sidebar-toggle')"
          >
            <ChatSidebarNav
              :collapsed="fixture.sidebarCollapsed"
              active-item="new-chat"
              :user-name="SYNTHETIC_IDENTITY"
              :can-explore-agents="false"
              :can-history="false"
              :can-profile="false"
              :can-cloud-storage="false"
              :can-user-management="false"
              :can-permission-management="false"
              :can-system-monitor="false"
              :can-global-config="false"
              :can-admin-management="false"
              :can-help="false"
              :show-agents-list="false"
              :off-canvas="fixture.offCanvas"
              @new-chat="onFixtureAction('new-chat')"
              @gene-display="onFixtureAction('gene-display')"
              @favorites="onFixtureAction('favorites')"
              @tutorial="onFixtureAction('tutorial')"
              @explore-agent="onFixtureAction('explore-agent')"
              @account-command="onFixtureAction('account-command')"
              @toggle-collapse="onFixtureAction('toggle-collapse')"
              @show-architecture="onFixtureAction('show-architecture')"
              @help="onFixtureAction('help')"
            />
          </PhyAdaptiveSidebar>
        </template>

        <template #main>
          <div class="chat-main-layout">
            <div class="chat-main">
              <header class="chat-header">
                <div class="header-leading">
                  <el-button
                    v-if="fixture.showSidebarTrigger"
                    class="mobile-sidebar-toggle is-visible"
                    data-testid="chat-sidebar-trigger"
                    text
                    circle
                    :aria-label="$t('chat.newChat')"
                    @click="onFixtureAction('sidebar-trigger')"
                  >
                    <el-icon><Menu /></el-icon>
                  </el-button>
                  <h2 class="chat-header-title">
                    {{ $t("chat.untitledConversation") }}
                  </h2>
                </div>
              </header>

              <div
                class="message-container"
                data-testid="chat-transcript"
                ref="transcriptRef"
              >
                <div v-if="fixture.chatState === 'empty'" class="empty-chat">
                  <PhyEmptyState
                    :title="$t('chat.welcomeTitle')"
                    :subtitle="$t('chat.welcomeSubtitle')"
                  >
                    <template #mark>
                      <img
                        src="@/assets/images/chat/logo.png"
                        class="empty-chat-mark"
                        alt=""
                      />
                    </template>
                  </PhyEmptyState>
                </div>

                <div class="transcript-content">
                  <div
                    v-for="message in messages"
                    :key="message.id"
                    class="message"
                    :class="message.role"
                    data-testid="chat-message-row"
                  >
                    <div class="message-content">{{ message.content }}</div>
                  </div>
                </div>
              </div>

              <ChatComposer
                :model-value="composerValue"
                :is-sending="fixture.isSending"
                chat-mode="instant"
                :expert-mode-enabled="false"
                :show-mode-selector="fixture.chatState === 'empty'"
                :file-list="fileList"
                :roles-tool="SYNTHETIC_ROLES_TOOL"
                :roles-loading="false"
                :has-messages="fixture.chatState === 'populated'"
                :selected-agent="fixture.selectedAgent"
                :picker-options="pickerOptions"
                @update:model-value="composerValue = $event"
                @submit="onFixtureAction('composer-submit')"
                @stop="onFixtureAction('composer-stop')"
                @select="onFixtureAction('composer-select')"
                @search="onFixtureAction('composer-search')"
                @command="onFixtureAction('composer-command')"
                @file-change="onFixtureAction('composer-file-change')"
                @remove-file="onFixtureAction('composer-remove-file')"
                @clear-agent="onFixtureAction('composer-clear-agent')"
              />
            </div>
          </div>
        </template>
      </PhyAdaptiveShell>

      <div
        v-if="lastFixtureAction"
        class="fixture-action-log"
        data-testid="chat-fixture-action"
        aria-live="polite"
      >
        Fixture action: {{ lastFixtureAction }}
      </div>
    </div>
  </el-config-provider>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, provide, ref, watch } from "vue";
import en from "element-plus/es/locale/lang/en";
import zhCn from "element-plus/es/locale/lang/zh-cn";
import { Menu } from "@element-plus/icons-vue";
import {
  PhyAdaptiveShell,
  PhyAdaptiveSidebar,
  PhyEmptyState,
} from "@/components/shell";
import ChatSidebarNav, {
  CHAT_SIDEBAR_DRAWER_OPEN_KEY,
} from "@/views/chat/components/ChatSidebarNav.vue";
import ChatComposer from "@/views/chat/components/ChatComposer.vue";
import { useAppStore } from "@/stores";
import type { ChatVisualFixtureDefinition } from "./fixture-registry";
import {
  SYNTHETIC_IDENTITY,
  SYNTHETIC_ROLES_TOOL,
  buildSyntheticFileList,
  buildSyntheticMessages,
  buildSyntheticPickerOptions,
  COMPOSER_MODEL_VALUE_BY_KEY,
} from "./fixture-data";

const props = defineProps<{
  fixture: ChatVisualFixtureDefinition | null;
  errorMessage: string | null;
}>();

const appStore = useAppStore();
const epLocale = computed(() => (appStore.language === "zh-CN" ? zhCn : en));

const fixture = computed(() => {
  if (!props.fixture) {
    throw new Error("ChatVisualFixtureApp: fixture missing in success branch");
  }
  return props.fixture;
});
const drawerOpenRef = ref(props.fixture?.drawerOpen ?? false);
provide(CHAT_SIDEBAR_DRAWER_OPEN_KEY, drawerOpenRef);

watch(
  () => props.fixture?.drawerOpen,
  (value) => {
    drawerOpenRef.value = value ?? false;
  }
);

const drawerStateAttr = computed(() => {
  if (!props.fixture) return undefined;
  if (props.fixture.key === "sidebar-mobile-closed") return "closed";
  if (props.fixture.key === "sidebar-mobile-open") return "open";
  return undefined;
});

const messages = computed(() =>
  props.fixture ? buildSyntheticMessages(props.fixture) : []
);
const fileList = computed(() =>
  props.fixture ? buildSyntheticFileList(props.fixture) : []
);
const pickerOptions = buildSyntheticPickerOptions();

const composerValue = ref(
  props.fixture ? COMPOSER_MODEL_VALUE_BY_KEY[props.fixture.key] ?? "" : ""
);

const lastFixtureAction = ref("");
const transcriptRef = ref<HTMLElement | null>(null);

const onFixtureAction = (name: string) => {
  lastFixtureAction.value = name;
};

async function applyPickerFixtureState() {
  if (!props.fixture) return;
  if (!props.fixture.pickerOpen && !props.fixture.pickerSearchQuery) {
    return;
  }
  await nextTick();
  const input = document.querySelector(
    ".picker-combobox"
  ) as HTMLInputElement | null;
  if (!input) return;
  input.focus();
  input.click();
  if (props.fixture.pickerSearchQuery) {
    const nativeSet = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value"
    )?.set;
    nativeSet?.call(input, props.fixture.pickerSearchQuery);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  }
}

onMounted(() => {
  void applyPickerFixtureState();
});
</script>

<style scoped>
.chat-visual-fixture-root {
  width: 100%;
  height: 100%;
  min-height: 100vh;
}

.chat-visual-fixture-error {
  padding: 24px;
  font-family: var(--phy-font-shell, Inter, system-ui, sans-serif);
  color: #b42318;
  background: #fef3f2;
}

.chat-main-layout,
.chat-main {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  min-width: 0;
}

.chat-header {
  flex: 0 0 auto;
  padding: 8px 16px;
}

.header-leading {
  display: flex;
  align-items: center;
  gap: 8px;
}

.chat-header-title {
  margin: 0;
  font-size: 1rem;
  font-weight: 600;
}

.mobile-sidebar-toggle {
  display: none;
}

.mobile-sidebar-toggle.is-visible {
  display: inline-flex;
}

.message-container {
  flex: 1 1 auto;
  min-height: 0;
  overflow: auto;
  padding: 16px;
}

.transcript-content {
  max-width: var(--phy-layout-transcript-max-width, 760px);
  margin: 0 auto;
}

.message {
  margin-bottom: 12px;
  padding: 12px;
  border-radius: 8px;
  background: var(--phy-color-fill-subtle, #f5f7fa);
}

.message.user {
  background: var(--phy-color-brand-soft, #d6e6fe);
}

.empty-chat-mark {
  width: 48px;
  height: 48px;
}

.fixture-action-log {
  position: fixed;
  right: 8px;
  bottom: 8px;
  z-index: 20;
  padding: 4px 8px;
  font-size: 12px;
  color: var(--phy-color-text-secondary, #606266);
  background: transparent;
  pointer-events: none;
}
</style>
