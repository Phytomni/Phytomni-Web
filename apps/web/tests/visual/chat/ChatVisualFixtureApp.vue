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
      ref="fixtureRootRef"
      data-testid="chat-visual-root"
      :data-fixture-ready="fixtureReady ? 'true' : undefined"
      :data-chat-state="fixture.chatState"
      :data-history-state="historyStateAttr"
      :data-agent-preview="isAgentPreview ? 'true' : undefined"
      :data-compact-explore-open="compactExploreOpen ? 'true' : undefined"
      :data-sidebar-collapsed-preference="
        fixture.sidebarCollapsed ? 'true' : 'false'
      "
      :data-empty-scroll-position="
        fixture.key === 'empty-cases' ? 'cases' : 'top'
      "
      :data-sidebar-drawer-state="drawerStateAttr"
      :data-phase3c-kind="phase3cKindAttr"
      :data-upload-status="fixture.uploadStatus"
      :data-active-sidebar-item="activeSidebarItem"
      :data-chat-mode="fixtureChatMode"
      class="chat-visual-fixture-root"
    >
      <PhyAdaptiveShell
        :sidebar-collapsed="effectiveSidebarCollapsed"
        :artifact-open="false"
        :artifact-fullscreen="false"
        :main-inert="fixture.drawerOpen"
      >
        <template #sidebar>
          <PhyAdaptiveSidebar
            :collapsed="effectiveSidebarCollapsed"
            :drawer-open="fixture.drawerOpen"
            :off-canvas="fixture.offCanvas"
            :close-label="$t('common.close')"
            @close="onFixtureAction('sidebar-close')"
            @toggle="onFixtureAction('sidebar-toggle')"
          >
            <template #close>
              <el-icon aria-hidden="true">
                <Close />
              </el-icon>
            </template>
            <ChatSidebarNav
              :collapsed="effectiveSidebarCollapsed"
              :active-item="activeSidebarItem"
              :user-name="SYNTHETIC_IDENTITY"
              :can-explore-agents="true"
              :can-history="false"
              :can-profile="false"
              :can-cloud-storage="false"
              :can-user-management="false"
              :can-permission-management="false"
              :can-system-monitor="false"
              :can-global-config="false"
              :can-admin-management="false"
              :can-help="false"
              :show-agents-list="
                !effectiveSidebarCollapsed &&
                activeSidebarItem === 'explore-agent'
              "
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
            >
              <template #explore-agents>
                <div class="agent-list" data-testid="chat-explore-agents-list">
                  <div
                    v-for="agent in presetAgents"
                    :key="agent.id"
                    class="agent-option"
                  >
                    <AgentDisplayName :label="agent.name" />
                  </div>
                </div>
              </template>
            </ChatSidebarNav>
          </PhyAdaptiveSidebar>
        </template>

        <template #main>
          <div class="chat-main-layout">
            <div class="chat-main">
              <header class="chat-header">
                <div class="chat-header-inner">
                  <div class="header-leading">
                    <el-button
                      v-if="fixture.showSidebarTrigger"
                      class="mobile-sidebar-toggle is-visible"
                      data-testid="chat-sidebar-trigger"
                      text
                      circle
                      :aria-label="$t('chat.openNavigation')"
                      @click="onFixtureAction('sidebar-trigger')"
                    >
                      <el-icon><Menu /></el-icon>
                    </el-button>
                    <h2 class="chat-header-title">
                      {{
                        phase3cOverlay?.dialogueLabel ||
                        $t("chat.untitledConversation")
                      }}
                    </h2>
                  </div>
                  <div
                    class="header-controls"
                    data-testid="chat-header-preferences"
                  >
                    <LangSwitch />
                    <ThemeSwitch />
                  </div>
                </div>
              </header>

              <div
                class="chat-content-stack"
                data-testid="chat-content-stack"
                :class="{
                  'is-empty': fixture.chatState === 'empty',
                  'is-populated': fixture.chatState === 'populated',
                }"
              >
                <div
                  class="message-container"
                  data-testid="chat-transcript"
                  ref="transcriptRef"
                >
                  <div
                    v-if="fixture.chatState === 'empty' && !isHistoryFixture"
                    class="empty-chat"
                  >
                    <div
                      v-if="isAgentPreview"
                      class="chat-agent-preview-fixture"
                      data-testid="chat-agent-preview"
                    >
                      <!-- Uses the production agent-capability-popover path. -->
                      <AgentCapabilityPopover
                        :presentation="agentPreviewPresentation"
                        trigger-class="chat-agent-preview-trigger"
                        data-testid="chat-agent-preview-trigger"
                        aria-label="Synthetic Deep Genome Agent preview"
                      >
                        <AgentDisplayName
                          :label="t(agentPreviewPresentation.labelKey)"
                        />
                      </AgentCapabilityPopover>
                    </div>
                    <PhyEmptyState
                      data-testid="chat-welcome"
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

                  <div
                    v-if="historyState === 'loading'"
                    class="chat-history-state"
                    data-testid="chat-history-loading"
                    data-history-state="loading"
                    role="status"
                  >
                    <PhySkeleton shape="line" :count="4" />
                    <span class="sr-only">{{
                      $t("chat.history.loading")
                    }}</span>
                  </div>
                  <PhyEmptyState
                    v-else-if="historyState === 'empty'"
                    data-testid="chat-history-empty"
                    class="chat-history-state"
                    data-history-state="empty"
                    :title="$t('chat.history.emptyTitle')"
                    :subtitle="$t('chat.history.emptySubtitle')"
                  />
                  <div
                    v-else-if="historyState === 'error'"
                    class="chat-history-state phy-error-state"
                    data-testid="chat-history-error"
                    data-history-state="error"
                    role="alert"
                  >
                    <h2 class="phy-error-state__title">
                      {{ $t("chat.history.errorTitle") }}
                    </h2>
                    <p class="phy-error-state__description">
                      {{ $t("chat.history.errorSubtitle") }}
                    </p>
                    <button
                      type="button"
                      class="phy-error-state__retry"
                      data-testid="chat-history-retry"
                      @click="onFixtureAction('history-retry')"
                    >
                      {{ $t("chat.history.retry") }}
                    </button>
                  </div>

                  <span
                    v-if="historyState === 'title-only'"
                    class="sr-only"
                    data-testid="chat-history-title-only"
                    data-history-state="title-only"
                  >
                    {{ $t("chat.untitledConversation") }}
                  </span>

                  <div class="transcript-content">
                    <!-- Phase 3B: production row + content renderer, shared fixtures -->
                    <template v-if="isMessageContentFixture">
                      <ChatMessageRow
                        v-for="(message, index) in contentMessages"
                        :key="message.id || index"
                        :role="message.role === 'user' ? 'user' : 'assistant'"
                        :message-id="message.id"
                        :streaming="!!message.streaming"
                        :wide="
                          message.role === 'assistant' &&
                          message.tool_name === 'DeepGenomeAgent'
                        "
                      >
                        <ChatMessageContent
                          :message="message"
                          :index="index"
                          :is-last-message="
                            index === contentMessages.length - 1
                          "
                          :activity-expanded-by-message="activityExpandedMap"
                          :gene-network-images="geneNetworkImages"
                          :gene-network-images-loading="EMPTY_LOADING"
                          :digital-design-images="EMPTY_IMAGES"
                          :digital-design-images-loading="EMPTY_LOADING"
                        />
                      </ChatMessageRow>
                    </template>

                    <!-- Phase 3C content + overlay widgets (Activity / log / A2UI / parallel) -->
                    <template v-else-if="isStructuredContentFixture">
                      <ChatMessageRow
                        v-for="(message, index) in contentMessages"
                        :key="message.id || index"
                        :role="message.role === 'user' ? 'user' : 'assistant'"
                        :message-id="message.id"
                        :streaming="!!message.streaming"
                        :wide="
                          message.role === 'assistant' &&
                          message.tool_name === 'DeepGenomeAgent'
                        "
                      >
                        <ChatMessageContent
                          :message="message"
                          :index="index"
                          :is-last-message="
                            index === contentMessages.length - 1
                          "
                          :activity-expanded-by-message="activityExpandedMap"
                          :gene-network-images="EMPTY_IMAGES"
                          :gene-network-images-loading="EMPTY_LOADING"
                          :digital-design-images="EMPTY_IMAGES"
                          :digital-design-images-loading="EMPTY_LOADING"
                        />
                        <template
                          v-if="logOverlay && message.role === 'assistant'"
                          #activity
                        >
                          <ChatActivity
                            :state-key="'log:' + (logOverlay?.rowId || '')"
                            :expanded="logOverlayExpanded"
                            :label="$t('chat.log.activityLabel')"
                            :hide-count="true"
                            @update:expanded="onFixtureAction('log-expanded')"
                          >
                            <ChatAnalystLog
                              :row-id="logOverlay?.rowId"
                              :task-id="logOverlay?.taskId"
                              :log-data="logOverlay?.logData"
                              :loading="!!logOverlay?.loading"
                              :updating="!!logOverlay?.updating"
                              :error-kind="logOverlay?.errorKind"
                              @update="onFixtureAction('log-update')"
                              @retry="onFixtureAction('log-retry')"
                            />
                          </ChatActivity>
                        </template>
                      </ChatMessageRow>
                    </template>

                    <!-- Frame fixtures: simple synthetic text rows -->
                    <template v-else>
                      <ChatMessageRow
                        v-for="message in frameMessages"
                        :key="message.id"
                        :role="message.role === 'user' ? 'user' : 'assistant'"
                        :message-id="message.id"
                      >
                        <div
                          :class="[
                            'message-text',
                            message.role === 'user'
                              ? 'phy-bubble-user'
                              : 'phy-bubble-assistant',
                          ]"
                        >
                          {{ message.content }}
                        </div>
                      </ChatMessageRow>
                    </template>

                    <!-- Phase 3C progress / transfer overlays (mutually exclusive) -->
                    <ChatMessageRow
                      v-if="showProgressOverlay || showTransferOverlay"
                      role="assistant"
                      loading
                    >
                      <div
                        class="message-text loading-message phy-bubble-assistant"
                        data-testid="chat-fixture-progress-host"
                      >
                        {{ $t("chat.ladingInner") }}
                        <TransferProgress
                          v-if="transferSnapshot"
                          :snapshot="transferSnapshot"
                          @cancel="onFixtureAction('transfer-cancel')"
                        />
                        <SendProgress
                          v-else-if="progressProps"
                          :started-at="progressProps.startedAt"
                          :agent-name="progressProps.agentName"
                          :completing="progressProps.completing"
                        />
                      </div>
                    </ChatMessageRow>
                  </div>
                </div>

                <ChatComposer
                  :model-value="composerValue"
                  :is-sending="composerIsSending"
                  :chat-mode="fixtureChatMode"
                  :instant-mode-enabled="true"
                  :expert-mode-enabled="true"
                  :mode-usable="true"
                  :show-mode-selector="fixture.chatState === 'empty'"
                  :file-list="fileList"
                  :has-blocking-uploads="hasBlockingUploads"
                  :roles-loading="routingPermissionsLoading"
                  :has-messages="fixture.chatState === 'populated'"
                  :selected-agent="fixture.selectedAgent"
                  :picker-options="pickerOptions"
                  @update:model-value="composerValue = $event"
                  @update:chat-mode="fixtureChatMode = $event"
                  @submit="onFixtureAction('composer-submit')"
                  @stop="onFixtureAction('composer-stop')"
                  @select="onFixtureAction('composer-select')"
                  @search="onFixtureAction('composer-search')"
                  @command="onFixtureAction('composer-command')"
                  @file-change="onFixtureAction('composer-file-change')"
                  @remove-file="onFixtureAction('composer-remove-file')"
                  @clear-agent="onFixtureAction('composer-clear-agent')"
                  @toggle-agent="onFixtureAction('composer-toggle-agent')"
                />
                <div
                  v-if="fixture.chatState === 'empty' && !isHistoryFixture"
                  class="chat-cases-region"
                >
                  <ChatCases />
                </div>
              </div>
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
import {
  computed,
  nextTick,
  onMounted,
  onUnmounted,
  provide,
  ref,
  watch,
} from "vue";
import { useI18n } from "vue-i18n";
import en from "element-plus/es/locale/lang/en";
import zhCn from "element-plus/es/locale/lang/zh-cn";
import { Close, Menu } from "@element-plus/icons-vue";
import {
  PhyAdaptiveShell,
  PhyAdaptiveSidebar,
  PhyEmptyState,
} from "@/components/shell";
import PhySkeleton from "@/components/state/PhySkeleton.vue";
import {
  AgentCapabilityPopover,
  CANONICAL_AGENT_PRESENTATIONS,
} from "@/components/agent";
import AgentDisplayName from "@/components/AgentDisplayName.vue";
import ChatSidebarNav, {
  CHAT_SIDEBAR_DRAWER_OPEN_KEY,
} from "@/views/chat/components/ChatSidebarNav.vue";
import ChatComposer from "@/views/chat/components/ChatComposer.vue";
import ChatCases from "@/views/chat/components/ChatCases.vue";
import ChatMessageRow from "@/views/chat/components/ChatMessageRow.vue";
import ChatMessageContent from "@/views/chat/components/ChatMessageContent.vue";
import ChatActivity from "@/views/chat/components/ChatActivity.vue";
import ChatAnalystLog from "@/views/chat/components/ChatAnalystLog.vue";
import SendProgress from "@/views/chat/components/SendProgress.vue";
import TransferProgress from "@/components/TransferProgress.vue";
import LangSwitch from "@/components/LangSwitch.vue";
import ThemeSwitch from "@/components/ThemeSwitch.vue";
import { useAppStore } from "@/stores";
import type { ChatMessage } from "@/views/chat/types";
import {
  getChatRoutingFixture,
  type ChatVisualFixtureDefinition,
} from "./fixture-registry";
import {
  isPhase3BMessageKey,
  isPhase3CFixtureKey,
  FIXTURE_ACTIVITY_STATE_KEY,
  getPhase3COverlay,
  type Phase3CLogProps,
  type Phase3CProgressProps,
  type Phase3COverlaySpec,
} from "../../fixtures/chat";
import type { TransferSnapshot } from "@/utils/transfer-progress";
import {
  SYNTHETIC_IDENTITY,
  buildSyntheticFileList,
  buildSyntheticMessages,
  buildHarnessMessages,
  buildFixtureGeneNetworkImages,
  buildSyntheticPickerOptions,
  COMPOSER_MODEL_VALUE_BY_KEY,
  type SyntheticMessage,
} from "./fixture-data";
import { deriveCaseRouteOptions } from "@/constants/agents";
import { isA2uiLifecycleFixtureKey } from "./fixture-registry";

