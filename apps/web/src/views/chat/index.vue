<template>
  <div
    class="chat-page-root"
    data-testid="chat-root"
    :data-chat-state="chatStateAttr"
    :data-sidebar-drawer-state="sidebarDrawerStateAttr"
  >
  <PhyAdaptiveShell
    :sidebar-collapsed="leftSidebarCollapsed"
    :artifact-open="false"
    :artifact-fullscreen="false"
  >
    <template #sidebar>
      <!-- Left sidebar -->
      <div ref="tourSidebarTarget" class="tour-sidebar-wrap">
        <Sidebar
          :chatList="chatList"
          :currentChatId="currentChatId"
          :collapsed="leftSidebarCollapsed"
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
        :close-on-press-escape="true"
        @finish="completeTutorial"
        @close="completeTutorial"
      >
        <el-tour-step
          :target="tourSidebarTarget"
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
              class="mobile-sidebar-toggle"
              data-testid="chat-sidebar-trigger"
              :class="{ 'is-visible': leftSidebarCollapsed }"
              text
              circle
              :aria-label="$t('chat.newChat')"
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
        </div>
      </header>

      <!-- Message area -->
      <div
        class="message-container"
        data-testid="chat-transcript"
        data-test="chat-transcript-scroll-root"
        ref="messageContainer"
        :key="timestamp"
      >
        <div v-if="!currentChat?.messages?.length" class="empty-chat">
          <PhyEmptyState
            :title="$t('chat.welcomeTitle')"
            :subtitle="$t('chat.welcomeSubtitle')"
            class="empty-chat-starters-shell"
          >
            <template #mark>
              <img
                src="../../assets/images/chat/logo.png"
                class="empty-chat-mark"
                alt=""
              />
            </template>
            <div
              ref="tourCasesTarget"
              class="empty-chat-starters-region"
              role="group"
              :aria-label="$t('chat.starter.title')"
            >
              <Prompts
                class="empty-chat-starters"
                :items="starterItems"
                wrap
                @item-click="onStarterClick"
              />
            </div>
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
              message.tool_name === 'DeepGenomeAgent'
            "
          >
            <template #avatar>
              <el-avatar :size="36" :src="botAvatar" />
            </template>
              <ChatMessageContent
                :message="message"
                :index="index"
                :is-last-message="currentChat.messages.length - 1 == index"
                :activity-expanded-by-message="
                  getChatState(currentChatId).activityExpandedByMessage
                "
                :gene-network-images="geneNetworkImages"
                :gene-network-images-loading="geneNetworkImagesLoading"
                :digital-design-images="digitalDesignImages"
                :digital-design-images-loading="digitalDesignImagesLoading"
                @finish="() => handleMarkdownFinish(index)"
                @update:activity-expanded="
                  (key, open) =>
                    (getChatState(currentChatId).activityExpandedByMessage[
                      key
                    ] = open)
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
                  @update:expanded="(open) => setLogExpanded(message, open)"
                >
                  <ChatAnalystLog
                    :row-id="deriveAnalystLogRowId(message)"
                    :task-id="deriveAnalystLogTaskId(message)"
                    :log-data="
                      getChatState(currentChatId).logData[
                        deriveAnalystLogRowId(message)!
                      ]
                    "
                    :loading="
                      !!getChatState(currentChatId).loadingLog[
                        deriveAnalystLogRowId(message)!
                      ]
                    "
                    :updating="
                      !!getChatState(currentChatId).updatingLog[
                        deriveAnalystLogRowId(message)!
                      ]
                    "
                    :error-kind="
                      getChatState(currentChatId).logErrorKinds[
                        deriveAnalystLogRowId(message)!
                      ]
                    "
                    @update="updateLog(message)"
                    @retry="retryLog(message)"
                  />
                </ChatActivity>
              </template>

              <!-- Shared message chrome: files, follow-ups, actions -->
              <div
                v-if="
                  message.role === 'user' &&
                  message.attachedFiles &&
                  message.attachedFiles.length > 0
                "
                class="message-files"
              >
                <div class="files-list">
                  <div
                    v-for="(file, fileIndex) in message.attachedFiles"
                    :key="fileIndex"
                    class="file-item-display"
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
                  :can-refresh="messageActionCapabilities(message).canRefresh"
                  :refresh-busy="
                    !!refreshingMessages[`${index}_${message.id || ''}`] ||
                    (!message.steps && isSending)
                  "
                  :can-react="messageActionCapabilities(message).canReact"
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
                      if (message.id) getFileDownUrl(message.id, format);
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
            <div class="message-text loading-message phy-bubble-assistant">
              {{ $t("chat.ladingInner") }}
              <div class="loading-dots">
                <span class="dot"></span>
                <span class="dot"></span>
                <span class="dot"></span>
              </div>
              <TransferProgress
                v-if="getChatState(currentChatId).uploadTransfer"
                :snapshot="getChatState(currentChatId).uploadTransfer!"
                @cancel="(id) => abortTransfer(id)"
              />
              <SendProgress
                v-else
                :started-at="getChatState(currentChatId).sendStartedAt"
                :agent-name="getChatState(currentChatId).activeAgentName"
                :completing="getChatState(currentChatId).completing"
              />
            </div>
        </ChatMessageRow>
        </div>
      </div>
      <el-backtop target=".message-container" :right="40" :bottom="80" />

      <!-- Input area -->
      <div class="input-container">
        <ChatComposer
          ref="composerRef"
          v-model="displayMessageInput"
          :is-sending="isSending"
          v-model:chat-mode="chatMode"
          :expert-mode-enabled="expertModeEnabled"
          :show-mode-selector="!currentChat?.messages?.length"
          :file-list="fileList"
          :roles-tool="rolesTool"
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
          @remove-file="removeFile"
          @clear-agent="clearSelectedAgent"
        />
      </div>
        </div>
      </div>

    <!-- Agents architecture diagram dialog -->
    <el-dialog
      v-model="agentsViewVisible"
      :title="t('chat.agentsArchitectureTitle')"
      :close-on-click-modal="true"
      :close-on-press-escape="true"
      width="800px"
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
import Sidebar from "./sidebar.vue";
import { CHAT_SIDEBAR_DRAWER_OPEN_KEY } from "./components/ChatSidebarNav.vue";
import { SIDEBAR_MOBILE_BREAKPOINT } from "./composables/useSidebarResponsive";
import { Prompts } from "vue-element-plus-x";
import TransferProgress from "@/components/TransferProgress.vue";
import SendProgress from "./components/SendProgress.vue";
import ChatComposer from "./components/ChatComposer.vue";
import ChatMessageRow from "./components/ChatMessageRow.vue";
import ChatMessageContent from "./components/ChatMessageContent.vue";
import ChatMessageActions from "./components/ChatMessageActions.vue";
import ChatActivity from "./components/ChatActivity.vue";
import ChatAnalystLog from "./components/ChatAnalystLog.vue";
import type { DirectDownloadItem } from "./components/ChatMessageActions.vue";
import {
  PhyAdaptiveShell,
  PhyEmptyState,
} from "@/components/shell";
import { Menu } from "@element-plus/icons-vue";
import { getHistoryQuestionList } from "@/api/chat";
import { userStore } from "@/stores";
import { useTutorial } from "./composables/useTutorial";
import { useImageZoomPan } from "./composables/useImageZoomPan";
import { useChatStates } from "./composables/useChatStates";
import { useAgentImages } from "./composables/useAgentImages";
import { useReactions } from "./composables/useReactions";
import { useCopyDownload } from "./composables/useCopyDownload";
import { useFileUpload } from "./composables/useFileUpload";
import { useComposer } from "./composables/useComposer";
import { derivePickerOptions } from "@/constants/agents";
import { useSelectChat } from "./composables/useSelectChat";
import { useSendMessage } from "./composables/useSendMessage";
import { useRefreshMessage } from "./composables/useRefreshMessage";
import {
  useLogView,
  deriveAnalystLogRowId,
  deriveAnalystLogTaskId,
  analystLogActivityKey,
} from "./composables/useLogView";
import { useI18n } from "vue-i18n";
import { useRouter } from "vue-router";
import { abortRequest } from "@/utils/request";
import FollowUpQuestions from "./FollowUpQuestions.vue";
import { FilesCard } from "vue-element-plus-x";
import {
  STARTER_PROMPTS,
  applyStarterPrompt,
  getStarterPromptItems,
} from "@/views/chat/utils/starterPrompts";
import AgentsViewImg from "@/assets/images/chat/AgentsView.png";
import {
  clearPendingChat,
  isLocalStorageChat,
  isValidPendingRecord,
  matchesChat,
  safeParse,
} from "@/utils/pending-chat";
import { formatDetailedCitation } from "@/utils/citation";
import { parentRowIdForDialogue } from "./utils/chat-parent-row";
import { messageActionCapabilities } from "./utils/message-action-capabilities";
import type {
  Chat,
  ChatMessage,
  ChatComposerHandle,
  ChatUIState,
  DialogueReconciliationResult,
} from "./types";

