<script lang="ts">
import type { Chat as ChatRecord } from "./types";

export function removeDeletedChat(options: {
  chatList: ChatRecord[];
  deletedChat: ChatRecord;
  disposeDialogue: (dialogueId: string) => void;
  removeChatState: (dialogueId: string) => void;
}): ChatRecord[] {
  const dialogueId = options.deletedChat.dialogue_id;
  options.disposeDialogue(dialogueId);
  options.removeChatState(dialogueId);
  return options.chatList.filter((chat) => chat.dialogue_id !== dialogueId);
}
</script>
<template>
  <div
    ref="chatRootRef"
    class="chat-page-root"
    data-testid="chat-root"
    :data-chat-state="chatStateAttr"
    :data-sidebar-drawer-state="sidebarDrawerStateAttr"
    :data-focused-upload-id="focusedUploadLocalId || undefined"
  >
    <PhyAdaptiveShell
      :sidebar-collapsed="effectiveSidebarCollapsed"
      :artifact-open="artifactOpen"
      :artifact-fullscreen="artifactOpen && isMobileViewport"
      :main-inert="isMobileViewport && leftSidebarDrawerOpen"
    >
      <template #sidebar>
        <!-- Left sidebar -->
        <div class="tour-sidebar-wrap">
          <Sidebar
            :chatList="chatList"
            :currentChatId="currentChatId"
            :collapsed="leftSidebarCollapsed"
            :effective-collapsed="effectiveSidebarCollapsed"
            :drawer-open="leftSidebarDrawerOpen"
            @selectChat="selectChat"
            @startNewChat="startNewChat"
            @handleSidebarCollapse="handleSidebarCollapse"
            @drawerOpenChange="leftSidebarDrawerOpen = $event"
            @startTutorial="startTutorial"
            @showArchitecture="showAgentsView"
            @chatRenamed="handleChatRenamed"
            @chatDeleted="handleChatDeleted"
            @chatFavorited="handleChatFavorited"
          />
        </div>
      </template>

      <template #main>
        <el-tour
          v-model="showTutorial"
          :mask="true"
          :content-style="tutorialContentStyle"
          :close-on-press-escape="true"
          @change="handleTutorialStepChange"
          @finish="completeTutorial"
          @close="completeTutorial"
        >
          <el-tour-step
            :target="tourSidebarTarget"
            :placement="tutorialSidebarPlacement"
            :title="t('tutorial.step1.title')"
            :description="t('tutorial.step1.content')"
          />
          <el-tour-step
            :target="tourCasesTarget"
            :title="t('tutorial.step2.title')"
            :description="t('tutorial.step2.content')"
          />
          <el-tour-step
            :target="tourInputTarget"
            :title="t('tutorial.step3.title')"
            :description="t('tutorial.step3.content')"
          />
        </el-tour>

        <div class="chat-main-layout">
          <!-- Center chat area -->
          <div class="chat-main">
            <header class="chat-header">
              <div class="chat-header-inner">
                <div class="header-leading">
                  <el-button
                    ref="sidebarTriggerRef"
                    class="mobile-sidebar-toggle"
                    data-testid="chat-sidebar-trigger"
                    :class="{ 'is-visible': leftSidebarCollapsed }"
                    text
                    circle
                    :aria-label="$t('chat.openNavigation')"
                    @click="toggleSidebarFromHeader"
                  >
                    <el-icon><Menu /></el-icon>
                  </el-button>
                  <h2 class="chat-header-title" :title="chatHeaderTitle">
                    {{ chatHeaderTitle }}
                  </h2>
                  <span
                    v-if="chatMode === 'expert'"
                    class="chat-expert-indicator"
                    data-test="chat-expert-indicator"
                  >
                    {{ $t("chat.mode.expert") }}
                  </span>
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
                'is-empty': chatStateAttr === 'empty',
                'is-populated': chatStateAttr === 'populated',
              }"
            >
              <!-- Message area -->
              <div
                class="message-container"
                data-testid="chat-transcript"
                data-test="chat-transcript-scroll-root"
                ref="messageContainer"
                :key="timestamp"
              >
                <div
                  v-if="currentHistoryHydration === 'loading'"
                  class="chat-history-state"
                  role="status"
                >
                  <PhySkeleton shape="line" :count="4" />
                  <span class="sr-only">{{ $t("chat.history.loading") }}</span>
                </div>
                <PhyErrorState
                  v-else-if="currentHistoryHydration === 'error'"
                  data-testid="chat-history-error"
                  class="chat-history-state"
                  :title="$t('chat.history.errorTitle')"
                  :description="$t('chat.history.errorSubtitle')"
                  :retry-label="$t('chat.history.retry')"
                  @retry="retrySelectedChat"
                />
                <PhyEmptyState
                  v-else-if="currentHistoryHydration === 'history-empty'"
                  data-testid="chat-history-empty"
                  class="chat-history-state"
                  :title="$t('chat.history.emptyTitle')"
                  :subtitle="$t('chat.history.emptySubtitle')"
                />
                <div
                  v-else-if="
                    currentHistoryHydration === 'new' &&
                    !currentChat?.messages?.length
                  "
                  class="empty-chat"
                >
                  <PhyEmptyState
                    :title="$t('chat.welcomeTitle')"
                    :subtitle="$t('chat.welcomeSubtitle')"
                    class="empty-chat-welcome"
                  >
                    <template #mark>
                      <img
                        src="../../assets/images/chat/logo.png"
                        class="empty-chat-mark"
                        alt=""
                      />
                    </template>
                  </PhyEmptyState>
                </div>
                <div class="transcript-content">
                  <template v-if="currentChat?.messages?.length">
                    <ChatMessageRow
                      v-for="(message, index) in currentChat.messages"
                      :key="index"
                      :role="message.role === 'user' ? 'user' : 'assistant'"
                      :message-id="message.id || undefined"
                      :streaming="!!message.streaming"
                      :wide="
                        message.role === 'assistant' &&
                        (message.tool_name === 'DeepGenomeAgent' ||
                          !!artifactPreviewForMessage(message))
                      "
                    >
                      <template #avatar>
                        <el-avatar :size="36" :src="botAvatar" />
                      </template>
                      <ChatMessageContent
                        :message="message"
                        :index="index"
                        :is-last-message="
                          currentChat.messages.length - 1 == index
                        "
                        :artifact-preview="artifactPreviewForMessage(message)"
                        :activity-expanded-by-message="
                          getChatState(currentChatId).activityExpandedByMessage
                        "
                        :gene-network-images="geneNetworkImages"
                        :gene-network-images-loading="geneNetworkImagesLoading"
                        :digital-design-images="digitalDesignImages"
                        :digital-design-images-loading="
                          digitalDesignImagesLoading
                        "
                        :lifecycle="agentRunLifecycleForMessage(message)"
                        @finish="() => handleMarkdownFinish(index)"
                        @open-artifact="openArtifact(String(message.id))"
                        @update:activity-expanded="
                          (key, open) =>
                            (getChatState(
                              currentChatId
                            ).activityExpandedByMessage[key] = open)
                        "
                        @a2ui-action="(event) => submitAction(message, event)"
                        @a2ui-retry="
                          (surfaceId) => retryAction(message, surfaceId)
                        "
                      />

                      <template #activity>
                        <!-- Only mount when rowId is a valid positive-decimal id;
                   missing/invalid ids never GET/PATCH and hide the log disclosure. -->
                        <ChatActivity
                          v-if="
                            message.role === 'assistant' &&
                            message.tool_name === 'AnalystAgent' &&
                            !!deriveAnalystLogRowId(message)
                          "
                          :state-key="analystLogStateKey(message)"
                          :expanded="isAnalystLogExpanded(message)"
                          :label="$t('chat.log.activityLabel')"
                          :hide-count="true"
                          :lifecycle="agentRunLifecycleForMessage(message)"
                          @update:expanded="
                            (open) => setLogExpanded(message, open)
                          "
                        >
                          <ChatAnalystLog
                            :row-id="deriveAnalystLogRowId(message)"
                            :task-id="deriveAnalystLogTaskId(message)"
                            :log-data="analystLogData(message)"
                            :loading="analystLogLoading(message)"
                            :updating="analystLogUpdating(message)"
                            :error-kind="analystLogErrorKind(message)"
                            @update="updateLog(message)"
                            @retry="retryLog(message)"
                          />
                        </ChatActivity>
                      </template>

                      <!-- Shared message chrome: files, follow-ups, actions -->
                      <div
                        v-if="
                          message.role === 'user' &&
                          messageAttachments(message).length > 0
                        "
                        class="message-files"
                      >
                        <div class="files-list">
                          <div
                            v-for="(file, fileIndex) in messageAttachments(
                              message
                            )"
                            :key="fileIndex"
                            class="file-item-display"
                            :data-asset-id="file.asset_id"
                          >
                            <FilesCard
                              :uid="fileIndex"
                              :name="file.name"
                              :file-size="file.size"
                              :show-del-icon="false"
                            />
                          </div>
                        </div>
                      </div>

                      <template #follow-up>
                        <FollowUpQuestions
                          v-if="
                            message.role === 'assistant' &&
                            message.followUpQuestions &&
                            message.followUpQuestions.length > 0 &&
                            message.showFollowUpQuestions &&
                            index == currentChat.messages.length - 1
                          "
                          :questions="message.followUpQuestions"
                          @question-click="handleFollowUpQuestionClick"
                        />
                      </template>

                      <template #actions>
                        <ChatMessageActions
                          :role="message.role === 'user' ? 'user' : 'assistant'"
                          :copied="copyVisible === index + 1"
                          :can-refresh="
                            messageActionCapabilities(message).canRefresh
                          "
                          :refresh-busy="
                            !!refreshingMessages[
                              `${index}_${message.id || ''}`
                            ] ||
                            (!message.steps && isSending)
                          "
                          :can-react="
                            messageActionCapabilities(message).canReact
                          "
                          :reaction-active="
                            message.id ? getReactionState(message.id) : 0
                          "
                          :direct-downloads="getDirectDownloads(message)"
                          :generated-formats="
                            messageActionCapabilities(message).generatedFormats
                          "
                          @copy="handleMessageCopy(message, index)"
                          @refresh="() => refreshMessage(index)"
                          @reaction="
                            (type) => {
                              if (message.id) handleReaction(message.id, type);
                            }
                          "
                          @direct-download="(path) => downloadFile(path)"
                          @download-format="
                            (format) => {
                              if (message.id)
                                getFileDownUrl(message.id, format);
                            }
                          "
                        />
                        <div
                          v-if="
                            message.role === 'assistant' &&
                            !message.steps &&
                            !message.tableHeaders
                          "
                          class="tip-text"
                        >
                          {{ $t("common.Tip") }}
                        </div>
                      </template>
                    </ChatMessageRow>
                  </template>

                  <!-- Loading message: real TransferProgress XOR simulated SendProgress,
           suppressed while an AG-UI stream is in flight — the placeholder already
           shows streaming content, so both would double the "is responding" cue. -->
                  <ChatMessageRow
                    v-if="isSending && !getChatState(currentChatId).isStreaming"
                    role="assistant"
                    loading
                  >
                    <template #avatar>
                      <el-avatar :size="36" :src="botAvatar" />
                    </template>
                    <div
                      class="message-text loading-message phy-bubble-assistant"
                    >
                      {{ $t("chat.ladingInner") }}
                      <div class="loading-dots">
                        <span class="dot"></span>
                        <span class="dot"></span>
                        <span class="dot"></span>
                      </div>
                      <TransferProgress
                        v-if="uploadTransfer"
                        :snapshot="uploadTransfer"
                        @cancel="(id) => abortTransfer(id)"
                      />
                      <SendProgress
                        v-else
                        :started-at="getChatState(currentChatId).sendStartedAt"
                        :agent-name="
                          getChatState(currentChatId).activeAgentName
                        "
                        :completing="getChatState(currentChatId).completing"
                        :stage-label="t(progressLabelKey)"
                      />
                    </div>
                  </ChatMessageRow>
                </div>
              </div>
              <el-backtop
                v-if="currentChat?.messages?.length"
                target=".message-container"
                :right="40"
                :bottom="80"
              />

              <!-- Input area -->
              <div class="input-container">
                <ChatComposer
                  ref="composerRef"
                  v-model="displayMessageInput"
                  :is-sending="isSending"
                  v-model:chat-mode="chatMode"
                  :instant-mode-enabled="instantModeEnabled"
                  :expert-mode-enabled="expertModeEnabled"
                  :mode-usable="activeModeEnabled"
                  :show-mode-selector="!currentChat?.messages?.length"
                  :max-attachments="uploadValidationLimits.maxAttachments"
                  :file-list="fileList"
                  :attachment-announcement="attachmentAnnouncement"
                  :attachment-announcement-nonce="attachmentAnnouncementNonce"
                  :has-blocking-uploads="hasBlockingUploads"
                  :attachment-target-available="attachmentTargetAvailable"
                  :attachment-target-blocked="attachmentTargetBlocked"
                  :roles-loading="rolesLoading"
                  :has-messages="!!currentChat?.messages?.length"
                  :selected-agent="selectedAgent"
                  :picker-options="pickerOptions"
                  :set-tour-input-target="setTourInputTarget"
                  @submit="sendMessage"
                  @stop="abortCurrentRequest"
                  @select="handleSelect"
                  @search="handleSearch"
                  @command="handleCommand"
                  @file-change="handleFileChange"
                  @paste-files="handlePastedFiles"
                  @remove-file="removeFile"
                  @pause-upload="uploadQueue.pauseUpload"
                  @resume-upload="uploadQueue.resumeUpload"
                  @retry-upload="uploadQueue.retryUpload"
                  @reselect-upload="uploadQueue.reselectUpload"
                  @cancel-upload="uploadQueue.cancelUpload"
                  @remove-upload="uploadQueue.removeUploadById"
                  @clear-agent="clearSelectedAgent"
                  @toggle-agent="handleButtonClick"
                />
              </div>
              <div
                v-if="!currentChat?.messages?.length"
                ref="tourCasesTarget"
                class="chat-cases-region"
              >
                <ChatCases />
              </div>
            </div>
          </div>
        </div>

        <!-- Agents architecture diagram dialog -->
        <el-dialog
          v-model="agentsViewVisible"
          :title="t('chat.agentsArchitectureTitle')"
          :close-on-click-modal="true"
          :close-on-press-escape="true"
          width="min(800px, calc(100vw - 32px))"
          center
        >
          <div
            class="agents-view-container"
            @wheel="handleWheel"
            @mousedown="handleMouseDown"
            @mousemove="handleMouseMove"
            @mouseup="handleMouseUp"
            @mouseleave="handleMouseUp"
            ref="containerRef"
            style="overflow: hidden; cursor: grab"
          >
            <img
              ref="imageRef"
              :src="AgentsViewImg"
              :alt="t('chat.agentsArchitectureAlt')"
              class="agents-view-image"
              :style="imageStyle"
            />
          </div>
        </el-dialog>
      </template>

      <template #artifact>
        <DeepGenomeArtifact
          v-if="
            currentArtifactMessage &&
            currentArtifactMessage.tool_name === 'DeepGenomeAgent'
          "
          :title="chatHeaderTitle"
          :metadata="artifactAgentLabel(currentArtifactMessage)"
          :status="currentArtifactStatusLabel"
          :markdown="
            String(currentArtifactMessage.content).replace(/\n/g, '\\n')
          "
          :references="currentArtifactMessage.doc_list"
          :ns="artifactNamespace"
          :tab="artifactTab"
          :tab-labels="artifactTabLabels"
          :tablist-label="t('common.operation')"
          :artifact-id="artifactId"
          :back-label="t('common.back')"
          :close-label="t('common.close')"
          :action-label="t('common.operation')"
          @back="closeArtifact"
          @close="closeArtifact"
          @tab="selectArtifactTab"
        />
        <ResearchArtifactShell
          v-else-if="currentArtifactMessage"
          :title="chatHeaderTitle"
          :metadata="artifactAgentLabel(currentArtifactMessage)"
          :status="currentArtifactStatusLabel"
          :format-scientific-agent-name="
            currentArtifactMessage.tool_name === 'InSilicoResearchAgent'
          "
          :report-status="currentArtifactReportStatus || undefined"
          :tab="artifactTab"
          :tab-labels="artifactTabLabels"
          :tablist-label="t('common.operation')"
          :artifact-id="artifactId"
          :back-label="t('common.back')"
          :close-label="t('common.close')"
          :action-label="t('common.operation')"
          @back="closeArtifact"
          @close="closeArtifact"
          @tab="selectArtifactTab"
        >
          <template #content>
            <BotReportState
              v-if="currentArtifactLifecycle"
              :state="currentArtifactLifecycle"
              :progress="currentArtifactProjection?.progress"
              :updated-at="currentArtifactProjection?.reportUpdatedAt"
              :labels="currentArtifactBotReportLabels"
              :empty-report-label="currentArtifactEmptyReportLabel"
              :ns="artifactNamespace"
            />
            <CitedAnswer
              v-else
              :content="String(currentArtifactMessage.content)"
              :references="currentArtifactMessage.doc_list"
              :ns="artifactNamespace"
              surface="artifact"
              reference-presentation="external"
            />
          </template>
          <template #evidence>
            <ResearchEvidencePanel
              :references="currentArtifactMessage.doc_list"
              :ns="artifactNamespace"
              @activate="selectArtifactTab('evidence')"
            />
          </template>
          <template #activity>{{ t("chat.log.noData") }}</template>
          <template #downloads>
            <ResultArchiveDelivery
              v-if="currentArtifactProjection?.resultArchiveV1 === true"
              :delivery="currentArtifactDelivery"
              :artifacts="currentArtifactLinks"
              :retrying="currentArtifactRetrying"
              @download="downloadResultArchive"
              @retry="retryCurrentResultArchive"
            />
            <template v-else>
              <ul
                v-if="currentArtifactLinks.length"
                class="authorized-artifact-list"
              >
                <li
                  v-for="artifact in currentArtifactLinks"
                  :key="artifact.id"
                  class="authorized-artifact-list__item"
                >
                  <span class="authorized-artifact-list__name">
                    {{ artifact.name }}
                  </span>
                  <el-tooltip
                    :content="`${t('chat.downloadFile')}: ${artifact.name}`"
                    placement="top"
                  >
                    <el-button
                      text
                      circle
                      :aria-label="`${t('chat.downloadFile')}: ${artifact.name}`"
                      data-test="authorized-artifact-download"
                      @click="downloadArtifact(artifact)"
                    >
                      <el-icon><Download /></el-icon>
                    </el-button>
                  </el-tooltip>
                </li>
              </ul>
              <BotArtifactList
                v-else-if="currentArtifactLifecycle"
                :artifacts="currentArtifactLifecycle.artifacts"
                :empty-label="t('chat.botReport.emptyArtifacts')"
                :download="downloadFile"
              />
              <span v-else>{{ t("common.noData") }}</span>
            </template>
          </template>
        </ResearchArtifactShell>
      </template>
    </PhyAdaptiveShell>
  </div>
