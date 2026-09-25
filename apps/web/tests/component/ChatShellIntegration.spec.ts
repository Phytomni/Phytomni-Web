import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import enUS from "@/locales/langs/en-US";
import zhCN from "@/locales/langs/zh-CN";

const CHAT_SOURCE = readFileSync(
  resolve(__dirname, "../../src/views/chat/ChatView.vue"),
  "utf8"
);
const CHAT_MESSAGE_ROW_SOURCE = readFileSync(
  resolve(__dirname, "../../src/views/chat/components/ChatMessageRow.vue"),
  "utf8"
);
const CHAT_COMPOSER_SOURCE = readFileSync(
  resolve(__dirname, "../../src/views/chat/components/ChatComposer.vue"),
  "utf8"
);
const SIDEBAR_SOURCE = readFileSync(
  resolve(__dirname, "../../src/views/chat/ChatSidebar.vue"),
  "utf8"
);
const CHAT_HISTORY_SOURCE = readFileSync(
  resolve(__dirname, "../../src/views/chat/components/ChatHistoryList.vue"),
  "utf8"
);
const CHAT_NAV_SOURCE = readFileSync(
  resolve(__dirname, "../../src/views/chat/components/ChatSidebarNav.vue"),
  "utf8"
);
const HISTORY_SOURCE = readFileSync(
  resolve(__dirname, "../../src/views/history/HistoryView.vue"),
  "utf8"
);
const FAVORITES_SOURCE = readFileSync(
  resolve(__dirname, "../../src/views/favorites/FavoritesView.vue"),
  "utf8"
);
const LAYOUT_SOURCE = readFileSync(
  resolve(__dirname, "../../src/layout/LayoutView.vue"),
  "utf8"
);
const FORM_LABEL_SOURCES = [
  SIDEBAR_SOURCE,
  HISTORY_SOURCE,
  FAVORITES_SOURCE,
  LAYOUT_SOURCE,
].join("\n");
const ACTIVE_CHAT_SOURCES = [
  CHAT_SOURCE,
  SIDEBAR_SOURCE,
  CHAT_HISTORY_SOURCE,
  CHAT_NAV_SOURCE,
];
const transcriptStart = CHAT_SOURCE.indexOf('class="message-container"');
const transcriptEnd = CHAT_SOURCE.indexOf("<el-backtop", transcriptStart);
const TRANSCRIPT_SOURCE = CHAT_SOURCE.slice(transcriptStart, transcriptEnd);

const countOccurrences = (source: string, needle: string) =>
  source.split(needle).length - 1;