const composerRef = ref<ChatComposerHandle | null>(null);

const timestamp = ref(Date.now());
const { t } = useI18n();

// Left sidebar state
const leftSidebarCollapsed = ref(false);
const leftSidebarDrawerOpen = ref(false);
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

// Agents architecture diagram dialog
const agentsViewVisible = ref(false);
const { scale, isDragging, imageOffset, containerRef, imageRef, imageStyle, handleWheel, handleMouseDown, handleMouseMove, handleMouseUp } = useImageZoomPan(agentsViewVisible);

const botAvatar =
  "/avatars/bot.svg";

// Show the Agents architecture diagram dialog
const showAgentsView = () => {
  agentsViewVisible.value = true;
};

// Chat list
const chatList = ref<Chat[]>([]);

// Fix: changed a static reference to a computed property to ensure reactive updates
const rolesTool = computed(() => userStore().roles);
const pickerOptions = computed(() =>
  derivePickerOptions(rolesTool.value).map((option) => ({
    tool: option.tool,
    labelKey: option.labelKey,
    label: t(option.labelKey) || option.displayName,
  }))
);
const UserStore = userStore();
const expertModeEnabled = computed(() => userStore().expertEnabled);

// Add permission loading state management
const rolesLoading = ref(false);

// Define the button permission mapping
const buttonPermissions = {
  RAG: "RAG",
  BI: "BI",
  GA: "GA",
  webSearch: "web search",
};
// Check button permission
const hasButtonPermission = (buttonType: string) => {
  const permission =
    buttonPermissions[buttonType as keyof typeof buttonPermissions];
  return rolesTool.value.includes(permission);
};