</template>
<script setup lang="ts">
import {
  onMounted,
  onUnmounted,
  provide,
  ref,
  nextTick,
  watch,
  computed,
} from "vue";
import Sidebar from "./ChatSidebar.vue";
import { CHAT_SIDEBAR_DRAWER_OPEN_KEY } from "./components/ChatSidebarNav.vue";
import { SIDEBAR_MOBILE_BREAKPOINT } from "./composables/useSidebarResponsive";
import TransferProgress from "@/components/TransferProgress.vue";
import SendProgress from "./components/SendProgress.vue";
import ChatComposer from "./components/ChatComposer.vue";
import ChatCases from "./components/ChatCases.vue";
import ChatMessageRow from "./components/ChatMessageRow.vue";
import ChatMessageContent from "./components/ChatMessageContent.vue";
import ChatMessageActions from "./components/ChatMessageActions.vue";
import ChatActivity from "./components/ChatActivity.vue";
import ChatAnalystLog from "./components/ChatAnalystLog.vue";
import type { DirectDownloadItem } from "./components/ChatMessageActions.vue";
import { PhyAdaptiveShell, PhyEmptyState } from "@/components/shell";
import { PhyErrorState, PhySkeleton } from "@/components/state";
import {
  DeepGenomeArtifact,
  ResearchArtifactShell,
  ResearchEvidencePanel,
} from "@/components/research";
import BotArtifactList from "@/components/research/BotArtifactList.vue";
import BotReportState from "@/components/research/BotReportState.vue";
import ResultArchiveDelivery from "@/components/research/ResultArchiveDelivery.vue";
import CitedAnswer from "@/components/CitedAnswer.vue";
import { Download, Menu } from "@element-plus/icons-vue";
import { getHistoryQuestionList } from "@/api/chat";
import { userStore } from "@/stores";
import LangSwitch from "@/components/LangSwitch.vue";
import ThemeSwitch from "@/components/ThemeSwitch.vue";
import { useTutorial } from "./composables/useTutorial";
import { useImageZoomPan } from "./composables/useImageZoomPan";
import { useChatStates } from "./composables/useChatStates";
import {
  useBotCapabilities,
  type BotCapability,
} from "./composables/useBotCapabilities";
import { useResumableUploads } from "./composables/useResumableUploads";
import { useArtifactPanel } from "./composables/useArtifactPanel";
import { useAgentImages } from "./composables/useAgentImages";
import { useReactions } from "./composables/useReactions";
import { useCopyDownload } from "./composables/useCopyDownload";
import {
  useFileUpload,
  type ChatAttachmentValidationError,
} from "./composables/useFileUpload";
import type { UploadValidationLimits } from "./upload/validation";
import { useComposer } from "./composables/useComposer";
import {
  CANONICAL_AGENT_DISPLAY_NAMES,
  CANONICAL_AGENT_I18N_KEYS,
  CANONICAL_AGENT_ZH_NAMES,
  derivePickerOptions,
} from "@/constants/agents";
import type { CanonicalAgentTool } from "@/constants/agents";
import { useSelectChat } from "./composables/useSelectChat";
import { useChatAgentRunLifecycle } from "./composables/useChatAgentRunLifecycle";
import { useSendMessage } from "./composables/useSendMessage";
import { useA2uiInteraction } from "./composables/useA2uiInteraction";
import { useRefreshMessage } from "./composables/useRefreshMessage";
import {
  useLogView,
  deriveAnalystLogRowId,
  deriveAnalystLogTaskId,
  analystLogActivityKey,
} from "./composables/useLogView";
import { useI18n } from "vue-i18n";
import { ElMessage } from "element-plus";
import { abortRequest } from "@/utils/request";
import FollowUpQuestions from "./FollowUpQuestions.vue";
import { FilesCard } from "vue-element-plus-x";
import AgentsViewImg from "@/assets/images/chat/AgentsView.png";
import chatLogo from "@/assets/images/chat/logo.png";
import {
  clearPendingChat,
  isLocalStorageChat,
  isValidPendingRecord,
  matchesChat,
  safeParse,
  upsertPendingChatListEntry,
} from "@/utils/pending-chat";
import { formatDetailedCitation } from "@/utils/citation";
import { chatContentToText } from "./messageTypes";
import { parentRowIdForDialogue } from "./utils/chat-parent-row";
import { messageActionCapabilities } from "./utils/message-action-capabilities";
import {
  artifactKindForMessage,
  isCompletedDeepGenomeMessage,
} from "./utils/artifact-policy";
import type {
  Chat,
  ChatMessage,
  ChatComposerHandle as ComposerHandle,
  ChatUIState,
  DialogueReconciliationResult,
} from "./types";
import type { BotRunProjection } from "./botProjection";
import {
  cloneBotInterop,
  type BotLifecycleState,
} from "./streaming/botLifecycleReducer";