const EMPTY_IMAGES = {} as Record<string, string[]>;
const EMPTY_LOADING = {} as Record<string, boolean>;
const presetAgents = deriveCaseRouteOptions();
const agentPreviewPresentation = CANONICAL_AGENT_PRESENTATIONS.DeepGenomeAgent;

const props = defineProps<{
  fixture: ChatVisualFixtureDefinition | null;
  errorMessage: string | null;
}>();

const appStore = useAppStore();
const { t } = useI18n();
const epLocale = computed(() => (appStore.language === "zh-CN" ? zhCn : en));

const fixtureRootRef = ref<HTMLElement | null>(null);
const fixtureReady = ref(false);

const viewportWidth = ref(
  typeof window === "undefined" ? 1440 : window.innerWidth
);
const isMobileViewport = computed(() => viewportWidth.value < 900);

const historyState = computed(() => props.fixture?.historyState ?? null);
const historyStateAttr = computed(() => historyState.value ?? undefined);
const isHistoryFixture = computed(() => historyState.value !== null);
const isAgentPreview = computed(() => props.fixture?.agentPreview === true);
const compactExploreOpen = computed(
  () =>
    props.fixture?.compactExploreOpen === true &&
    !isMobileViewport.value &&
    viewportWidth.value < 1280
);