const router = useRouter();

const chatHeaderTitle = computed(() => {
  const currentTitle =
    typeof currentChat.value?.title === "string"
      ? currentChat.value.title.trim()
      : "";
  if (currentTitle) return currentTitle;

  const listTitle = chatList.value.find(
    (chat) => chat.dialogue_id === currentChatId.value,
  )?.title;
  return listTitle?.trim() || t("chat.untitledConversation");
});

const toggleSidebarFromHeader = () => {
  if (leftSidebarCollapsed.value) {
    leftSidebarCollapsed.value = false;
  } else {
    leftSidebarDrawerOpen.value = true;
  }
};

// Optimize the permission loading logic
const loadUserTools = async () => {
  if (!userStore().roles.length) {
    rolesLoading.value = true;
    try {
      await userStore().getUserTools();
    } catch (error) {
      console.error("Failed to load user permissions:", error);
    } finally {
      rolesLoading.value = false;
    }
  }
};

onMounted(async () => {
  updateMobileViewport();
  window.addEventListener("resize", updateMobileViewport);

  // Load permission info first
  await loadUserTools();

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
  currentChatId,
  currentChat,
  messageInput,
  isSending,
  chatMode,
  selectedAgent,
  fileList,
  copyVisible,
  copyTimeRef,
  refreshingMessages,
} = useChatStates();

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
      .then((res: any) => {
        if (res.code === 200 && res.data) {
          const formattedData = res.data.map((item: any) => {
            return {
              id: item.id,
              dialogue_id: item.dialogue_id,
              title: item.title_query || item.query,
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

            const pendingData = safeParse(
              localStorage.getItem(`pending_chat_${sendingDialogueId}`)
            );
            if (!isValidPendingRecord(pendingData)) {
              resolve({
                status: "retained",
                tempId: sendingDialogueId,
                reason: "unmatched",
              });
              return;
            }

            const candidates = formattedData.filter((chat: Chat) =>
              matchesChat(
                { dialogue_id: chat.dialogue_id, title: chat.title },
                pendingData,
                sendingDialogueId
              )
            );
            if (candidates.length === 1) {
              resolve(
                reconcileMatchedDialogue(
                  sendingDialogueId,
                  candidates[0].dialogue_id
                )
              );
              return;
            }

            const reason = candidates.length === 0 ? "no-match" : "ambiguous";
            console.warn(
              `[chat] dialogue reconciliation retained: ${reason} (temp=${sendingDialogueId})`
            );
            resolve({
              status: "retained",
              tempId: sendingDialogueId,
              reason,
            });
            return;
          }
        }
        resolve(undefined);
      })
      .catch((err: any) => {
        console.error("Failed to fetch history question data:", err);
        resolve(undefined);
      });
  });
};