function messageAttachments(
  message: ChatMessage
): Array<{ name: string; size: number; asset_id?: string }> {
  return (message.attachments ?? message.attachedFiles ?? []).map((file) => ({
    name: file.name,
    size: file.size,
    asset_id: "asset_id" in file ? file.asset_id : undefined,
  }));
}

function hasAttachmentChannel(capability: BotCapability | undefined): boolean {
  return (
    capability?.enabled === true &&
    capability.attachments === true &&
    (capability.attachmentChannels?.length ?? 0) > 0
  );
}

const composerRef = ref<ComposerHandle | null>(null);
const chatRootRef = ref<HTMLElement | null>(null);

const timestamp = ref(Date.now());
const { locale, t } = useI18n();

// Left sidebar state
const leftSidebarCollapsed = ref(false);
const leftSidebarDrawerOpen = ref(false);
const sidebarTriggerRef = ref<{ $el?: HTMLElement } | null>(null);
provide(CHAT_SIDEBAR_DRAWER_OPEN_KEY, leftSidebarDrawerOpen);

const isMobileViewport = ref(
  typeof window !== "undefined"
    ? window.innerWidth < SIDEBAR_MOBILE_BREAKPOINT
    : false
);
const updateMobileViewport = () => {
  isMobileViewport.value = window.innerWidth < SIDEBAR_MOBILE_BREAKPOINT;
};

const chatStateAttr = computed(() =>
  currentChat.value?.messages?.length ? "populated" : "empty"
);
const sidebarDrawerStateAttr = computed(() => {
  if (!isMobileViewport.value) return "not-mobile";
  return leftSidebarDrawerOpen.value ? "open" : "closed";
});

watch(leftSidebarDrawerOpen, async (isOpen, wasOpen) => {
  if (isOpen || !wasOpen || !isMobileViewport.value) return;
  await nextTick();
  sidebarTriggerRef.value?.$el?.focus();
});

// Agents architecture diagram dialog
const agentsViewVisible = ref(false);
const {
  containerRef,
  imageRef,
  imageStyle,
  handleWheel,
  handleMouseDown,
  handleMouseMove,
  handleMouseUp,
} = useImageZoomPan(agentsViewVisible);

const botAvatar = chatLogo;

const MAX_ATTACHMENT_ANNOUNCEMENT_FILENAME_LENGTH = 96;

function boundedAttachmentAnnouncementFileName(fileName: string): string {
  const normalized = fileName
    .normalize("NFC")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/[<>]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!normalized) return t("chat.upload.fileSuffixFallback");
  const codePoints = Array.from(normalized);
  if (codePoints.length <= MAX_ATTACHMENT_ANNOUNCEMENT_FILENAME_LENGTH) {
    return normalized;
  }
  return `${codePoints
    .slice(0, MAX_ATTACHMENT_ANNOUNCEMENT_FILENAME_LENGTH - 1)
    .join("")}…`;
}

const onAttachmentValidationError = (error: ChatAttachmentValidationError) => {
  const messageKey = `chat.attachmentErrors.${error.code}`;
  const message = t(messageKey, {
    file: boundedAttachmentAnnouncementFileName(error.fileName ?? ""),
    maxFiles: uploadValidationLimits.value.maxAttachments,
    maxFileMb: uploadValidationLimits.value.maxFileBytes / 1024 / 1024,
    maxTotalMb: uploadValidationLimits.value.maxFileBytes / 1024 / 1024,
  });
  ElMessage.warning(message);
  announceAttachment(message);
};

// Show the Agents architecture diagram dialog
const showAgentsView = () => {
  agentsViewVisible.value = true;
};

// Chat list
const chatList = ref<Chat[]>([]);

const allowedAgentOptions = computed(() =>
  derivePickerOptions(userStore().roles).map((option) => ({
    tool: option.tool,
    labelKey: option.labelKey,
    label: t(option.labelKey) || option.displayName,
  }))
);
const authorizedAgentTools = computed(() =>
  allowedAgentOptions.value.map((option) => option.tool)
);
const pickerOptions = allowedAgentOptions;
const instantModeEnabled = computed(() =>
  authorizedAgentTools.value.includes("ChatAgent")
);
const expertModeEnabled = computed(
  () => userStore().expertEnabled && authorizedAgentTools.value.length > 0
);
const activeModeEnabled = computed(() =>
  chatMode.value === "instant"
    ? instantModeEnabled.value
    : expertModeEnabled.value
);

const rolesLoading = computed(() => userStore().rolesLoading);
const progressLabelKey = computed(() =>
  chatMode.value === "expert" &&
  getChatState(currentChatId.value).activeAgentName === ""
    ? "chat.progress.selectingAgent"
    : "chat.progress.processing"
);

const chatHeaderTitle = computed(() => {
  const currentTitle =
    typeof currentChat.value?.title === "string"
      ? currentChat.value.title.trim()
      : "";
  if (currentTitle) return currentTitle;

  const listTitle = chatList.value.find(
    (chat) => chat.dialogue_id === currentChatId.value
  )?.title;
  return listTitle?.trim() || t("chat.untitledConversation");
});

const toggleSidebarFromHeader = async () => {
  if (leftSidebarCollapsed.value) {
    leftSidebarCollapsed.value = false;
  } else {
    leftSidebarDrawerOpen.value = true;
    await nextTick();
    document
      .querySelector<HTMLElement>('[data-testid="sidebar-drawer-close"]')
      ?.focus();
  }
};

// Optimize the permission loading logic
const loadUserTools = async () => {
  if (!userStore().roles.length) {
    try {
      await userStore().getUserTools();
    } catch (error) {
      console.error("Failed to load user permissions:", error);
    }
  }
};