const fixture = computed(() => {
  if (!props.fixture) {
    throw new Error("ChatVisualFixtureApp: fixture missing in success branch");
  }
  if (
    !isMobileViewport.value ||
    props.fixture.key === "sidebar-mobile-closed" ||
    props.fixture.key === "sidebar-mobile-open"
  ) {
    return props.fixture;
  }
  return {
    ...props.fixture,
    drawerOpen: false,
    showSidebarTrigger: true,
    offCanvas: true,
  };
});
const effectiveSidebarCollapsed = computed(
  () => fixture.value.sidebarCollapsed && !compactExploreOpen.value
);
const drawerOpenRef = ref(props.fixture?.drawerOpen ?? false);
provide(CHAT_SIDEBAR_DRAWER_OPEN_KEY, drawerOpenRef);

watch(
  () => (props.fixture ? fixture.value.drawerOpen : false),
  (value) => {
    drawerOpenRef.value = value ?? false;
  }
);

const drawerStateAttr = computed(() => {
  if (!props.fixture) return undefined;
  if (props.fixture.key === "sidebar-mobile-closed") return "closed";
  if (props.fixture.key === "sidebar-mobile-open") return "open";
  if (isMobileViewport.value) return "closed";
  return "not-mobile";
});

const phase3cOverlay = computed((): Phase3COverlaySpec | null => {
  if (!props.fixture || !isPhase3CFixtureKey(props.fixture.key)) return null;
  return getPhase3COverlay(props.fixture.key);
});