// Scan pending localStorage records against the authoritative chat list; reconcile
// only when matchesChat yields exactly one candidate per temp key.
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
    }
  });
};

// Starter prompt cards — computed so labels/descriptions react to locale changes
const starterItems = computed(() => getStarterPromptItems(t, isSending.value));

const onStarterClick = (item: { key: string | number }) => {
  const prompt = STARTER_PROMPTS.find((p) => p.key === item.key);
  if (!prompt) return;
  applyStarterPrompt(prompt, t, (text) => {
    messageInput.value = text;
  });
};

// Copy conversation + file download
const { fallbackCopyText, downloadFile, getFileDownUrl } =
  useCopyDownload({
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
  getChatState(newDialogueId);

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

// Knowledge agent
const openKnowledgeAgent = () => {
  // Implement the knowledge agent feature here
};

// Database agent
const openDataAgent = () => {
  // Implement the database agent feature here
};

// Analyst agent
const openAnalystAgent = () => {
  // Implement the analyst agent feature here
};

// Review agent
const openReviewAgent = () => {
  // Implement the review agent feature here
};

// Message container ref, used for auto-scrolling
const messageContainer = ref<HTMLElement | null>(null);

// Auto-scroll to the latest message
const scrollToBottom = async () => {
  await nextTick();
  if (messageContainer.value) {
    messageContainer.value.scrollTop = messageContainer.value.scrollHeight;
  }
};

// Input toolbar buttons + mention-selection state machine — logic extracted into the useComposer composable
const {
  displayMessageInput,
  clearSelectedAgent,
  handleCommand,
  handleSelect,
  handleSearch,
} = useComposer({
  messageInput,
  isSending,
  currentChatId,
  selectedAgent,
  scrollToBottom,
  rolesTool,
});
const { setLogExpanded, updateLog, retryLog } = useLogView({
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

// File upload handling — state and logic extracted into the useFileUpload composable
const { handleFileChange, removeFile } = useFileUpload({
  fileList,
  currentChatId,
  getChatState,
  composerRef,
  scrollToBottom,
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

// Use a preset question
const usePrompt = (prompt: string) => {
  if (isSending.value) return;
  messageInput.value = prompt;

  // Ensure scrolling to the bottom
  nextTick(() => {
    scrollToBottom();
  });

  sendMessage();
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
  chatList.value = chatList.value.filter(
    (c) => c.dialogue_id !== deletedChat.dialogue_id
  );
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
const { selectChat } = useSelectChat({
  getChatState,
  currentChatId,
  scrollToBottom,
  updateUrlWithChatId,
  chatList,
  timestamp,
});

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
});

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
  if (isSending.value) return;

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
const {
  showTutorial,
  startTutorial,
  completeTutorial,
  checkTutorialStatus,
} = useTutorial();

const tourSidebarTarget = ref<HTMLElement | null>(null);
const tourCasesTarget = ref<HTMLElement | null>(null);
const tourInputTarget = ref<HTMLElement | null>(null);
const setTourInputTarget = (el: HTMLElement | null) => {
  tourInputTarget.value = el;
};

// Copy message content + cited document list (extracted from an inline @click to work around a
// vue-tsc 0.39.5 bug where it mis-maps a local const declared inside a multi-statement template
// arrow function onto the component instance — see the @copy handler wiring below)
const copyMessageWithDocs = (message: any, index: number) => {
  const docs =
    message.doc_list && message.doc_list.length > 0
      ? message.doc_list
          .map((item: any, idx: number) => {
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
    message.content + (docs && docs !== "" ? "\nReferences:\n" : "") + docs;
  fallbackCopyText(text, index + 1);
};

const handleMessageCopy = (message: any, index: number) => {
  if (message.role === "user") {
    fallbackCopyText(message.content, index + 1);
    return;
  }
  if (message.tableHeaders) {
    fallbackCopyText(message.original, index + 1);
    return;
  }
  copyMessageWithDocs(message, index);
};

const getDirectDownloads = (message: any): DirectDownloadItem[] => {
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
  padding: 0 var(--phy-space-16);
  border-bottom: 1px solid var(--phy-color-border);
  min-height: var(--phy-control-height-primary);
  height: var(--phy-control-height-primary);

  .chat-header-inner {
    width: min(100%, var(--phy-layout-transcript-max-width));
    height: 100%;
    margin: 0 auto;
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  .header-leading {
    min-width: 0;
    flex: 1;
    display: flex;
    align-items: center;
    gap: var(--phy-space-8);
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
    display: flex;
    align-items: center;
    gap: 10px;
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
        border-left: 3px solid var(--el-color-primary);

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
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  width: min(100%, var(--phy-layout-transcript-max-width));
  margin: 0 auto;
  padding: clamp(var(--phy-space-24), 5vh, var(--phy-space-48))
    var(--phy-space-16) var(--phy-space-24);
  box-sizing: border-box;

  .empty-chat-starters-shell {
    width: 100%;
    padding: 0;
  }

  .empty-chat-mark {
    width: 40px;
    height: 40px;
    object-fit: contain;
  }

  .empty-chat-starters-region {
    width: 100%;
  }

  .empty-chat-starters {
    width: 100%;

    :deep(.el-prompts-items) {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: var(--phy-space-12);
      width: 100%;
    }

    :deep(.el-prompts-item) {
      min-width: 0;
      padding: var(--phy-space-12) var(--phy-space-16);
      border: 1px solid var(--phy-color-border-subtle);
      border-radius: var(--phy-radius-md);
      background: var(--phy-color-bg-elevated);
      text-align: left;
      box-shadow: none;
      transition: background-color var(--phy-motion-fast)
          var(--phy-motion-ease-out),
        border-color var(--phy-motion-fast) var(--phy-motion-ease-out),
        transform var(--phy-motion-fast) var(--phy-motion-ease-out);
    }

    :deep(.el-prompts-item:first-child) {
      grid-column: 1 / -1;
      border-color: var(--phy-color-bubble-user-border);
      background: var(--phy-color-bubble-user);
    }

    :deep(.el-prompts-item:hover) {
      border-color: var(--phy-color-border-control);
      background: var(--phy-color-fill-subtle);
      transform: translateY(-1px);
    }

    :deep(.el-prompts-item:first-child:hover) {
      border-color: var(--phy-color-accent);
      background: var(--phy-color-accent-soft);
    }

    :deep(.el-prompts-item:focus-visible) {
      outline: 2px solid var(--phy-color-focus);
      outline-offset: 2px;
    }

    :deep(.el-prompts-item-disabled) {
      cursor: not-allowed;
      opacity: 0.55;
      transform: none;
    }

    :deep(.el-prompts-item-label) {
      overflow-wrap: anywhere;
      color: var(--phy-color-text);
      font-size: 0.9375rem;
      font-weight: 600;
      line-height: 1.35;
    }

    :deep(.el-prompts-item:first-child .el-prompts-item-label) {
      color: var(--phy-color-accent-text);
    }

    :deep(.el-prompts-item-description) {
      margin-top: var(--phy-space-4);
      overflow-wrap: anywhere;
      color: var(--phy-color-text-secondary);
      font-size: 0.8125rem;
      line-height: 1.4;
    }
  }
}

@media (max-width: 720px) {
  .empty-chat {
    .empty-chat-starters {
      :deep(.el-prompts-items) {
        grid-template-columns: minmax(0, 1fr);
      }

      :deep(.el-prompts-item:first-child) {
        grid-column: auto;
      }
    }
  }
}

@media (max-width: 600px) {
  .empty-chat {
    padding: var(--phy-space-20) var(--phy-space-12) var(--phy-space-16);

    .empty-chat-mark {
      width: 36px;
      height: 36px;
    }
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
  background-color: #f5f5f5;
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
  background-color: #f8f9fa;
  border-radius: 8px;
  border: 1px solid #e9ecef;

  .files-title {
    font-size: 14px;
    font-weight: 500;
    color: #495057;
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
    transition: all 0.2s ease;

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
          border-left: 3px solid var(--el-color-primary);

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
          border-left: 3px solid var(--el-color-primary);
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
  color: #909399;
  margin-top: 10px;
  width: 100%;
  text-align: right;
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