onMounted(async () => {
  updateMobileViewport();
  window.addEventListener("resize", updateMobileViewport);

  // Load permission info first
  await loadUserTools();
  await botCapabilities.load();

  // Fetch the history question list
  getHistoryQuestionData().then(() => {
    // Get the chatId from the URL
    const urlChatId = getChatIdFromUrl();

    // If chatId is absent, default to a new chat
    if (urlChatId) {
      // First check whether it is an incomplete session
      if (loadPendingChat(urlChatId)) {
        return;
      }

      // Look up whether a corresponding chat exists
      const chatExists = chatList.value.find(
        (chat) => chat.dialogue_id === urlChatId
      );
      if (chatExists) {
        // If it exists, select that chat
        selectChat(urlChatId);
      } else if (chatList.value.length > 0) {
        // If it does not exist but there are chat records, update the URL to the first record's ID
        const firstChatId = chatList.value[0].dialogue_id;
        updateUrlWithChatId(firstChatId);
        selectChat(firstChatId);
      } else {
        // If there are no chat records, create a new chat state
        startNewChat();
      }
    } else {
      // If there are no chat records, create a new chat state
      startNewChat();
    }
  });

  // Check whether the tutorial guide needs to be shown
  checkTutorialStatus();
});

onUnmounted(() => {
  window.removeEventListener("resize", updateMobileViewport);
  chatAgentRunLifecycle.dispose();
});

// Load a specific incomplete session from localStorage (used by onMounted keyed on the url chatId)
const loadPendingChat = (dialogueId: string) => {
  const key = `pending_chat_${dialogueId}`;
  const pendingChatData = safeParse(localStorage.getItem(key));

  if (!isValidPendingRecord(pendingChatData)) {
    if (pendingChatData !== null) {
      localStorage.removeItem(key); // corrupt / contract violation → clean
    }
    return false;
  }

  currentChatId.value = dialogueId;
  getChatState(dialogueId).renderedChat = {
    messages: pendingChatData.messages,
  };
  getChatState(dialogueId).mode =
    pendingChatData.mode === "expert" ? "expert" : "instant";
  return true;
};

// Parallel chat state (independent UI state per dialogueId) + current chat + 10 computed proxies
const {
  chatStates,
  getChatState,
  rekeyChatState,
  removeChatState,
  currentChatId,
  currentChat,
  messageInput,
  isSending,
  chatMode,
  selectedAgent,
  fileList,
  focusedUploadLocalId,
  attachmentAnnouncement,
  attachmentAnnouncementNonce,
  uploadTransfer,
  copyVisible,
  copyTimeRef,
  refreshingMessages,
} = useChatStates();

function announceAttachment(message: string): void {
  const ownerDialogueId = currentChatId.value;
  if (!ownerDialogueId) return;
  const ownerState = getChatState(ownerDialogueId);
  ownerState.attachmentAnnouncementNonce += 1;
  ownerState.attachmentAnnouncement = "";
  void nextTick(() => {
    if (currentChatId.value === ownerDialogueId) {
      ownerState.attachmentAnnouncement = message;
    }
  });
}

async function onAttachmentDuplicate(
  localId: string,
  fileName: string
): Promise<void> {
  const ownerDialogueId = currentChatId.value;
  if (!ownerDialogueId) return;
  focusedUploadLocalId.value = localId;
  announceAttachment(
    t("chat.upload.alreadyAttached", {
      file: boundedAttachmentAnnouncementFileName(fileName),
    })
  );
  composerRef.value?.openHeader();
  await nextTick();
  if (currentChatId.value !== ownerDialogueId) return;
  const itemIndex = fileList.value.findIndex(
    (item) => item.localId === localId
  );
  const directChips = chatRootRef.value?.querySelectorAll<HTMLButtonElement>(
    '[data-testid="attachment-chip"]'
  );
  const overflowChip = chatRootRef.value?.querySelector<HTMLButtonElement>(
    '[data-testid="attachment-chip-overflow"]'
  );
  if (itemIndex < 0) return;
  if (itemIndex >= 0 && itemIndex < 3) {
    directChips?.[itemIndex]?.focus();
    return;
  }
  if (!overflowChip) return;

  overflowChip.focus();
  overflowChip.click();
  await nextTick();
  if (currentChatId.value !== ownerDialogueId) return;
  const hiddenChip = chatRootRef.value?.querySelectorAll<HTMLButtonElement>(
    '[data-testid="attachment-chip-overflow-item"]'
  )[itemIndex - 3];
  if (!hiddenChip) return;
  hiddenChip.click();
  hiddenChip.focus();
  await nextTick();
}

const botCapabilities = useBotCapabilities("chat");
const uploadValidationLimits = computed<Readonly<UploadValidationLimits>>(() =>
  Object.freeze({
    maxFileBytes: botCapabilities.upload.value.max_file_bytes,
    maxAttachments: botCapabilities.upload.value.max_attachments,
  })
);
const attachmentTargetAvailable = computed(() => {
  if (!botCapabilities.upload.value.enabled) return false;

  const byTool = botCapabilities.byTool.value;
  if (chatMode.value === "instant") {
    return (
      authorizedAgentTools.value.includes("ChatAgent") &&
      hasAttachmentChannel(byTool.ChatAgent)
    );
  }

  if (selectedAgent.value) {
    const tool = selectedAgent.value as CanonicalAgentTool;
    return (
      authorizedAgentTools.value.includes(tool) &&
      hasAttachmentChannel(byTool[tool])
    );
  }

  return authorizedAgentTools.value.some((tool) =>
    hasAttachmentChannel(byTool[tool])
  );
});
const uploadUsername = computed(() => userStore().name ?? "");
const uploadQueue = useResumableUploads({
  currentChatId,
  getChatState,
  uploadCapability: botCapabilities.upload,
  username: uploadUsername,
  onValidationError: onAttachmentValidationError,
  onDuplicate: (localId, fileName) => {
    onAttachmentDuplicate(localId, fileName).catch(() => undefined);
  },
});
const hasBlockingUploads = computed(() => uploadQueue.hasBlockingUploads.value);
const attachmentTargetBlocked = computed(
  () => fileList.value.length > 0 && !attachmentTargetAvailable.value
);

watch(
  currentChatId,
  (dialogueId) => {
    if (dialogueId) void uploadQueue.loadRecovery(dialogueId);
  },
  { immediate: true }
);

const currentHistoryHydration = computed(() => {
  if (!currentChatId.value) return "new";
  return getChatState(currentChatId.value).historyHydration;
});

watch(
  [
    instantModeEnabled,
    expertModeEnabled,
    () => currentChatId.value,
    () => currentChat.value?.messages?.length ?? 0,
  ],
  ([instantEnabled, expertEnabled, , messageCount]) => {
    if (messageCount > 0 || instantEnabled === expertEnabled) return;
    chatMode.value = instantEnabled ? "instant" : "expert";
  },
  { immediate: true }
);

const {
  artifactOpen,
  activeArtifactMessageId,
  artifactTab,
  currentArtifactMessage,
  currentArtifactLinks,
  downloadArtifact,
  downloadResultArchive,
  retryResultArchive,
  openArtifact: setArtifactOpen,
  closeArtifact: resetArtifactPanel,
  selectArtifactTab,
  hasAutoOpened,
  markAutoOpened,
} = useArtifactPanel({ currentChatId, currentChat, getChatState });

const effectiveSidebarCollapsed = computed(
  () => leftSidebarCollapsed.value || artifactOpen.value
);

function canonicalAgentTool(toolName?: string): CanonicalAgentTool | null {
  if (!toolName || !(toolName in CANONICAL_AGENT_I18N_KEYS)) return null;
  return toolName as CanonicalAgentTool;
}

function artifactAgentLabel(message: ChatMessage): string {
  const tool = canonicalAgentTool(message.tool_name);
  if (!tool) return message.tool_name || "";
  return locale.value === "zh-CN"
    ? CANONICAL_AGENT_ZH_NAMES[tool]
    : CANONICAL_AGENT_DISPLAY_NAMES[tool];
}

function artifactPreviewForMessage(message: ChatMessage) {
  const artifactKind = artifactKindForMessage(message);
  if (artifactKind === null) return null;

  const tool = canonicalAgentTool(message.tool_name);
  if (!tool) return null;
  return {
    title: t("common.finished"),
    kind: artifactAgentLabel(message),
    summary: t(CANONICAL_AGENT_I18N_KEYS[tool]),
    openLabel: t("common.view"),
  };
}

const artifactId = computed(() => {
  const id = activeArtifactMessageId.value || "none";
  return `chat-artifact-${id.replace(/[^A-Za-z0-9_-]/g, "-")}`;
});
const artifactNamespace = computed(() => `${artifactId.value}-references`);
const artifactTabLabels = computed(() => ({
  content: t("common.view"),
  evidence: t("agents.deepGenome.references"),
  activity: t("chat.log.activityLabel"),
  downloads: t("chat.actions.downloadAttachments"),
}));

type ChatArtifactReportStatus = "loading" | "degraded" | "complete" | "failed";
type ChatArtifactLifecycleState = BotLifecycleState &
  Partial<
    Pick<BotRunProjection, "reportStage" | "reportUpdatedAt" | "progress">
  >;

const currentArtifactProjection = computed(
  () => currentArtifactMessage.value?.botProjection ?? null
);