describe("Chat adaptive shell integration", () => {
  it("mounts Chat on the adaptive shell with explicit layout state", () => {
    expect(CHAT_SOURCE).toContain("<PhyAdaptiveShell");
    expect(CHAT_SOURCE).not.toContain("<PhyAppShell");
    expect(CHAT_SOURCE).toContain(
      ':sidebar-collapsed="effectiveSidebarCollapsed"'
    );
    expect(CHAT_SOURCE).toContain(':artifact-open="artifactOpen"');
    expect(CHAT_SOURCE).toContain(
      ':artifact-fullscreen="artifactOpen && isMobileViewport"'
    );
    expect(CHAT_SOURCE).toContain("<template #sidebar>");
    expect(CHAT_SOURCE).toContain("<template #main>");
    expect(CHAT_SOURCE).toContain("<template #artifact>");
  });

  it("keeps the sidebar bridge and tutorial anchors in the Chat root", () => {
    expect(CHAT_SOURCE).toContain(
      '@handleSidebarCollapse="handleSidebarCollapse"'
    );
    expect(CHAT_SOURCE).toContain(
      '@drawerOpenChange="leftSidebarDrawerOpen = $event"'
    );
    expect(CHAT_SOURCE).toContain('ref="tourCasesTarget"');
    expect(CHAT_SOURCE).toContain(
      ':set-tour-input-target="setTourInputTarget"'
    );
    expect(CHAT_SOURCE).toContain("const setTourInputTarget");
    expect(CHAT_COMPOSER_SOURCE).toContain(':ref="bindTourInputTarget"');
    expect(CHAT_SOURCE).not.toContain('ref="tourSidebarTarget"');
    expect(countOccurrences(CHAT_SOURCE, 'ref="tourCasesTarget"')).toBe(1);
    expect(
      countOccurrences(
        CHAT_SOURCE,
        ':set-tour-input-target="setTourInputTarget"'
      )
    ).toBe(1);
    expect(CHAT_SOURCE).toContain(':target="tourSidebarTarget"');
    expect(CHAT_SOURCE).toContain("const tourSidebarTarget = () =>");
    expect(CHAT_SOURCE).toContain('[data-testid="chat-primary-action"]');
    expect(CHAT_SOURCE).toContain(':placement="tutorialSidebarPlacement"');
    expect(CHAT_SOURCE).toContain(':content-style="tutorialContentStyle"');
    expect(CHAT_SOURCE).toContain("beforeStart: prepareTutorialTarget");
    expect(CHAT_SOURCE).toContain('@change="handleTutorialStepChange"');
    expect(CHAT_SOURCE).toContain(':target="tourCasesTarget"');
    expect(CHAT_SOURCE).toContain(':target="tourInputTarget"');
  });

  it("keeps the expanded, compact, mobile, and drawer state bridge explicit", () => {
    expect(CHAT_SOURCE).toContain(
      ':sidebar-collapsed="effectiveSidebarCollapsed"'
    );
    expect(CHAT_SOURCE).toContain(':collapsed="leftSidebarCollapsed"');
    expect(CHAT_SOURCE).toContain(
      ':effective-collapsed="effectiveSidebarCollapsed"'
    );
    expect(CHAT_SOURCE).toMatch(
      /effectiveSidebarCollapsed[\s\S]*leftSidebarCollapsed\.value \|\| artifactOpen\.value/
    );
    expect(CHAT_SOURCE).toContain(':drawer-open="leftSidebarDrawerOpen"');
    expect(CHAT_SOURCE).toContain(
      '@drawerOpenChange="leftSidebarDrawerOpen = $event"'
    );
    expect(SIDEBAR_SOURCE).toContain("<PhyAdaptiveSidebar");
    expect(SIDEBAR_SOURCE).toContain(':collapsed="renderedSidebarCollapsed"');
    expect(SIDEBAR_SOURCE).toMatch(
      /renderedSidebarCollapsed[\s\S]*props\.effectiveCollapsed \?\? sidebarCollapsed\.value/
    );
    expect(SIDEBAR_SOURCE).toContain(':drawer-open="drawerOpen"');
    expect(SIDEBAR_SOURCE).toContain('@close="handleDrawerClose"');
    expect(SIDEBAR_SOURCE).toMatch(
      /const handleDrawerClose = \(\) => \{[\s\S]*?closeAgentDisclosure\(\);[\s\S]*?closeDrawer\(\);/
    );
    expect(SIDEBAR_SOURCE).toContain('@toggle="toggle"');
  });

  it("settles sidebar agent navigation rejections", () => {
    expect(SIDEBAR_SOURCE).toContain(
      "Promise.resolve(router.push(agent.route)).catch(() => undefined);"
    );
  });

  it("keeps Explore Agents as a click-to-expand sidebar disclosure", () => {
    expect(SIDEBAR_SOURCE).toContain("const showAgentsList = ref(false);");
    expect(SIDEBAR_SOURCE).toContain(
      "showAgentsList.value = !showAgentsList.value;"
    );
    expect(SIDEBAR_SOURCE).toContain(':show-agents-list="showAgentsList"');
    expect(SIDEBAR_SOURCE).toContain("<template #explore-agents>");
    expect(CHAT_NAV_SOURCE).toContain(':aria-expanded="showAgentsList"');
    expect(CHAT_NAV_SOURCE).toContain('data-testid="chat-explore-agents-list"');
  });

  it("routes sidebar product labels through the safe display component", () => {
    expect(SIDEBAR_SOURCE).toContain("<AgentDisplayName");
    expect(SIDEBAR_SOURCE).toContain(':label="agent.name"');
    expect(SIDEBAR_SOURCE).not.toContain("v-html");
  });

  it("keeps both empty and populated transcript branches in one scroll root", () => {
    expect(
      countOccurrences(CHAT_SOURCE, 'data-test="chat-transcript-scroll-root"')
    ).toBe(1);
    expect(countOccurrences(CHAT_SOURCE, 'ref="messageContainer"')).toBe(1);
    expect(
      countOccurrences(
        TRANSCRIPT_SOURCE,
        'v-if="currentChat?.messages?.length"'
      )
    ).toBe(1);
    expect(CHAT_SOURCE).toContain("<PhyEmptyState");
    expect(CHAT_SOURCE).toContain("<ChatCases");
    expect(CHAT_SOURCE).not.toContain("<" + "Prompts");
    expect(CHAT_SOURCE).toContain(
      'v-for="(message, index) in currentChat.messages"'
    );
    expect(CHAT_SOURCE).toContain('target=".message-container"');
  });

  it("keeps overlays and existing message/input regions in the main slot", () => {
    expect(CHAT_SOURCE).toContain("<template #main>");
    expect(CHAT_SOURCE).toContain('class="chat-main-layout"');
    expect(CHAT_SOURCE).toContain('class="chat-main"');
    expect(CHAT_SOURCE).not.toContain('class="right-sidebar"');
    expect(CHAT_SOURCE).toContain("<el-dialog");
    expect(CHAT_SOURCE).toContain('class="message-container"');
    expect(CHAT_SOURCE).toContain("<ChatComposer");
    expect(CHAT_COMPOSER_SOURCE).toContain('class="chat-composer-surface"');
    expect(CHAT_COMPOSER_SOURCE).not.toContain(
      'class="input-container-warpper"'
    );
    expect(CHAT_COMPOSER_SOURCE).not.toContain('class="input-box"');
  });

  it("exposes production singleton frame hooks for capture", () => {
    expect(countOccurrences(CHAT_SOURCE, 'data-testid="chat-root"')).toBe(1);
    expect(countOccurrences(CHAT_SOURCE, 'data-testid="chat-transcript"')).toBe(
      1
    );
    expect(CHAT_SOURCE).toContain(':data-chat-state="chatStateAttr"');
    expect(CHAT_SOURCE).toContain(
      ':data-sidebar-drawer-state="sidebarDrawerStateAttr"'
    );
    expect(
      countOccurrences(
        CHAT_MESSAGE_ROW_SOURCE,
        'data-testid="chat-message-row"'
      )
    ).toBe(1);
    expect(countOccurrences(CHAT_SOURCE, "<ChatMessageRow")).toBe(2);
  });

  it("keeps the Chat header focused on conversation context", () => {
    expect(CHAT_SOURCE).toContain('class="chat-header"');
    expect(CHAT_SOURCE).toContain("chatHeaderTitle");
    expect(CHAT_SOURCE).toContain("chat-expert-indicator");
    expect(CHAT_SOURCE).not.toContain('data-test="chat-header-overflow"');
    expect(CHAT_SOURCE).not.toContain('class="chat-footer"');
    expect(CHAT_SOURCE).toContain('@showArchitecture="showAgentsView"');
  });

  it("renders language and theme preferences in the Chat header", () => {
    expect(CHAT_SOURCE).toContain('data-testid="chat-header-preferences"');
    expect(countOccurrences(CHAT_SOURCE, "<LangSwitch")).toBe(1);
    expect(countOccurrences(CHAT_SOURCE, "<ThemeSwitch")).toBe(1);
    expect(CHAT_SOURCE).toContain('class="header-controls"');
  });

  it("assigns one state-specific landing scroll owner without duplicating Composer", () => {
    expect(
      countOccurrences(CHAT_SOURCE, 'data-testid="chat-content-stack"')
    ).toBe(1);
    expect(countOccurrences(CHAT_SOURCE, "<ChatComposer")).toBe(1);
    expect(CHAT_SOURCE).toContain("'is-empty': chatStateAttr === 'empty'");
    expect(CHAT_SOURCE).toContain(
      "'is-populated': chatStateAttr === 'populated'"
    );
    expect(CHAT_SOURCE).toMatch(
      /\.chat-content-stack\.is-empty\s*\{[\s\S]*?overflow-y:\s*auto/
    );
    expect(CHAT_SOURCE).toMatch(
      /\.chat-content-stack\.is-populated\s*\{[\s\S]*?overflow:\s*hidden/
    );
    expect(CHAT_SOURCE).toMatch(
      /\.chat-content-stack\.is-populated\s+\.message-container\s*\{[\s\S]*?overflow-y:\s*auto/
    );
    expect(CHAT_SOURCE).toMatch(
      /<el-backtop[\s\S]*?v-if="currentChat\?\.messages\?\.length"[\s\S]*?target="\.message-container"/
    );
  });

  it("routes help through the sidebar utility group and exposes shell capture hooks", () => {
    expect(CHAT_SOURCE).toContain('data-testid="chat-sidebar-trigger"');
    expect(CHAT_SOURCE).toContain('ref="sidebarTriggerRef"');
    expect(CHAT_SOURCE).toMatch(
      /watch\(leftSidebarDrawerOpen,[\s\S]*sidebarTriggerRef\.value\?\.\$el\?\.focus\(\)/
    );
    expect(CHAT_SOURCE).toMatch(
      /toggleSidebarFromHeader = async[\s\S]*sidebar-drawer-close[\s\S]*\.focus\(\)/
    );
    expect(CHAT_NAV_SOURCE).toContain('data-testid="chat-primary-action"');
    expect(CHAT_NAV_SOURCE).toContain('data-testid="chat-account-identity"');
    expect(CHAT_NAV_SOURCE).toContain('class="sidebar-nav-utility"');
    expect(CHAT_NAV_SOURCE).toContain('class="sidebar-nav-secondary"');
    expect(
      countOccurrences(CHAT_NAV_SOURCE, 'data-testid="chat-primary-action"')
    ).toBe(1);
    expect(
      countOccurrences(CHAT_NAV_SOURCE, 'data-testid="chat-account-identity"')
    ).toBe(1);
    expect(CHAT_NAV_SOURCE).not.toContain(
      "box-shadow: var(--sidebar-btn-shadow)"
    );
    expect(CHAT_NAV_SOURCE).not.toContain("transform: scale(1.05)");
    expect(CHAT_NAV_SOURCE).not.toContain("transform: translateY(-1px)");
  });

  it("keeps the mobile drawer trigger visible while the primary action lives in the sidebar", () => {
    expect(CHAT_SOURCE).toContain('class="mobile-sidebar-toggle"');
    expect(CHAT_SOURCE).toContain(":aria-label=\"$t('chat.openNavigation')\"");
    expect(enUS.chat.openNavigation).toBe("Open navigation");
    expect(zhCN.chat.openNavigation).toBe("打开导航");
    expect(CHAT_SOURCE).toContain("toggleSidebarFromHeader");
    expect(CHAT_SOURCE).toContain(':drawer-open="leftSidebarDrawerOpen"');
    expect(CHAT_NAV_SOURCE).toContain('data-testid="chat-primary-action"');
  });

  it("uses one centered transcript scroll root with composer clearance", () => {
    expect(CHAT_SOURCE).toContain('data-test="chat-transcript-scroll-root"');
    expect(CHAT_SOURCE).toContain('class="transcript-content"');
    expect(CHAT_SOURCE).toContain("phy-layout-transcript-max-width");
    expect(CHAT_SOURCE).toContain("phy-control-height-primary");
  });

  it("prevents the previous shell widths, app shell, and duplicate history markup from returning", () => {
    const activeChatSource = ACTIVE_CHAT_SOURCES.join("\n");

    expect(activeChatSource).not.toContain("PhyAppShell");
    expect(activeChatSource).not.toMatch(
      /(?:^|[{\s])(?:width|min-width)\s*:\s*(?:250|60|50|272|56)px\b/m
    );
    expect(countOccurrences(activeChatSource, 'class="time-group"')).toBe(1);
    expect(CHAT_HISTORY_SOURCE).toContain("visibleGroups");
    expect(SIDEBAR_SOURCE).not.toContain('class="time-group"');
  });

  it("defines semantic locale keys with exact copy in both locales", () => {
    expect(enUS.chat.untitledConversation).toBe("New chat");
    expect(zhCN.chat.untitledConversation).toBe("新对话");
    expect(enUS.chat.conversationTitle).toBe("Conversation title");
    expect(zhCN.chat.conversationTitle).toBe("对话标题");
    expect(enUS.chat).not.toHaveProperty("title");
    expect(zhCN.chat).not.toHaveProperty("title");
  });

  it("uses chat.untitledConversation for untitled header fallback, never legacy HELP copy", () => {
    expect(CHAT_SOURCE).toContain('t("chat.untitledConversation")');
    expect(CHAT_SOURCE).not.toMatch(/t\(["']chat\.title["']\)/);
    expect(CHAT_SOURCE).not.toContain('"HELP"');
    expect(CHAT_SOURCE).not.toContain("使用说明");
  });

  it("keeps header title precedence: current chat, then list, then untitled", () => {
    const headerBlock = CHAT_SOURCE.slice(
      CHAT_SOURCE.indexOf("const chatHeaderTitle"),
      CHAT_SOURCE.indexOf("const toggleSidebarFromHeader")
    );
    expect(headerBlock).toContain("currentChat.value?.title");
    expect(headerBlock).toContain("chatList.value.find");
    expect(headerBlock).toContain('t("chat.untitledConversation")');
  });

  it("uses conversationTitle for rename form labels, not legacy chat.title", () => {
    expect(FORM_LABEL_SOURCES).toContain('$t("chat.conversationTitle")');
    expect(FORM_LABEL_SOURCES).not.toMatch(/\$t\(["']chat\.title["']\)/);
  });

  it("truncates long header titles instead of wrapping over actions", () => {
    expect(CHAT_SOURCE).toContain('class="chat-header-title"');
    expect(CHAT_SOURCE).toContain("text-overflow: ellipsis");
    expect(CHAT_SOURCE).toContain("white-space: nowrap");
    expect(CHAT_SOURCE).toContain("min-width: 0");
  });

  it("keeps agent selection scoped through per-dialogue chat state into useComposer", () => {
    expect(CHAT_SOURCE).toContain("selectedAgent");
    expect(CHAT_SOURCE).toMatch(/useComposer\(\{[\s\S]*selectedAgent/);
    expect(CHAT_SOURCE).toContain("pickerOptions");
    expect(CHAT_SOURCE).toContain("derivePickerOptions");
  });

  it("keeps one picker and one bounded direct-selection surface in the composer", () => {
    expect(CHAT_SOURCE).not.toContain('class="input-container-bottom"');
    expect(CHAT_SOURCE).not.toContain('v-for="agent in presetAgents"');
    expect(CHAT_COMPOSER_SOURCE).toContain("<ChatAgentPicker");
    expect(CHAT_COMPOSER_SOURCE).toContain("<ChatAgentQuickSelect");
    expect(CHAT_COMPOSER_SOURCE).toContain(':options="pickerOptions"');
    expect(CHAT_COMPOSER_SOURCE).not.toContain("rolesTool");
    expect(CHAT_SOURCE).toContain(':picker-options="pickerOptions"');
    expect(CHAT_SOURCE).toContain('@toggle-agent="handleButtonClick"');
    expect(CHAT_SOURCE).toContain('@clear-agent="clearSelectedAgent"');
  });

  it("reconciles temporary dialogue state transactionally via coordinator", () => {
    expect(CHAT_SOURCE).toContain("rekeyChatState");
    expect(CHAT_SOURCE).toContain("reconcileMatchedDialogue");
    expect(CHAT_SOURCE).toContain("restorePendingChats(formattedData");
    expect(CHAT_SOURCE).toContain("skipRestoreTempIds");
    expect(CHAT_SOURCE).toContain("skipTempIds?: ReadonlySet<string>");
    expect(CHAT_SOURCE).toContain(
      "isLocalStorageChat(urlChatId) || chatExists"
    );
    expect(CHAT_SOURCE).toMatch(
      /getHistoryQuestionData\([\s\S]*sendingDialogueId/
    );
    expect(CHAT_SOURCE).toContain("blockingDialogueId");
    expect(CHAT_SOURCE).not.toContain("chat.title.includes(");
    expect(CHAT_SOURCE).not.toMatch(/restorePendingChats\(\s*\)/);

    const coordStart = CHAT_SOURCE.indexOf("reconcileMatchedDialogue = (");
    const coordEnd = CHAT_SOURCE.indexOf(
      "// Copy conversation + file download",
      coordStart
    );
    const coordBlock = CHAT_SOURCE.slice(coordStart, coordEnd);
    expect(coordBlock).toContain(
      "const wasCurrent = currentChatId.value === tempId"
    );
    expect(coordBlock).toMatch(
      /clearPendingChat|localStorage\.removeItem[\s\S]*currentChatId\.value = serverId/
    );
    expect(coordBlock).toContain(
      "if (reconciled && wasCurrent && currentChatId.value === tempId)"
    );

    const sendMessageSource = readFileSync(
      resolve(__dirname, "../../src/views/chat/composables/useSendMessage.ts"),
      "utf8"
    );
    expect(sendMessageSource).toContain("blockingDialogueId");
    expect(sendMessageSource).not.toContain(
      "clearPendingChat(currentChatId.value)"
    );
    expect(sendMessageSource).toContain("clearPendingChat(sendingDialogueId)");
    expect(sendMessageSource).not.toMatch(/chatList\.value\[0\]\.dialogue_id/);
    expect(sendMessageSource).toContain("chatState.uploadTransfer");
    expect(sendMessageSource).toContain("getStreamChatState");
    expect(sendMessageSource).toContain("id === sendingDialogueId ? chatState");
    expect(sendMessageSource).toContain("createChatRequestKey");
    expect(sendMessageSource).toContain("parentRowIdForDialogue");
    expect(sendMessageSource).toContain("sendingMessages.push");
    expect(sendMessageSource).toContain(
      "chatState.activeRequestId === requestKey"
    );
    expect(sendMessageSource).toMatch(
      /chatState\.isSending\s*\|\|[\s\S]{0,80}chatState\.activeRequestId/
    );
    expect(sendMessageSource).toContain(
      "const ownsLifecycle = chatState.activeRequestId === requestKey"
    );
    expect(sendMessageSource).not.toContain("Date.now().toString()");
    expect(sendMessageSource).not.toContain("currentRequestId");
    expect(sendMessageSource).not.toContain("isAborted");
    expect(sendMessageSource).not.toContain("getDialogueIdFromChatId");

    expect(CHAT_SOURCE).toContain("activeRequestId");
    expect(CHAT_SOURCE).toContain("generationStopped");
    expect(CHAT_SOURCE).toContain("abortDialogueRequest");
    expect(CHAT_SOURCE).toContain("findStateByRequestId");
    expect(CHAT_SOURCE).not.toContain("const currentRequestId = ref");
    expect(CHAT_SOURCE).not.toContain("const isAborted = ref");
    // Stopped local row must not invent a fake server message id
    expect(CHAT_SOURCE).not.toMatch(
      /generationStopped[\s\S]{0,200}id:\s*Date\.now\(\)\.toString\(\)/
    );
    // Abort targets only the owning dialogue's activeRequestId — never abortAll
    const abortStart = CHAT_SOURCE.indexOf("const abortDialogueRequest");
    const abortEnd = CHAT_SOURCE.indexOf(
      "// Use a preset question",
      abortStart
    );
    const abortBlock = CHAT_SOURCE.slice(abortStart, abortEnd);
    expect(abortBlock).toContain("chatState.activeRequestId");
    expect(abortBlock).toContain("abortRequest(requestId)");
    expect(abortBlock).toContain("cancelTask(resolvedRowId)");
    expect(abortBlock).toContain("applyCancelledTaskDraft");
    expect(abortBlock).not.toContain("abortAllRequests");
    expect(abortBlock).toContain("generationStopped = true");
    expect(abortBlock).toContain("if (chatState.generationStopped) return");
    expect(abortBlock).not.toContain("chatState.isSending = false");
    expect(abortBlock).not.toMatch(/\bid:\s/);

    const streamSource = readFileSync(
      resolve(
        __dirname,
        "../../src/views/chat/composables/useStreamMessage.ts"
      ),
      "utf8"
    );
    expect(streamSource).toContain(
      "chatState.streamingMessageId === requestId"
    );
  });

  it("owns live rendered messages on chatStates via renderedChat, not a second top-level cache", () => {
    const chatStatesSource = readFileSync(
      resolve(__dirname, "../../src/views/chat/composables/useChatStates.ts"),
      "utf8"
    );
    expect(chatStatesSource).toContain("renderedChat: null");
    expect(chatStatesSource).toContain(
      "getChatState(currentChatId.value).renderedChat"
    );
    const selectChatSource = readFileSync(
      resolve(__dirname, "../../src/views/chat/composables/useSelectChat.ts"),
      "utf8"
    );
    expect(selectChatSource).toContain("chatState.renderedChat =");
    expect(selectChatSource).toContain(
      "isLocalStorageChat(capturedDialogueId)"
    );

    const selectStart = CHAT_SOURCE.indexOf("useSelectChat({");
    const selectEnd = CHAT_SOURCE.indexOf("});", selectStart);
    const selectBlock = CHAT_SOURCE.slice(selectStart, selectEnd + 2);
    expect(selectBlock).toContain("currentChatId");
    expect(selectBlock).not.toMatch(/\bcurrentChat,/);
  });

  it("temporary-ID rekey moves the whole chatStates record; collision retains active id/URL", () => {
    const chatStatesSource = readFileSync(
      resolve(__dirname, "../../src/views/chat/composables/useChatStates.ts"),
      "utf8"
    );
    // Atomic move: assign source object then delete — identity preserved for
    // selectedAgent, activity/log, uploadTransfer, and a2ui fields.
    expect(chatStatesSource).toContain(
      "chatStates.value[toDialogueId] = source"
    );
    expect(chatStatesSource).toContain(
      "delete chatStates.value[fromDialogueId]"
    );
    expect(chatStatesSource).toContain('outcome: "target-collision"');
    expect(chatStatesSource).toMatch(
      /if \(chatStates\.value\[toDialogueId\]\)[\s\S]*return \{ outcome: "target-collision" \}/
    );

    const coordStart = CHAT_SOURCE.indexOf("reconcileMatchedDialogue = (");
    const coordEnd = CHAT_SOURCE.indexOf(
      "// Copy conversation + file download",
      coordStart
    );
    const coordBlock = CHAT_SOURCE.slice(coordStart, coordEnd);
    expect(coordBlock).toContain('rekey.outcome === "target-collision"');
    expect(coordBlock).toContain('reason: "collision"');
    // Collision must not rewrite the active dialogue or URL.
    expect(coordBlock).toMatch(
      /if \(reconciled && wasCurrent && currentChatId\.value === tempId\)/
    );
    const collisionIdx = coordBlock.indexOf('outcome === "target-collision"');
    const urlIdx = coordBlock.indexOf("updateUrlWithChatId");
    expect(collisionIdx).toBeGreaterThan(-1);
    // URL update lives only on the reconciled+wasCurrent branch, not collision.
    expect(coordBlock).toContain("updateUrlWithChatId(serverId)");
    expect(urlIdx).toBeGreaterThan(collisionIdx);
  });
});