const phase3cKindAttr = computed(() => phase3cOverlay.value?.kind ?? undefined);

const logOverlay = computed((): Phase3CLogProps | null => {
  const overlay = phase3cOverlay.value;
  if (!overlay || overlay.kind !== "log" || !overlay.log) return null;
  return overlay.log;
});

const logOverlayExpanded = computed(
  () => phase3cOverlay.value?.activityExpanded === true
);

const isMessageContentFixture = computed(
  () => !!props.fixture && isPhase3BMessageKey(props.fixture.key)
);

const isPhase3CContentFixture = computed(() => {
  const overlay = phase3cOverlay.value;
  if (!overlay) return false;
  return (
    overlay.kind === "activity" ||
    overlay.kind === "log" ||
    overlay.kind === "a2ui" ||
    overlay.kind === "parallel"
  );
});

const isA2uiLifecycleContentFixture = computed(
  () => !!props.fixture && isA2uiLifecycleFixtureKey(props.fixture.key)
);

const isStructuredContentFixture = computed(
  () => isPhase3CContentFixture.value || isA2uiLifecycleContentFixture.value
);

const contentMessages = computed((): ChatMessage[] => {
  if (!props.fixture) return [];
  if (
    isPhase3BMessageKey(props.fixture.key) ||
    isStructuredContentFixture.value
  ) {
    return buildHarnessMessages(props.fixture) as ChatMessage[];
  }
  return [];
});