function lifecycleFromMessage(
  message: ChatMessage
): ChatArtifactLifecycleState | null {
  const projection = message.botProjection;
  if (
    !message.botLifecycle &&
    projection &&
    projection.reportPresentation !== true
  ) {
    return null;
  }
  if (message.botLifecycle) {
    if (!projection) {
      return {
        ...message.botLifecycle,
        degradedInterop: message.botLifecycle.degradedInterop === true,
        interop: cloneBotInterop(message.botLifecycle.interop),
      };
    }
    return {
      ...message.botLifecycle,
      degradedInterop: projection.degradedInterop === true,
      interop: cloneBotInterop(projection.interop),
      reportStage: projection.reportStage,
      reportUpdatedAt: projection.reportUpdatedAt,
      progress: projection.progress,
    };
  }
  if (!projection) return null;

  let status: BotLifecycleState["status"] = "RUNNING";
  switch (projection.status) {
    case "INPUT_REQUIRED":
      status = "INPUT_REQUIRED";
      break;
    case "SUCCEEDED":
      status = "SUCCEEDED";
      break;
    case "FAILED":
    case "CANCELLED":
      status = "FAILED";
      break;
    case "TIMED_OUT":
      status = "TIMED_OUT";
      break;
  }

  const intermediateReport = projection.intermediateReport || "";
  const finalReport = projection.finalReport || "";
  return {
    runId: projection.runId,
    status,
    reportRevision: projection.reportRevision,
    visibleReport: finalReport.trim() ? finalReport : intermediateReport,
    intermediateReport,
    finalReport,
    degraded: projection.degraded || projection.trackingDegraded,
    degradedInterop: projection.degradedInterop === true,
    interop: cloneBotInterop(projection.interop),
    failures: projection.failures,
    artifacts: projection.artifacts,
    reportStage: projection.reportStage,
    reportUpdatedAt: projection.reportUpdatedAt,
    progress: projection.progress,
  };
}

const currentArtifactLifecycle = computed(() => {
  const message = currentArtifactMessage.value;
  return message ? lifecycleFromMessage(message) : null;
});

const currentArtifactDelivery = computed(
  () =>
    currentArtifactMessage.value?.delivery ??
    currentArtifactLifecycle.value?.delivery ??
    currentArtifactProjection.value?.delivery
);

const currentArtifactRetrying = computed(() => {
  const messageId = activeArtifactMessageId.value;
  return Boolean(
    messageId &&
    currentChatId.value &&
    getChatState(currentChatId.value).archiveRetryingByMessageId[messageId]
  );
});

function retryCurrentResultArchive(): void {
  const dialogueId = currentChatId.value;
  const selectedMessage = currentArtifactMessage.value;
  const messageId = selectedMessage?.id;
  const chat = currentChat.value;
  if (!dialogueId || !messageId || !chat) return;

  void retryResultArchive((delivery) => {
    const matches = chat.messages.filter((message) => message.id === messageId);
    if (matches.length !== 1) return;
    const [message] = matches;
    message.delivery = { ...delivery };
    message.status = "RUNNING";
    if (message.botProjection) {
      message.botProjection = {
        ...message.botProjection,
        status: "RUNNING",
        delivery: { ...delivery },
      };
    }
    if (message.botLifecycle) {
      message.botLifecycle = {
        ...message.botLifecycle,
        status: "RUNNING",
        delivery: { ...delivery },
      };
    }
  });
}

function reportStatusForArtifact(
  state: BotLifecycleState
): ChatArtifactReportStatus {
  const stage = (
    state as BotLifecycleState & {
      reportStage?: "waiting_for_brief_gene" | "intermediate" | "final" | null;
    }
  ).reportStage;
  if (state.status === "FAILED" || state.status === "TIMED_OUT") {
    return "failed";
  }
  if (state.status === "INPUT_REQUIRED" || stage === "waiting_for_brief_gene") {
    return "loading";
  }
  if (state.degraded || stage === "intermediate") return "degraded";
  if (
    state.status === "SUCCEEDED" ||
    stage === "final" ||
    state.finalReport.trim() !== ""
  ) {
    return "complete";
  }
  return "loading";
}

const currentArtifactReportStatus = computed<ChatArtifactReportStatus | null>(
  () =>
    currentArtifactLifecycle.value
      ? reportStatusForArtifact(currentArtifactLifecycle.value)
      : null
);

function botReportLabelForLifecycle(state: ChatArtifactLifecycleState): string {
  const stage = state.reportStage;
  if (state.status === "TIMED_OUT") return t("chat.lifecycle.timed_out");
  if (state.status === "FAILED") return t("chat.botReport.failed");
  if (state.status === "INPUT_REQUIRED") {
    return t("chat.botReport.inputRequired");
  }
  if (stage === "waiting_for_brief_gene") {
    return t("chat.botReport.waiting");
  }
  if (state.degraded) return t("chat.botReport.degraded");
  if (stage === "intermediate") return t("chat.botReport.partial");
  if (state.status === "RUNNING") return t("chat.botReport.waiting");
  return t("chat.botReport.complete");
}

const currentArtifactBotReportLabels = computed(() => {
  const state = currentArtifactLifecycle.value;
  if (!state) return {};
  const status = reportStatusForArtifact(state);
  return {
    loading:
      status === "loading"
        ? botReportLabelForLifecycle(state)
        : t("chat.botReport.waiting"),
    degraded:
      status === "degraded"
        ? botReportLabelForLifecycle(state)
        : t("chat.botReport.degraded"),
    failed:
      state.status === "TIMED_OUT"
        ? t("chat.lifecycle.timed_out")
        : t("chat.botReport.failed"),
    complete: t("chat.botReport.complete"),
  };
});

const currentArtifactEmptyReportLabel = computed(() => {
  const state = currentArtifactLifecycle.value;
  return state
    ? botReportLabelForLifecycle(state)
    : t("chat.botReport.waiting");
});

const currentArtifactStatusLabel = computed(() => {
  const state = currentArtifactLifecycle.value;
  return state ? botReportLabelForLifecycle(state) : t("common.finished");
});

const reconcileMatchedDialogue = (
  tempId: string,
  serverId: string,
  pendingKey?: string
): DialogueReconciliationResult => {
  const wasCurrent = currentChatId.value === tempId;
  const rekey = rekeyChatState(tempId, serverId);
  const benign =
    rekey.outcome === "moved" ||
    rekey.outcome === "same-id" ||
    rekey.outcome === "source-absent";
  const reconciled = rekey.outcome === "moved" || rekey.outcome === "same-id";

  if (benign) {
    if (pendingKey !== undefined) {
      localStorage.removeItem(pendingKey);
    } else if (isLocalStorageChat(tempId)) {
      clearPendingChat(tempId);
    }
  } else if (rekey.outcome === "target-collision") {
    console.warn(
      `[chat] dialogue reconciliation collision (temp=${tempId}, server=${serverId})`
    );
    return { status: "retained", tempId, reason: "collision" };
  }

  if (reconciled && wasCurrent && currentChatId.value === tempId) {
    currentChatId.value = serverId;
    updateUrlWithChatId(serverId);
  }

  if (reconciled) {
    uploadQueue.rekeyDialogue(tempId, serverId);
    return { status: "reconciled", tempId, serverId, rekey };
  }

  return { status: "retained", tempId, reason: "unmatched" };
};

// Fetch history question data; optional sendingDialogueId drives post-send reconciliation.
const getHistoryQuestionData = (
  sendingDialogueId?: string,
  options?: { blockingDialogueId?: string }
): Promise<DialogueReconciliationResult | undefined> => {
  return new Promise((resolve) => {
    getHistoryQuestionList()
      .then((res) => {
        if (res.code === 200 && res.data) {
          const formattedData: Chat[] = res.data.map((item) => {
            return {
              id: item.id,
              dialogue_id: item.dialogue_id,
              title: item.title_query || item.query || "",
              date: item.created_at,
              isFavorite: false,
            };
          });

          chatList.value = formattedData;
          const skipRestoreTempIds =
            sendingDialogueId &&
            isLocalStorageChat(sendingDialogueId) &&
            options?.blockingDialogueId
              ? new Set([sendingDialogueId])
              : undefined;
          restorePendingChats(formattedData, skipRestoreTempIds);

          if (sendingDialogueId && isLocalStorageChat(sendingDialogueId)) {
            if (options?.blockingDialogueId) {
              resolve(
                reconcileMatchedDialogue(
                  sendingDialogueId,
                  options.blockingDialogueId
                )
              );
              return;
            }

            resolve({
              status: "retained",
              tempId: sendingDialogueId,
              reason: "unmatched",
            });
            return;
          }
        }
        resolve(undefined);
      })
      .catch((err: unknown) => {
        console.error("Failed to fetch history question data:", err);
        resolve(undefined);
      });
  });
};

// Restore pending localStorage rows against the authoritative chat list. Only
// explicit dialogue-id equality may reconcile; titles are never identities.
const restorePendingChats = (
  knownChats: Chat[],
  skipTempIds?: ReadonlySet<string>
) => {
  const pendingChatKeys = Object.keys(localStorage).filter((key) =>
    key.startsWith("pending_chat_")
  );

  pendingChatKeys.forEach((key) => {
    const tempChatId = key.replace("pending_chat_", "");
    if (skipTempIds?.has(tempChatId)) {
      return;
    }
    const pendingChatData = safeParse(localStorage.getItem(key));

    if (!isValidPendingRecord(pendingChatData)) {
      if (pendingChatData !== null) {
        localStorage.removeItem(key);
      }
      return;
    }

    const candidates = knownChats.filter((chat) =>
      matchesChat(
        { dialogue_id: chat.dialogue_id, title: chat.title },
        pendingChatData,
        tempChatId
      )
    );

    if (candidates.length === 1) {
      reconcileMatchedDialogue(tempChatId, candidates[0].dialogue_id, key);
      return;
    }

    const firstUserMessage = pendingChatData.messages.find(
      (message) => message.role === "user"
    );
    const pendingTitle =
      typeof pendingChatData.title === "string"
        ? pendingChatData.title
        : typeof firstUserMessage?.content === "string"
          ? firstUserMessage.content
          : "";
    upsertPendingChatListEntry(knownChats, tempChatId, pendingTitle, {
      date:
        typeof pendingChatData.date === "string"
          ? pendingChatData.date
          : undefined,
    });
  });
};

// Copy conversation + file download
const { fallbackCopyText, downloadFile, getFileDownUrl } = useCopyDownload({
  copyVisible,
  copyTimeRef,
  t,
});

// Agent image fetch state (GeneNetworkAgent / DigitalDesignAgent)
const {
  geneNetworkImages,
  geneNetworkImagesLoading,
  digitalDesignImages,
  digitalDesignImagesLoading,
} = useAgentImages(currentChat);

