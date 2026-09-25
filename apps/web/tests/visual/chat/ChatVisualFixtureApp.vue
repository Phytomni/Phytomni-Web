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
      :data-agent-lifecycle-state="agentLifecycleStateAttr"
      :data-upload-status="fixture.uploadStatus"
      :data-attachment-fixture="fixture.key"
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
                          :src="'/logo.png'"
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
                          :gene-network-images="geneNetworkImages"
                          :gene-network-images-loading="EMPTY_LOADING"
                          :digital-design-images="EMPTY_IMAGES"
                          :digital-design-images-loading="EMPTY_LOADING"
                          :lifecycle="
                            agentLifecycleOverlay?.lifecycle ??
                            waitCotPollable?.lifecycle
                          "
                          :progress-started-at="waitCotProgressStartedAt"
                          :artifact-preview="
                            agentLifecycleOverlay?.artifactPreview
                          "
                        />
                        <ResultArchiveDelivery
                          v-if="agentLifecycleOverlay?.delivery"
                          :delivery="agentLifecycleOverlay.delivery"
                          :artifacts="agentLifecycleOverlay.artifactLinks"
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
                            :lifecycle="agentLifecycleOverlay?.lifecycle"
                            @update:expanded="onFixtureAction('log-expanded')"
                          >
                            <ChatAnalystLog
                              :row-id="logOverlay?.rowId"
                              :log-data="logOverlay?.logData"
                              :loading="!!logOverlay?.loading"
                              :error-kind="logOverlay?.errorKind"
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
                      :loading="showTransferOverlay || !progressRun?.terminal"
                    >
                      <div
                        class="message-text loading-message phy-bubble-assistant"
                        data-testid="chat-fixture-progress-host"
                      >
                        <template
                          v-if="showTransferOverlay || !progressRun?.terminal"
                        >
                          {{ $t("chat.ladingInner") }}
                        </template>
                        <TransferProgress
                          v-if="transferSnapshot"
                          :snapshot="transferSnapshot"
                          @cancel="onFixtureAction('transfer-cancel')"
                        />
                        <ExecutionActivityPanel
                          v-else-if="progressRun"
                          :run="progressRun"
                          :expanded="true"
                          @open-target="onFixtureExecutionTarget"
                        />
                        <ExecutionRail
                          v-if="progressRun"
                          class="fixture-execution-rail"
                          :run="progressRun"
                          @cancel="onFixtureAction('execution-cancel')"
                          @open-target="onFixtureAction('execution-target')"
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
                  :attachment-target-available="attachmentTargetAvailable"
                  :attachment-target-blocked="attachmentTargetBlocked"
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
                  @paste-files="onFixtureAction('composer-paste-files')"
                  @remove-file="onFixtureAction('composer-remove-file')"
                  @pause-upload="onFixtureAction('composer-pause-upload')"
                  @resume-upload="onFixtureAction('composer-resume-upload')"
                  @retry-upload="onFixtureAction('composer-retry-upload')"
                  @reselect-upload="onFixtureAction('composer-reselect-upload')"
                  @cancel-upload="onFixtureAction('composer-cancel-upload')"
                  @remove-upload="onFixtureAction('composer-remove-upload')"
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
import ResultArchiveDelivery from "@/components/research/ResultArchiveDelivery.vue";
import ExecutionActivityPanel from "@/views/chat/components/ExecutionActivityPanel.vue";
import ExecutionRail from "@/views/chat/components/ExecutionRail.vue";
import TransferProgress from "@/components/TransferProgress.vue";
import LangSwitch from "@/components/LangSwitch.vue";
import ThemeSwitch from "@/components/ThemeSwitch.vue";
import { useAppStore } from "@/stores";
import type { ChatMessage } from "@/views/chat/types";
import {
  getChatRoutingFixture,
  isAgentLifecycleVisualFixtureKey,
  type ChatVisualFixtureDefinition,
} from "./fixture-registry";
import {
  isWaitCotPollableKey,
  isWaitCotSendingKey,
  waitCotProgressProps,
  waitCotStartedAt,
  WAIT_COT_POLLABLE,
} from "./wait-cot-fixtures";
import {
  isPhase3BMessageKey,
  isPhase3CFixtureKey,
  FIXTURE_ACTIVITY_STATE_KEY,
  getPhase3COverlay,
  type Phase3CLogProps,
  type Phase3COverlaySpec,
} from "../../fixtures/chat";
import type { TransferSnapshot } from "@/utils/transfer-progress";
import {
  createExecutionRunState,
  type ExecutionEvent,
  type ExecutionOperationRecord,
  type ExecutionRunState,
  type ExecutionTarget,
} from "@/views/chat/streaming/executionEvents";
import {
  SYNTHETIC_IDENTITY,
  buildSyntheticFileList,
  buildSyntheticMessages,
  buildHarnessMessages,
  buildFixtureGeneNetworkImages,
  buildSyntheticPickerOptions,
  COMPOSER_MODEL_VALUE_BY_KEY,
  getAgentLifecycleVisualData,
  type AgentLifecycleVisualData,
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

const agentLifecycleOverlay = computed((): AgentLifecycleVisualData | null => {
  if (!props.fixture || !isAgentLifecycleVisualFixtureKey(props.fixture.key)) {
    return null;
  }
  return getAgentLifecycleVisualData(props.fixture.key);
});
const agentLifecycleStateAttr = computed(
  () =>
    (props.fixture &&
      isAgentLifecycleVisualFixtureKey(props.fixture.key) &&
      props.fixture.key) ||
    undefined
);

const logOverlay = computed((): Phase3CLogProps | null => {
  const lifecycleLog = agentLifecycleOverlay.value?.log;
  if (lifecycleLog) {
    return {
      rowId: lifecycleLog.rowId,
      logData: lifecycleLog.data,
    };
  }
  const overlay = phase3cOverlay.value;
  if (!overlay || overlay.kind !== "log" || !overlay.log) return null;
  return overlay.log;
});

const logOverlayExpanded = computed(
  () =>
    agentLifecycleOverlay.value?.log !== undefined ||
    phase3cOverlay.value?.activityExpanded === true
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

const waitCotPollable = computed(() => {
  const key = props.fixture?.key;
  if (!isWaitCotPollableKey(key)) return null;
  return WAIT_COT_POLLABLE[key];
});
const waitCotProgressStartedAt = computed(() => {
  const key = props.fixture?.key;
  if (!isWaitCotPollableKey(key)) return null;
  return waitCotStartedAt(key, Date.now());
});
const waitCotSendingProgress = computed((): Phase3CProgressProps | null => {
  const key = props.fixture?.key;
  if (!isWaitCotSendingKey(key)) return null;
  return waitCotProgressProps(key, Date.now());
});

const isStructuredContentFixture = computed(
  () =>
    isPhase3CContentFixture.value ||
    isA2uiLifecycleContentFixture.value ||
    agentLifecycleOverlay.value !== null ||
    waitCotPollable.value !== null
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
  () =>
    phase3cOverlay.value?.kind === "progress" ||
    waitCotSendingProgress.value !== null
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

const FIXTURE_OPERATION_LABELS: Readonly<
  Record<string, { labelKey: string; fallbackLabel: string }>
> = {
  "artifact.package": {
    labelKey: "execution.operation.artifact.package",
    fallbackLabel: "Package results",
  },
  "data.query": {
    labelKey: "execution.operation.data.query",
    fallbackLabel: "Query data",
  },
  "knowledge.search": {
    labelKey: "execution.operation.knowledge.search",
    fallbackLabel: "Search knowledge",
  },
  "remote.analysis": {
    labelKey: "execution.operation.remote.analysis",
    fallbackLabel: "Run analysis",
  },
  "remote.reconcile": {
    labelKey: "execution.operation.remote.reconcile",
    fallbackLabel: "Collect analysis",
  },
  "remote.submit": {
    labelKey: "execution.operation.remote.submit",
    fallbackLabel: "Submit analysis",
  },
  "review.citation_check": {
    labelKey: "execution.operation.review.citationCheck",
    fallbackLabel: "Check citations",
  },
  "review.draft_dimension": {
    labelKey: "execution.operation.review.draftDimension",
    fallbackLabel: "Draft section",
  },
  "review.final_synthesis": {
    labelKey: "execution.operation.review.finalSynthesis",
    fallbackLabel: "Synthesize report",
  },
  "review.retrieve_dimension": {
    labelKey: "execution.operation.review.retrieveDimension",
    fallbackLabel: "Retrieve evidence",
  },
};

function fixtureSecondsAgo(seconds: number): string {
  return new Date(Date.now() - seconds * 1_000).toISOString();
}

function buildFixtureOperation(
  operationKey: string,
  index: number,
  status: ExecutionOperationRecord["status"],
  overrides: Partial<ExecutionOperationRecord> = {}
): ExecutionOperationRecord {
  const labels = FIXTURE_OPERATION_LABELS[operationKey] ?? {
    labelKey: "execution.operation.generic",
    fallbackLabel: "Internal operation",
  };
  const startedAt = fixtureSecondsAgo(64 - index * 4);
  const terminal = !["queued", "running", "retrying"].includes(status);
  const lastObservationAt = terminal
    ? fixtureSecondsAgo(62 - index * 4)
    : fixtureSecondsAgo(12);
  const attemptStatus: ExecutionOperationRecord["attempts"][number]["status"] =
    status === "retrying" || status === "queued"
      ? "running"
      : status === "partial"
        ? "succeeded"
        : status;
  return {
    schemaVersion: 1,
    operationId: `fixture-operation-${index}`,
    workUnitId: `fixture-work-unit-${index}`,
    operationKey,
    labelKey: labels.labelKey,
    fallbackLabel: labels.fallbackLabel,
    status,
    startedAt,
    lastObservationAt,
    completedAt: terminal ? lastObservationAt : null,
    durationMs: terminal ? 2_000 : 12_000,
    currentAttempt: 1,
    attempts:
      status === "queued"
        ? []
        : [
            {
              attempt: 1,
              status: attemptStatus,
              startedAt,
              completedAt: terminal ? lastObservationAt : null,
              durationMs: terminal ? 2_000 : 12_000,
              failure: null,
              retry: null,
            },
          ],
    progress: null,
    detail: {},
    summary: null,
    target: null,
    ...overrides,
  };
}

function buildFixtureEvent(
  executionId: string,
  seq: number,
  kind: string,
  secondsAgo: number,
  overrides: Partial<ExecutionEvent> = {}
): ExecutionEvent {
  return {
    schemaVersion: 2,
    eventId: `${executionId}-event-${seq}`,
    executionId,
    runId: executionId,
    seq,
    occurredAt: fixtureSecondsAgo(secondsAgo),
    kind,
    known: true,
    ignorable: false,
    status: "succeeded",
    summary: { key: kind, text: kind },
    payload: {},
    ...overrides,
  };
}

const progressRun = computed((): ExecutionRunState | null => {
  const overlay = phase3cOverlay.value;
  if (!overlay || overlay.kind !== "progress" || !overlay.progress) {
    return null;
  }
  const executionId = `turn-fixture-${props.fixture?.key ?? "progress"}`;
  const run = createExecutionRunState(executionId, 2);
  const occurredAt = new Date(
    overlay.progress.startedAt ?? Date.now()
  ).toISOString();
  const completed = overlay.progress.completing;
  run.status = completed ? "succeeded" : "running";
  run.delivery = "connected";
  run.startedAt = occurredAt;
  run.lastActivityAt = occurredAt;
  run.latestSeq = 1;
  run.events = [
    {
      schemaVersion: 2,
      eventId: `${executionId}-event-1`,
      executionId,
      runId: executionId,
      seq: 1,
      occurredAt,
      kind: completed ? "phase.completed" : "phase.started",
      known: true,
      ignorable: false,
      status: completed ? "succeeded" : "running",
      summary: {
        key: completed ? "phase.completed" : "phase.started",
        text: completed ? "Response completed" : "Retrieving evidence",
      },
      payload: { phase: "research" },
    },
  ];
  if (completed) {
    run.terminal = { status: "succeeded", eventId: `${executionId}-event-1` };
  }

  const fixtureKey = props.fixture?.key;
  if (fixtureKey?.startsWith("execution-")) {
    run.startedAt = fixtureSecondsAgo(60);
    run.lastActivityAt = fixtureSecondsAgo(12);
    run.lastContactAt = fixtureSecondsAgo(3);
    run.events = [];
  }
  if (fixtureKey === "execution-long-running") {
    run.operations = [
      buildFixtureOperation("review.retrieve_dimension", 1, "succeeded", {
        progress: { completed: 8, total: 8, unit: "dimensions" },
        detail: { ordinal: 8, total: 8 },
      }),
      buildFixtureOperation("review.draft_dimension", 2, "succeeded", {
        progress: { completed: 8, total: 8, unit: "dimensions" },
        detail: { ordinal: 8, total: 8 },
      }),
      buildFixtureOperation("review.citation_check", 3, "running", {
        progress: { completed: 37, total: 64, unit: "batches" },
        detail: { ordinal: 37, total: 64 },
        summary: {
          kind: "decision",
          text: "Checking cited evidence before final synthesis.",
        },
      }),
      buildFixtureOperation("knowledge.search", 4, "succeeded", {
        progress: { completed: 4, total: 4, unit: "repositories" },
        detail: { repository_count: 4, result_count: 126 },
      }),
      buildFixtureOperation("data.query", 5, "succeeded", {
        progress: { completed: 2400, total: 2400, unit: "rows" },
        detail: { result_count: 2400 },
      }),
      buildFixtureOperation("remote.submit", 6, "succeeded", {
        detail: { provider_state: "accepted" },
      }),
      buildFixtureOperation("remote.analysis", 7, "running", {
        detail: { provider_state: "running" },
      }),
      buildFixtureOperation("remote.reconcile", 8, "queued"),
      buildFixtureOperation("review.final_synthesis", 9, "queued"),
      buildFixtureOperation("artifact.package", 10, "queued"),
    ];
    run.executionStage = {
      stage: "scientific_execution",
      childStatus: "running",
      rootStatus: "running",
      answerAvailable: false,
      todos: [
        { id: "planning", status: "completed" },
        { id: "analysis", status: "in_progress" },
        { id: "consolidation", status: "pending" },
        { id: "response", status: "pending" },
      ],
      pendingStatusKey: "execution.pending.running",
      clocks: {
        lastExecutionFactAt: fixtureSecondsAgo(12),
        lastProviderContactAt: fixtureSecondsAgo(8),
        lastStreamContactAt: fixtureSecondsAgo(3),
      },
    };
  } else if (fixtureKey === "execution-retrying") {
    run.status = "retry_scheduled";
    run.operations = [
      buildFixtureOperation("knowledge.search", 1, "retrying", {
        currentAttempt: 2,
        attempts: [
          {
            attempt: 1,
            status: "failed",
            startedAt: fixtureSecondsAgo(28),
            completedAt: fixtureSecondsAgo(25.5),
            durationMs: 2_500,
            failure: { code: "PROVIDER_BUSY", retryable: true },
            retry: { delayMs: 1_500 },
          },
          {
            attempt: 2,
            status: "running",
            startedAt: fixtureSecondsAgo(24),
            completedAt: null,
            durationMs: 9_000,
            failure: null,
            retry: null,
          },
        ],
        detail: { repository_count: 3, result_count: 18 },
      }),
    ];
    run.executionStage = {
      stage: "scientific_execution",
      childStatus: "running",
      rootStatus: "running",
      answerAvailable: false,
      todos: [
        { id: "planning", status: "completed" },
        { id: "analysis", status: "in_progress" },
        { id: "consolidation", status: "pending" },
        { id: "response", status: "pending" },
      ],
      pendingStatusKey: "execution.pending.running",
      clocks: {
        lastExecutionFactAt: fixtureSecondsAgo(24),
        lastProviderContactAt: fixtureSecondsAgo(20),
        lastStreamContactAt: fixtureSecondsAgo(16),
      },
    };
  } else if (fixtureKey === "execution-cancelled") {
    run.status = "cancelled";
    run.operations = [buildFixtureOperation("data.query", 1, "cancelled")];
    run.terminal = { status: "cancelled", eventId: `${executionId}-event-1` };
    run.executionStage = {
      stage: "scientific_execution",
      childStatus: "cancelled",
      rootStatus: "cancelled",
      answerAvailable: false,
      todos: [
        { id: "planning", status: "completed" },
        { id: "analysis", status: "skipped" },
        { id: "consolidation", status: "skipped" },
        { id: "response", status: "skipped" },
      ],
      pendingStatusKey: null,
      clocks: {
        lastExecutionFactAt: fixtureSecondsAgo(22),
        lastProviderContactAt: fixtureSecondsAgo(23),
        lastStreamContactAt: fixtureSecondsAgo(21),
      },
    };
  } else if (fixtureKey === "execution-succeeded") {
    const succeededKeys = [
      "remote.submit",
      "remote.analysis",
      "remote.reconcile",
      "review.final_synthesis",
      "artifact.package",
    ];
    run.operations = succeededKeys.map((key, index) =>
      buildFixtureOperation(key, index + 1, "succeeded", {
        detail:
          key === "artifact.package"
            ? { artifact_count: 2 }
            : key.startsWith("remote.")
              ? { provider_state: "succeeded" }
              : {},
      })
    );
    run.events = [
      buildFixtureEvent(executionId, 1, "execution.started", 66, {
        status: "running",
      }),
      buildFixtureEvent(executionId, 2, "todo.snapshot", 62, {
        payload: {
          items: [
            { id: "search", label_key: "todo.search", status: "pending" },
          ],
        },
        target: { kind: "todo", id: "fixture-todo-initial" },
      }),
      buildFixtureEvent(executionId, 3, "message.snapshot", 58),
      buildFixtureEvent(executionId, 4, "reasoning.summary", 46, {
        summary: {
          key: "reasoning.summary",
          text: "Evidence was checked before final synthesis.",
        },
        payload: { text: "Evidence was checked before final synthesis." },
      }),
      buildFixtureEvent(executionId, 5, "todo.snapshot", 8, {
        payload: {
          items: [
            { id: "search", label_key: "todo.search", status: "completed" },
            { id: "report", label_key: "todo.report", status: "completed" },
          ],
        },
        target: { kind: "todo", id: "fixture-todo-latest" },
      }),
      buildFixtureEvent(executionId, 6, "message.completed", 5),
    ];
    run.latestSeq = 6;
    run.outputText = "The network analysis and archive are ready.";
    run.results = [
      {
        eventId: `${executionId}-result-1`,
        name: "network-results.zip",
        mediaType: "application/zip",
        sizeBytes: 16_384,
        target: { kind: "artifact", id: "fixture-network-results" },
      },
      {
        eventId: `${executionId}-result-2`,
        name: "execution-log.json",
        mediaType: "application/json",
        sizeBytes: 4_096,
        target: { kind: "artifact", id: "fixture-execution-log" },
      },
    ];
    run.executionStage = {
      stage: "response_settlement",
      childStatus: "succeeded",
      rootStatus: "succeeded",
      answerAvailable: true,
      todos: [
        { id: "planning", status: "completed" },
        { id: "analysis", status: "completed" },
        { id: "consolidation", status: "completed" },
        { id: "response", status: "completed" },
      ],
      pendingStatusKey: null,
      clocks: {
        lastExecutionFactAt: fixtureSecondsAgo(6),
        lastProviderContactAt: fixtureSecondsAgo(9),
        lastStreamContactAt: fixtureSecondsAgo(5),
      },
    };
  }
  return run;
});

const geneNetworkImages = computed(
  () =>
    agentLifecycleOverlay.value?.geneNetworkImages ??
    (props.fixture?.key === "image"
      ? buildFixtureGeneNetworkImages()
      : EMPTY_IMAGES)
);

const fileList = computed(() =>
  props.fixture ? buildSyntheticFileList(props.fixture) : []
);
const hasBlockingUploads = computed(() =>
  fileList.value.some((item) => !["completed", "aborted"].includes(item.status))
);
const attachmentTargetAvailable = computed(
  () => fixture.value.attachmentTargetAvailable ?? true
);
const attachmentTargetBlocked = computed(
  () => fixture.value.attachmentTargetBlocked ?? false
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

const onFixtureExecutionTarget = (target: ExecutionTarget) => {
  lastFixtureAction.value = `execution-target:${target.kind}:${target.id}`;
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

async function openAttachmentDetailsFixture() {
  if (!props.fixture?.attachmentDetailOpen) return;
  await nextTick();
  const chip = fixtureRootRef.value?.querySelector<HTMLElement>(
    '[data-testid="attachment-chip"]'
  );
  chip?.click();
  await nextTick();
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

onMounted(async () => {
  updateViewportWidth();
  window.addEventListener("resize", updateViewportWidth);
  await applyPickerFixtureState();
  await openAgentPreviewFixture();
  await openAttachmentDetailsFixture();
  await markFixtureReady();
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

.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}

.loading-message {
  display: block;
  width: min(28rem, 100%);
  background-color: var(--phy-bubble-assistant-bg);
  padding: 0;
  border-radius: var(--phy-radius-lg);
}

.loading-message :deep(.send-progress) {
  width: 100%;
  background: transparent;
  border-color: transparent;
  box-shadow: none;
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