const frameMessages = computed((): SyntheticMessage[] => {
  if (!props.fixture) return [];
  if (isPhase3BMessageKey(props.fixture.key) || isPhase3CContentFixture.value) {
    return [];
  }
  return buildSyntheticMessages(props.fixture);
});

const activityExpandedMap = computed((): Record<string, boolean> => {
  const overlay = phase3cOverlay.value;
  if (!overlay || overlay.kind !== "activity") return {};
  return {
    [FIXTURE_ACTIVITY_STATE_KEY]: overlay.activityExpanded === true,
  };
});

const showProgressOverlay = computed(
  () => phase3cOverlay.value?.kind === "progress"
);
const showTransferOverlay = computed(
  () => phase3cOverlay.value?.kind === "transfer"
);

const transferSnapshot = computed((): TransferSnapshot | null => {
  const overlay = phase3cOverlay.value;
  if (!overlay || overlay.kind !== "transfer" || !overlay.transfer) {
    return null;
  }
  return overlay.transfer;
});

const progressProps = computed((): Phase3CProgressProps | null => {
  const overlay = phase3cOverlay.value;
  if (!overlay || overlay.kind !== "progress" || !overlay.progress) {
    return null;
  }
  return overlay.progress;
});

const geneNetworkImages = computed(() =>
  props.fixture?.key === "image"
    ? buildFixtureGeneNetworkImages()
    : EMPTY_IMAGES
);