// Start a new chat
const startNewChat = () => {
  // Create the state for a new chat
  const newDialogueId = "new_" + Date.now();
  const newChatState = getChatState(newDialogueId);
  newChatState.historyHydration = "new";
  newChatState.historyErrorKind = null;

  // Set the current chat ID to the newly created ID
  currentChatId.value = newDialogueId;
  currentChat.value = { messages: [] };

  // Remove the id parameter from the URL
  const url = new URL(window.location.href);
  url.searchParams.delete("dialogue_id");
  window.history.pushState({}, "", url.toString());

  // Ensure scrolling to the bottom
  nextTick(() => {
    scrollToBottom();
  });
};

// Message container ref, used for auto-scrolling
const messageContainer = ref<HTMLElement | null>(null);
const artifactScrollPositions = new Map<string, number>();

const restoreTranscriptScroll = async (
  dialogueId: string,
  scrollTop: number
) => {
  await nextTick();
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      if (currentChatId.value === dialogueId && messageContainer.value) {
        messageContainer.value.scrollTop = scrollTop;
      }
    });
  });
};

const openArtifact = (messageId: string) => {
  const dialogueId = currentChatId.value;
  const scrollTop = messageContainer.value?.scrollTop;
  setArtifactOpen(messageId);
  if (
    !dialogueId ||
    scrollTop === undefined ||
    !artifactOpen.value ||
    activeArtifactMessageId.value !== messageId
  ) {
    return;
  }
  artifactScrollPositions.set(dialogueId, scrollTop);
  void restoreTranscriptScroll(dialogueId, scrollTop);
};

const closeArtifact = () => {
  resetArtifactPanel();
};

const observeDeepGenomeArtifacts = () => {
  const foregroundDialogueId = currentChatId.value;
  let foregroundCandidate: string | null = null;

  Object.entries(chatStates.value).forEach(([dialogueId, state]) => {
    (state.renderedChat?.messages ?? []).forEach((message) => {
      if (!isCompletedDeepGenomeMessage(message)) return;
      if (typeof message.id !== "string" && typeof message.id !== "number") {
        return;
      }
      const normalizedId = String(message.id).trim();
      if (!normalizedId) return;

      if (hasAutoOpened(normalizedId, dialogueId)) return;

      // Mark every eligible server id as considered in its own dialogue. A
      // background result is therefore never auto-opened when the user later
      // switches into that conversation.
      markAutoOpened(normalizedId, dialogueId);
      if (dialogueId === foregroundDialogueId) {
        foregroundCandidate = normalizedId;
      }
    });
  });

  if (foregroundCandidate !== null) {
    // Mark before opening so the same reactive update, close/reopen cycle, or
    // history refresh cannot take focus from the user a second time.
    markAutoOpened(foregroundCandidate);
    openArtifact(foregroundCandidate);
  }
};

watch([chatStates, currentChatId], observeDeepGenomeArtifacts, {
  deep: true,
  flush: "post",
});

watch(
  artifactOpen,
  (isOpen, wasOpen) => {
    if (isOpen || !wasOpen) return;
    const dialogueId = currentChatId.value;
    const scrollTop = artifactScrollPositions.get(dialogueId);
    if (scrollTop === undefined) return;
    artifactScrollPositions.delete(dialogueId);
    void restoreTranscriptScroll(dialogueId, scrollTop);
  },
  { flush: "sync" }
);

// Auto-scroll to the latest message
const scrollToBottom = async () => {
  await nextTick();
  if (messageContainer.value) {
    const mobileSafeInset =
      typeof window !== "undefined" && window.innerWidth < 600 ? 24 : 0;
    messageContainer.value.scrollTop = Math.max(
      0,
      messageContainer.value.scrollHeight -
        messageContainer.value.clientHeight -
        mobileSafeInset
    );
  }
};

// Input toolbar buttons + mention-selection state machine — logic extracted into the useComposer composable
const {
  displayMessageInput,
  clearSelectedAgent,
  handleButtonClick,
  handleCommand,
  handleSelect,
  handleSearch,
} = useComposer({
  messageInput,
  isSending,
  selectedAgent,
  chatMode,
  scrollToBottom,
  authorizedAgentTools,
});
const { setLogExpanded, updateLog, retryLog, refreshModernLog } = useLogView({
  isSending,
  currentChat,
  currentChatId,
  getChatState,
  scrollToBottom,
});

function analystLogStateKey(message: ChatMessage): string | null {
  const rowId = deriveAnalystLogRowId(message);
  return rowId ? analystLogActivityKey(rowId) : null;
}

function isAnalystLogExpanded(message: ChatMessage): boolean {
  const rowId = deriveAnalystLogRowId(message);
  if (!rowId || !currentChatId.value) return false;
  return (
    getChatState(currentChatId.value).activityExpandedByMessage[
      analystLogActivityKey(rowId)
    ] === true
  );
}

function analystLogState(message: ChatMessage): ChatUIState | null {
  if (!currentChatId.value || !deriveAnalystLogRowId(message)) return null;
  return getChatState(currentChatId.value);
}

function analystLogData(message: ChatMessage): ChatUIState["logData"][string] {
  const rowId = deriveAnalystLogRowId(message);
  const state = analystLogState(message);
  return rowId && state ? state.logData[rowId] : undefined;
}

function agentRunLifecycleForMessage(message: ChatMessage) {
  const rowId = deriveAnalystLogRowId(message);
  if (!rowId || !currentChatId.value) return undefined;
  return getChatState(currentChatId.value).agentRunLifecycles[rowId];
}

watch(
  () => {
    const dialogueId = currentChatId.value;
    if (!dialogueId) return ["", ""] as const;
    const signature = Object.entries(
      getChatState(dialogueId).agentRunLifecycles
    )
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([rowId, lifecycle]) =>
        [
          rowId,
          lifecycle.phase,
          lifecycle.child_task_count,
          lifecycle.report_revision,
          lifecycle.artifact_summary.image_count,
          lifecycle.artifact_summary.output_directory_count,
          lifecycle.artifact_summary.has_report,
        ].join(":")
      )
      .join("|");
    return [dialogueId, signature] as const;
  },
  ([dialogueId, next], [previousDialogueId, previous]) => {
    if (
      !previousDialogueId ||
      dialogueId !== previousDialogueId ||
      !previous ||
      next === previous
    ) {
      return;
    }
    for (const message of currentChat.value?.messages ?? []) {
      if (agentRunLifecycleForMessage(message)) {
        void refreshModernLog(message);
      }
    }
  }
);

function analystLogLoading(message: ChatMessage): boolean {
  const rowId = deriveAnalystLogRowId(message);
  const state = analystLogState(message);
  return rowId && state ? state.loadingLog[rowId] === true : false;
}

function analystLogUpdating(message: ChatMessage): boolean {
  const rowId = deriveAnalystLogRowId(message);
  const state = analystLogState(message);
  return rowId && state ? state.updatingLog[rowId] === true : false;
}

function analystLogErrorKind(
  message: ChatMessage
): ChatUIState["logErrorKinds"][string] {
  const rowId = deriveAnalystLogRowId(message);
  const state = analystLogState(message);
  return rowId && state ? state.logErrorKinds[rowId] : undefined;
}

// File upload handling — state and logic extracted into the useFileUpload composable
const { handleFileChange, handlePastedFiles, removeFile } = useFileUpload({
  fileList,
  currentChatId,
  getChatState,
  composerRef,
  uploadCapability: botCapabilities.upload,
  scrollToBottom,
  queueFiles: uploadQueue.queueFiles,
  removeUpload: uploadQueue.removeUpload,
  onValidationError: onAttachmentValidationError,
});

// Message upvote/downvote feature — state and logic extracted into the useReactions composable
const { getReactionState, handleReaction } = useReactions({
  currentChatId,
  getChatState,
  scrollToBottom,
});

function findStateByRequestId(
  requestId: string
): { dialogueId: string; state: ChatUIState } | null {
  for (const [dialogueId, state] of Object.entries(chatStates.value)) {
    if (
      state.activeRequestId === requestId ||
      state.uploadTransfer?.requestId === requestId
    ) {
      return { dialogueId, state };
    }
  }
  return null;
}

function abortTransfer(requestId: string) {
  const owned = findStateByRequestId(requestId);
  if (owned?.state.uploadTransfer?.requestId === requestId) {
    void uploadQueue.cancelDialogue(owned.dialogueId);
    return;
  }
  if (owned) {
    owned.state.uploadTransfer = null;
  }
  if (owned && owned.state.activeRequestId === requestId) {
    void abortDialogueRequest(owned.dialogueId, owned.state);
    return;
  }
  abortRequest(requestId);
}

// Abort the current (focused) dialogue's in-flight request
const abortCurrentRequest = async () => {
  const dialogueId = currentChatId.value;
  if (!dialogueId) return;
  const chatState = getChatState(dialogueId);
  await abortDialogueRequest(dialogueId, chatState);
};

const abortDialogueRequest = async (
  dialogueId: string,
  chatState: ChatUIState
) => {
  const requestId = chatState.activeRequestId;
  if (!requestId || chatState.generationStopped) return;

  // Claim the stop before aborting so a double click cannot race two abort
  // attempts or append duplicate local stopped rows.
  chatState.generationStopped = true;

  try {
    const success = abortRequest(requestId);
    if (success) {
      // Local stopped row: no server message id — copy may remain; the shared
      // capability helper keeps every server-backed action unavailable.
      const messages = chatState.renderedChat?.messages;
      if (messages) {
        const abortMessage: ChatMessage = {
          role: "assistant",
          content: t("chat.generationStopped"),
          instantMessage: true,
        };
        messages.push(abortMessage);
      }

      chatState.uploadTransfer = null;
      // Leave isSending + activeRequestId for the owning send finally. This
      // serializes a same-dialogue resend until authoritative reconciliation.

      if (currentChatId.value === dialogueId) {
        await scrollToBottom();
      }
    } else {
      chatState.generationStopped = false;
    }
  } catch (error) {
    chatState.generationStopped = false;
    console.error("Failed to abort request:", error);
  }
};

// Sidebar control function
const handleSidebarCollapse = (isCollapsed: boolean) => {
  leftSidebarCollapsed.value = isCollapsed;
};

// After the sidebar renames a session, the parent updates the chatList it holds (the child emits instead of mutating the prop)
const handleChatRenamed = (updatedChat: Chat) => {
  const index = chatList.value.findIndex(
    (c) => c.dialogue_id === updatedChat.dialogue_id
  );
  if (index !== -1) {
    chatList.value[index] = updatedChat;
  }
};

// The parent holds chatList; deletion removes the item from the list here (the child only emits the chatDeleted event).
const handleChatDeleted = (deletedChat: Chat) => {
  chatList.value = removeDeletedChat({
    chatList: chatList.value,
    deletedChat,
    disposeDialogue: chatAgentRunLifecycle.disposeDialogue,
    removeChatState,
  });
};

// The favorite state is likewise updated by the parent (the child only emits the chatFavorited event).
const handleChatFavorited = (updatedChat: Chat) => {
  const index = chatList.value.findIndex(
    (c) => c.dialogue_id === updatedChat.dialogue_id
  );
  if (index !== -1) {
    chatList.value[index] = updatedChat;
  }
};

// Update the chat ID in the URL
const updateUrlWithChatId = (dialogueId: string) => {
  const url = new URL(window.location.href);
  url.searchParams.set("dialogue_id", dialogueId);
  window.history.pushState({}, "", url.toString());
};

// Select a chat — history-loading logic extracted into the useSelectChat composable
const { selectChat, reloadChat } = useSelectChat({
  getChatState,
  ownsChatState: (dialogueId, state) => chatStates.value[dialogueId] === state,
  currentChatId,
  scrollToBottom,
  updateUrlWithChatId,
  chatList,
  timestamp,
  username: uploadUsername,
  attachmentStore: uploadQueue.recoveryStore,
});
const chatAgentRunLifecycle = useChatAgentRunLifecycle({
  chatStates,
  getChatState,
  reloadChat,
});

const retrySelectedChat = () => {
  const dialogueId = currentChatId.value;
  if (!dialogueId) return;
  void selectChat(dialogueId);
};

// Read the chat ID from the URL
const getChatIdFromUrl = () => {
  const urlParams = new URLSearchParams(window.location.search);
  return urlParams.get("dialogue_id");
};

/** Parent row id for the focused dialogue — refresh only; send uses a pre-await capture. */
const getDialogueIdFromChatId = () => {
  return parentRowIdForDialogue(currentChatId.value, chatList.value);
};

// Send message — send logic extracted into the useSendMessage composable
const { sendMessage } = useSendMessage({
  getChatState,
  currentChatId,
  currentChat,
  composerRef,
  t,
  userStore,
  getHistoryQuestionData,
  chatList,
  timestamp,
  selectChat,
  scrollToBottom,
  attachmentTargetBlocked,
  researchInputCapability: botCapabilities.researchInput,
});

const { submitAction, retryAction } = useA2uiInteraction();

// Handle the Markdown typing-effect completion event
const handleMarkdownFinish = (messageIndex: number) => {
  if (currentChat.value?.messages && currentChat.value.messages[messageIndex]) {
    // Set the follow-up question display state to true
    currentChat.value.messages[messageIndex].showFollowUpQuestions = true;

    // Ensure scrolling to the bottom
    nextTick(() => {
      scrollToBottom();
    });
  }
};

// Handle the follow-up question click event
const handleFollowUpQuestionClick = (question: string) => {
  // If sending or refreshing, block the action
  if (isSending.value || attachmentTargetBlocked.value) return;

  if (!currentChatId.value) return;

  const chatState = getChatState(currentChatId.value);
  if (!chatState) return;

  // Set the clicked question as the input content
  chatState.messageInput = question;

  // Ensure scrolling to the bottom
  nextTick(() => {
    scrollToBottom();
  });

  // Auto-send the message
  nextTick(() => {
    sendMessage();
  });
};

// Message refresh (regenerate the assistant answer) — logic extracted into the useRefreshMessage composable
const { refreshMessage } = useRefreshMessage({
  currentChat,
  currentChatId,
  getChatState,
  scrollToBottom,
  getHistoryQuestionData,
  getDialogueIdFromChatId,
  timestamp,
});

// Tutorial guide feature — state and logic extracted into the useTutorial composable
const prepareTutorialTarget = () => {
  if (isMobileViewport.value) {
    leftSidebarDrawerOpen.value = true;
  }
};
const {
  showTutorial,
  startTutorial,
  completeTutorial: markTutorialComplete,
  checkTutorialStatus,
} = useTutorial({ beforeStart: prepareTutorialTarget });

const tourSidebarTarget = () =>
  document.querySelector<HTMLElement>('[data-testid="chat-primary-action"]');
const tutorialSidebarPlacement = computed<"bottom-start" | "right-start">(() =>
  isMobileViewport.value ? "bottom-start" : "right-start"
);
const tutorialContentStyle = computed(() => ({
  width: isMobileViewport.value ? "calc(100vw - 32px)" : "360px",
  maxWidth: "calc(100vw - 32px)",
  boxSizing: "border-box" as const,
}));
const handleTutorialStepChange = (step: number) => {
  if (isMobileViewport.value) {
    leftSidebarDrawerOpen.value = step === 0;
  }
};
const completeTutorial = () => {
  markTutorialComplete();
  if (isMobileViewport.value) {
    leftSidebarDrawerOpen.value = false;
  }
};

const tourCasesTarget = ref<HTMLElement | null>(null);
const tourInputTarget = ref<HTMLElement | null>(null);
const setTourInputTarget = (el: HTMLElement | null) => {
  tourInputTarget.value = el;
};

// Copy message content + cited document list (extracted from an inline @click to work around a
// vue-tsc can mis-map a local const declared inside a multi-statement template
// arrow function onto the component instance — see the @copy handler wiring below)
const copyMessageWithDocs = (message: ChatMessage, index: number) => {
  const docs =
    message.doc_list && message.doc_list.length > 0
      ? message.doc_list
          .map((item, idx) => {
            if (item.au || item.ti) {
              return `${idx + 1}. ${formatDetailedCitation(item)}`;
            } else if (item.title) {
              return `${idx + 1}. ${item.title}`;
            }
            return `${idx + 1}. ${JSON.stringify(item)}`;
          })
          .join("\n")
      : "";
  const text =
    chatContentToText(message.content) +
    (docs && docs !== "" ? "\nReferences:\n" : "") +
    docs;
  fallbackCopyText(text, index + 1);
};

const handleMessageCopy = (message: ChatMessage, index: number) => {
  if (message.role === "user") {
    fallbackCopyText(chatContentToText(message.content), index + 1);
    return;
  }
  if (message.tableHeaders) {
    fallbackCopyText(message.original ?? "", index + 1);
    return;
  }
  copyMessageWithDocs(message, index);
};

const getDirectDownloads = (message: ChatMessage): DirectDownloadItem[] => {
  const items: DirectDownloadItem[] = [];
  if (
    message?.status === "SUCCEEDED" &&
    message?.upload_path &&
    message.upload_path !== ""
  ) {
    items.push({ kind: "upload", path: message.upload_path });
  }
  if (
    message?.download_path &&
    message.download_path !== "" &&
    message?.tool_name !== "GeneNetworkAgent" &&
    message?.tool_name !== "DigitalDesignAgent"
  ) {
    items.push({ kind: "file", path: message.download_path });
  }
  return items;
};
</script>

<style lang="scss" scoped>
.tour-sidebar-wrap {
  flex-shrink: 0;
  height: 100%;
}

.phy-btn-primary {
  --el-button-bg-color: var(--phy-color-primary);
  --el-button-border-color: var(--phy-color-primary);
  --el-button-hover-bg-color: var(--phy-color-primary-hover);
  --el-button-hover-border-color: var(--phy-color-primary-hover);
  --el-button-text-color: #fff;
}

.phy-btn-primary.is-plain {
  --el-button-bg-color: var(--phy-color-primary-soft);
  --el-button-text-color: var(--phy-color-primary);
  --el-button-border-color: var(--phy-color-primary-soft);
}

.chat-page-root {
  width: 100%;
  height: 100%;
  min-width: 0;
  min-height: 0;
}

.chat-main-layout {
  display: flex;
  flex: 1;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
}

// Chat main view
.chat-main {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
}

.chat-header {
  flex-shrink: 0;
  padding: 0 clamp(var(--phy-space-16), 2vw, var(--phy-space-32));
  border-bottom: 1px solid var(--phy-color-border);
  min-height: var(--phy-control-height-primary);
  height: var(--phy-control-height-primary);

  .chat-header-inner {
    width: 100%;
    height: 100%;
    margin: 0;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--phy-space-8);
  }

  .header-leading {
    min-width: 0;
    flex: 1;
    display: flex;
    align-items: center;
    gap: var(--phy-space-8);
    overflow: hidden;
  }

  .chat-header-title {
    min-width: 0;
    margin: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 18px;
    font-weight: 500;
  }

  .mobile-sidebar-toggle {
    display: none;

    &.is-visible {
      display: inline-flex;
    }
  }

  .header-controls {
    flex: 0 0 auto;
    min-width: 0;
    display: flex;
    align-items: center;
    gap: var(--phy-space-8);
  }

  .chat-expert-indicator {
    flex-shrink: 0;
    margin-left: var(--phy-space-8);
    padding: 2px var(--phy-space-8);
    border: 1px solid var(--phy-color-accent-soft);
    border-radius: var(--phy-radius-pill);
    color: var(--phy-color-accent);
    font-size: 12px;
    line-height: 1.4;
  }
}