const fileList = computed(() =>
  props.fixture ? buildSyntheticFileList(props.fixture) : []
);
const hasBlockingUploads = computed(() =>
  fileList.value.some((item) => !["completed", "aborted"].includes(item.status))
);
const routingFixture = computed(() =>
  getChatRoutingFixture(props.fixture?.key)
);
const routingPermissionsLoading = computed(
  () => routingFixture.value?.permissionsLoading ?? false
);
const pickerOptions = computed(() => {
  const options = buildSyntheticPickerOptions((key) => t(key));
  const allowedTools = routingFixture.value?.allowedTools;
  return allowedTools
    ? options.filter((option) => allowedTools.includes(option.tool))
    : options;
});

const composerIsSending = computed(
  () =>
    fixture.value.isSending ||
    phase3cOverlay.value?.isSending === true ||
    phase3cOverlay.value?.kind === "send-stop"
);

const composerValue = ref(
  props.fixture ? (COMPOSER_MODEL_VALUE_BY_KEY[props.fixture.key] ?? "") : ""
);

const lastFixtureAction = ref("");
const transcriptRef = ref<HTMLElement | null>(null);
const activeSidebarItem = ref(
  props.fixture?.key === "sidebar-compact-explore-open"
    ? "explore-agent"
    : "new-chat"
);
const fixtureChatMode = ref<"instant" | "expert">(
  routingFixture.value?.mode ?? "instant"
);

watch(
  () => props.fixture?.key,
  (key) => {
    fixtureChatMode.value = getChatRoutingFixture(key)?.mode ?? "instant";
  }
);