.message-container {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: var(--phy-space-16) var(--phy-space-16)
    calc(
      var(--phy-control-height-primary) + var(--phy-space-32) +
        env(safe-area-inset-bottom, 0px)
    );
  display: flex;
  flex-direction: column;
  background: var(--phy-color-bg-page);
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

.transcript-content {
  width: min(100%, var(--phy-layout-transcript-max-width));
  margin: 0 auto;
}

.message {
  // Row owns bubble alignment/surface; Content owns overflow + gene image chrome.
  :deep(.message-content) {
    .ai-response {
      border-radius: 16px;
      padding: 16px;
      box-shadow: none;

      .steps-title {
        font-weight: bold;
        margin-bottom: 12px;
        color: #333;
      }

      .step-item {
        margin-bottom: 12px;
        padding: 12px 16px;
        background-color: #fff;
        border-radius: 8px;
        border: 1px solid var(--phy-color-border-subtle);

        .step-label {
          font-weight: bold;
          color: #666;
          margin-bottom: 8px;
          font-size: 13px;
        }

        .step-text {
          color: #333;
        }
      }

      .final-answer {
        .answer-title {
          font-weight: bold;
          margin-bottom: 12px;
          color: #333;
          font-size: 16px;
        }

        .answer-content {
          word-break: break-word;
          white-space: pre-wrap;
          color: #333;
        }
      }
    }
  }
}

.empty-chat {
  flex: 1;
  min-height: 0;
  width: min(100%, var(--phy-layout-transcript-max-width));
  margin: 0 auto;
  display: flex;
  align-items: center;
  justify-content: center;
  box-sizing: border-box;
  padding: var(--phy-space-16);

  .empty-chat-welcome {
    width: 100%;
    padding: 0;
  }

  .empty-chat-mark {
    width: 40px;
    height: 40px;
    object-fit: contain;
  }
}

.chat-history-state {
  flex: 1;
  min-height: 0;
  width: min(100%, var(--phy-layout-transcript-max-width));
  margin: 0 auto;
  padding: var(--phy-space-16);
  box-sizing: border-box;
  justify-content: center;
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

    .header-controls {
      gap: var(--phy-space-4);
    }
  }

  .chat-content-stack.is-empty .message-container {
    min-height: 180px;
    padding: var(--phy-space-16) var(--phy-space-8) var(--phy-space-4);
  }

  .empty-chat {
    padding: var(--phy-space-12);

    .empty-chat-mark {
      width: 36px;
      height: 36px;
    }
  }

  .chat-cases-region {
    padding-bottom: calc(
      var(--phy-space-24) + env(safe-area-inset-bottom, 0px)
    );
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

.input-container {
  width: 100%;
  flex-shrink: 0;
  position: relative;
  background-color: var(--phy-color-bg-page);
}

/* Action hover chrome lives on ChatMessageActions + ChatMessageRow.
   Keep this empty selector as the stable CSS section boundary that frame
   layout contract tests use after `.input-container`. */
.message-user {
}

// Loading animation
.loading-message {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 40px;
  background-color: var(--phy-bubble-assistant-bg);
  padding: 12px;
  border-radius: 8px;
  width: 75px;

  .loading-dots {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    margin-left: 5px;

    .dot {
      display: inline-block;
      width: 10px;
      height: 10px;
      border-radius: 50%;
      background-color: var(--el-color-primary);
      animation: dot-pulse 1.4s infinite ease-in-out;

      &:nth-child(1) {
        animation-delay: 0s;
      }

      &:nth-child(2) {
        animation-delay: 0.2s;
      }

      &:nth-child(3) {
        animation-delay: 0.4s;
      }
    }
  }

  @keyframes dot-pulse {
    0%,
    100% {
      opacity: 0.4;
      transform: scale(0.8);
    }

    50% {
      opacity: 1;
      transform: scale(1);
    }
  }
}

.doc-list-title {
  color: #48a0f0;
  font-size: 14px;
  font-weight: 500;
  margin-top: 8px;
  margin-bottom: 2px;
}

.doc-list-item {
  font-size: 13px;
  font-weight: 400;
  margin-bottom: 8px;

  .doc-simple {
    // Simple format (title only)
  }

  .doc-detailed {
    .doc-citation {
      color: var(--el-text-color-primary);
      font-size: 14px;
      line-height: 1.4;
      margin-bottom: 6px;
    }

    .doc-link-inline {
      display: inline;
      margin-left: 8px;

      a {
        text-decoration: none;
        font-size: 13px;
        font-weight: 400;
        transition: color 0.2s ease;

        &.doi-link {
          color: var(--el-color-primary);

          &:hover {
            color: var(--phy-color-primary-hover);
            text-decoration: underline;
          }
        }

        &.pmid-link {
          color: var(--el-color-primary);

          &:hover {
            color: var(--phy-color-primary-hover);
            text-decoration: underline;
          }
        }
      }
    }
  }
}

// File display styles within messages
.message-files {
  margin-top: 12px;
  padding: 12px;
  background-color: var(--phy-color-bg-elevated);
  border-radius: 8px;
  border: 1px solid var(--phy-color-border-subtle);

  .files-title {
    font-size: 14px;
    font-weight: 500;
    color: var(--phy-color-text-secondary);
    margin-bottom: 8px;
  }

  .files-list {
    display: flex;
    flex-direction: column;
    gap: 8px;

    .file-item-display {
      // File item styles are inherited from the FilesCard component
    }
  }
}

::v-deep(.el-textarea__inner) {
  box-shadow: none;
  margin-bottom: 30px;
}

::v-deep(.el-textarea__inner):focus {
  box-shadow: none;
}

::v-deep(.el-textarea__inner):hover {
  box-shadow: none;
}

// Upvote / downvote button styles
.reaction-buttons {
  display: flex;
  gap: 4px;
  margin-left: 8px;

  .reaction-btn {
    transition:
      color var(--phy-motion-fast) var(--phy-motion-ease-out),
      background-color var(--phy-motion-fast) var(--phy-motion-ease-out),
      transform var(--phy-motion-fast) var(--phy-motion-ease-out);

    &:hover {
      color: var(--el-color-primary);
      background-color: #f0f9ff;
      transform: scale(1.1);
    }

    &.active {
      color: var(--el-color-primary);
      background-color: #e6f7ff;

      &:hover {
        background-color: #bae7ff;
      }
    }
  }
}

// Agent info dialog styles
:deep(.agent-info-dialog) {
  .el-message-box__content {
    padding: 20px;

    .agent-info-dialog {
      h3 {
        margin: 0 0 20px 0;
        color: #303133;
        font-size: 18px;
        text-align: center;
        border-bottom: 1px solid #e4e7ed;
        padding-bottom: 10px;
      }

      .agent-detail {
        max-height: 400px;
        overflow-y: auto;

        .agent-description {
          margin-bottom: 20px;
          padding: 15px;
          background-color: #f8f9fa;
          border-radius: 8px;
          border: 1px solid var(--phy-color-border-subtle);

          p {
            margin: 0;
            color: #606266;
            font-size: 14px;
            line-height: 1.5;
          }
        }

        .agent-image {
          margin-bottom: 20px;
          padding: 15px;
          background-color: #f8f9fa;
          border-radius: 8px;
          border: 1px solid var(--phy-color-border-subtle);
          text-align: center;
          width: 300px !important;
          height: 200px !important;
          img {
            width: 100% !important;
            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
            transition: transform 0.3s ease;

            &:hover {
              transform: scale(1.02);
            }
          }
        }
      }
    }
  }
}

/* Force-override Element Plus dialog styles */
:deep(.el-message-box.agent-info-dialog) {
  --el-messagebox-width: 800px !important;
  max-width: 800px !important;
  width: 800px !important;
  min-width: 800px !important;
}

:deep(.el-message-box.agent-info-dialog .el-message-box__content) {
  max-height: 600px !important;
  height: 600px !important;
  min-height: 600px !important;
  overflow-y: auto !important;
}

:deep(.el-message-box.agent-info-dialog .el-message-box__container) {
  width: 800px !important;
  max-width: 800px !important;
}

:deep(.el-message-box.agent-info-dialog .el-message-box__main) {
  width: 800px !important;
  max-width: 800px !important;
}

/* Global style override to ensure the highest priority */
:global(.el-message-box.agent-info-dialog) {
  --el-messagebox-width: 800px !important;
  max-width: 800px !important;
  width: 800px !important;
  min-width: 800px !important;
}

:global(.el-message-box.agent-info-dialog .el-message-box__content) {
  max-height: 600px !important;
  height: 600px !important;
  min-height: 600px !important;
}

:global(.el-message-box.agent-info-dialog .el-message-box__container) {
  width: 800px !important;
  max-width: 800px !important;
}

:global(.el-message-box.agent-info-dialog .el-message-box__main) {
  width: 800px !important;
  max-width: 800px !important;
}

.tip-text {
  font-size: 12px;
  color: var(--phy-color-text-muted);
  margin-top: 10px;
  width: 100%;
  text-align: right;
}

.authorized-artifact-list {
  display: grid;
  gap: var(--phy-space-8);
  margin: 0;
  padding: 0;
  list-style: none;
}

.authorized-artifact-list__item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--phy-space-12);
  min-width: 0;
  padding: var(--phy-space-8) 0;
  border-bottom: 1px solid var(--phy-color-border-subtle);
}

.authorized-artifact-list__name {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
/* Agents architecture diagram dialog styles */
.agents-view-container {
  display: flex;
  justify-content: center;
  align-items: center;
  padding: 20px;
}

.agents-view-image {
  max-width: 100%;
  height: auto;
  border-radius: 8px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
}

/* Dialog title styles */
:deep(.el-dialog__header) {
  text-align: center;
  padding: 20px 20px 10px;

  .el-dialog__title {
    font-size: 18px;
    font-weight: 600;
    color: #303133;
  }
}

/* Dialog content styles */
:deep(.el-dialog__body) {
  padding: 10px 20px 30px;
}

/* Responsive design */
@media (max-width: 899px) {
  .mobile-sidebar-toggle {
    display: inline-flex !important;
  }

  .agents-view-image {
    width: 100% !important;
    height: auto !important;
  }

  :deep(.el-dialog) {
    margin: 5vh auto;
    width: 95% !important;
  }
}
</style>