const onFixtureAction = (name: string) => {
  lastFixtureAction.value = name;
  if (name === "new-chat") activeSidebarItem.value = "new-chat";
  if (name === "explore-agent") {
    activeSidebarItem.value = "explore-agent";
  }
  if (name === "gene-display") {
    activeSidebarItem.value = "knowledge-base";
  }
  if (name === "favorites") activeSidebarItem.value = "favorites";
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

async function openAgentPreviewFixture() {
  if (!isAgentPreview.value) return;
  await nextTick();
  const trigger = fixtureRootRef.value?.querySelector<HTMLElement>(
    '[data-testid="chat-agent-preview-trigger"]'
  );
  if (!trigger) return;
  trigger.focus();
  trigger.dispatchEvent(new FocusEvent("focus", { bubbles: true }));
}

async function markFixtureReady() {
  if (typeof document !== "undefined" && document.fonts?.ready) {
    await document.fonts.ready;
  }
  fixtureReady.value = true;
}

const updateViewportWidth = () => {
  viewportWidth.value = window.innerWidth;
};

onMounted(() => {
  updateViewportWidth();
  window.addEventListener("resize", updateViewportWidth);
  void applyPickerFixtureState();
  void openAgentPreviewFixture();
  void markFixtureReady();
});

onUnmounted(() => {
  window.removeEventListener("resize", updateViewportWidth);
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
  flex: 0 0 var(--phy-control-height-primary);
  min-height: var(--phy-control-height-primary);
  height: var(--phy-control-height-primary);
  padding: 0 clamp(var(--phy-space-16), 2vw, var(--phy-space-32));
  border-bottom: 1px solid var(--phy-color-border-subtle);
}

.chat-header-inner {
  width: 100%;
  height: 100%;
  margin: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--phy-space-8);
}

.header-leading,
.header-controls {
  display: flex;
  align-items: center;
  gap: var(--phy-space-8);
}

.header-leading {
  min-width: 0;
  flex: 1;
  overflow: hidden;
}

.header-controls {
  flex: 0 0 auto;
}

.chat-header-title {
  min-width: 0;
  margin: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
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
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  padding: 16px;
}

.chat-content-stack {
  flex: 1;
  min-height: 0;
  min-width: 0;
  display: flex;
  flex-direction: column;
  background: var(--phy-color-bg-page);
}

.chat-content-stack.is-empty {
  overflow-x: hidden;
  overflow-y: auto;
  scrollbar-gutter: stable;
}

.chat-content-stack.is-populated {
  overflow: hidden;
}

.chat-content-stack.is-empty .message-container {
  flex: 0 0 auto;
  min-height: clamp(196px, 34vh, 340px);
  overflow: visible;
  padding: clamp(var(--phy-space-16), 4vh, var(--phy-space-40))
    var(--phy-space-16) var(--phy-space-8);
}

.chat-content-stack.is-populated .message-container {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
}

.empty-chat {
  flex: 1;
  min-height: 0;
  width: min(100%, var(--phy-layout-transcript-max-width));
  margin: 0 auto;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  box-sizing: border-box;
  padding: var(--phy-space-16);
}

.chat-agent-preview-fixture {
  align-self: flex-start;
  min-width: 0;
  margin-bottom: var(--phy-space-12);
}

.chat-agent-preview-trigger {
  min-height: var(--phy-control-height-default);
  padding: var(--phy-space-8) var(--phy-space-12);
  border: 1px solid var(--phy-color-border-control);
  border-radius: var(--phy-radius-pill);
  background: var(--phy-color-bg-elevated);
  color: var(--phy-color-action-text);
  font: inherit;
  cursor: pointer;
}

.chat-agent-preview-trigger:focus-visible {
  outline: 2px solid var(--phy-color-focus);
  outline-offset: 2px;
}

.chat-history-state {
  width: min(100%, var(--phy-layout-transcript-max-width));
  box-sizing: border-box;
  margin: 0 auto;
  padding: var(--phy-space-24) var(--phy-space-16);
}

.chat-history-state.phy-error-state {
  align-items: flex-start;
  text-align: left;
}

.empty-chat-mark {
  width: 40px;
  height: 40px;
  object-fit: contain;
}

.transcript-content {
  width: min(100%, var(--phy-layout-transcript-max-width));
  margin: 0 auto;
}

.chat-cases-region {
  width: 100%;
  flex: 0 0 auto;
  margin-top: auto;
  padding-bottom: clamp(var(--phy-space-24), 4vh, var(--phy-space-48));
}

@media (min-width: 900px) {
  .chat-content-stack.is-empty {
    max-height: 840px;
    margin-block: auto;
  }
}

@media (min-width: 1920px) {
  .chat-content-stack.is-empty {
    max-height: 840px;
    margin-top: auto;
    margin-bottom: 0;
  }
}

@media (max-width: 600px) {
  .chat-header {
    padding: 0 var(--phy-space-8);
  }

  .header-controls {
    gap: var(--phy-space-4);
  }

  .chat-content-stack.is-empty .message-container {
    min-height: 180px;
    padding: var(--phy-space-16) var(--phy-space-8) var(--phy-space-4);
  }

  .chat-cases-region {
    padding-bottom: calc(
      var(--phy-space-24) + env(safe-area-inset-bottom, 0px)
    );
  }

  .empty-chat-mark {
    width: 36px;
    height: 36px;
  }
}

@media (min-width: 390px) and (max-width: 600px) {
  .chat-cases-region {
    padding-bottom: calc(
      var(--phy-space-48) + var(--phy-space-48) +
        env(safe-area-inset-bottom, 0px)
    );
  }
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
