import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import enUS from "@/locales/langs/en-US";
import zhCN from "@/locales/langs/zh-CN";

const CHAT_SOURCE = readFileSync(
  resolve(__dirname, "../../src/views/chat/index.vue"),
  "utf8"
);
const CHAT_COMPOSER_SOURCE = readFileSync(
  resolve(__dirname, "../../src/views/chat/components/ChatComposer.vue"),
  "utf8"
);
const SIDEBAR_SOURCE = readFileSync(
  resolve(__dirname, "../../src/views/chat/sidebar.vue"),
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
  resolve(__dirname, "../../src/views/history/index.vue"),
  "utf8"
);
const FAVORITES_SOURCE = readFileSync(
  resolve(__dirname, "../../src/views/favorites/index.vue"),
  "utf8"
);
const LAYOUT_SOURCE = readFileSync(
  resolve(__dirname, "../../src/layout/index.vue"),
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
    expect(CHAT_SOURCE).toContain(':sidebar-collapsed="leftSidebarCollapsed"');
    expect(CHAT_SOURCE).toContain(':artifact-open="false"');
    expect(CHAT_SOURCE).toContain("<template #sidebar>");
    expect(CHAT_SOURCE).toContain("<template #main>");
  });

  it("keeps the sidebar bridge and tutorial anchors in the Chat root", () => {
    expect(CHAT_SOURCE).toContain(
      '@handleSidebarCollapse="handleSidebarCollapse"'
    );
    expect(CHAT_SOURCE).toContain(
      '@drawerOpenChange="leftSidebarDrawerOpen = $event"'
    );
    expect(CHAT_SOURCE).toContain('ref="tourSidebarTarget"');
    expect(CHAT_SOURCE).toContain('ref="tourCasesTarget"');
    expect(CHAT_SOURCE).toContain(':set-tour-input-target="setTourInputTarget"');
    expect(CHAT_SOURCE).toContain("const setTourInputTarget");
    expect(CHAT_COMPOSER_SOURCE).toContain(':ref="bindTourInputTarget"');
    expect(countOccurrences(CHAT_SOURCE, 'ref="tourSidebarTarget"')).toBe(1);
    expect(countOccurrences(CHAT_SOURCE, 'ref="tourCasesTarget"')).toBe(1);
    expect(
      countOccurrences(CHAT_SOURCE, ':set-tour-input-target="setTourInputTarget"')
    ).toBe(1);
    expect(CHAT_SOURCE).toContain(':target="tourSidebarTarget"');
    expect(CHAT_SOURCE).toContain(':target="tourCasesTarget"');
    expect(CHAT_SOURCE).toContain(':target="tourInputTarget"');
  });

  it("keeps the expanded, compact, mobile, and drawer state bridge explicit", () => {
    expect(CHAT_SOURCE).toContain(':sidebar-collapsed="leftSidebarCollapsed"');
    expect(CHAT_SOURCE).toContain(':drawer-open="leftSidebarDrawerOpen"');
    expect(CHAT_SOURCE).toContain(
      '@drawerOpenChange="leftSidebarDrawerOpen = $event"'
    );
    expect(SIDEBAR_SOURCE).toContain("<PhyAdaptiveSidebar");
    expect(SIDEBAR_SOURCE).toContain(':collapsed="sidebarCollapsed"');
    expect(SIDEBAR_SOURCE).toContain(':drawer-open="drawerOpen"');
    expect(SIDEBAR_SOURCE).toContain('@close="closeDrawer"');
    expect(SIDEBAR_SOURCE).toContain('@toggle="toggle"');
  });

  it("keeps both empty and populated transcript branches in one scroll root", () => {
    expect(
      countOccurrences(CHAT_SOURCE, 'data-test="chat-transcript-scroll-root"')
    ).toBe(1);
    expect(countOccurrences(CHAT_SOURCE, 'ref="messageContainer"')).toBe(1);
    expect(
      countOccurrences(
        TRANSCRIPT_SOURCE,
        'v-if="!currentChat?.messages?.length"'
      )
    ).toBe(1);
    expect(
      countOccurrences(
        TRANSCRIPT_SOURCE,
        'v-if="currentChat?.messages?.length"'
      )
    ).toBe(1);
    expect(CHAT_SOURCE).toContain("<PhyEmptyState");
    expect(CHAT_SOURCE).toContain("<Prompts");
    expect(CHAT_SOURCE).toContain(
      'v-for="(message, index) in currentChat.messages"'
    );
    expect(CHAT_SOURCE).toContain('target=".message-container"');
  });

  it("keeps overlays and existing message/input regions in the main slot", () => {
    expect(CHAT_SOURCE).toContain("<template #main>");
    expect(CHAT_SOURCE).toContain('class="chat-main-layout"');
    expect(CHAT_SOURCE).toContain('class="chat-main"');
    expect(CHAT_SOURCE).toContain('class="right-sidebar"');
    expect(CHAT_SOURCE).toContain("<el-dialog");
    expect(CHAT_SOURCE).toContain('class="message-container"');
    expect(CHAT_SOURCE).toContain("<ChatComposer");
    expect(CHAT_COMPOSER_SOURCE).toContain('class="input-container-warpper"');
  });

  it("keeps the Chat header focused on conversation context", () => {
    expect(CHAT_SOURCE).toContain('class="chat-header"');
    expect(CHAT_SOURCE).toContain("chatHeaderTitle");
    expect(CHAT_SOURCE).toContain("chat-expert-indicator");
    expect(CHAT_SOURCE).not.toContain('data-test="chat-header-overflow"');
    expect(CHAT_SOURCE).not.toContain("<LangSwitch");
    expect(CHAT_SOURCE).not.toContain('class="chat-footer"');
    expect(CHAT_SOURCE).toContain('@showArchitecture="showAgentsView"');
  });

  it("routes help through the sidebar utility group and exposes shell capture hooks", () => {
    expect(CHAT_SOURCE).toContain('data-testid="chat-sidebar-trigger"');
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
    expect(CHAT_NAV_SOURCE).not.toContain("box-shadow: var(--sidebar-btn-shadow)");
    expect(CHAT_NAV_SOURCE).not.toContain("transform: scale(1.05)");
    expect(CHAT_NAV_SOURCE).not.toContain("transform: translateY(-1px)");
  });

  it("keeps the mobile drawer trigger visible while the primary action lives in the sidebar", () => {
    expect(CHAT_SOURCE).toContain('class="mobile-sidebar-toggle"');
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
    expect(CHAT_SOURCE).toMatch(
      /useComposer\(\{[\s\S]*selectedAgent/
    );
    expect(CHAT_SOURCE).toContain(":active-button=\"activeButton\"");
  });

  it("removes the permanent bottom agent stage while keeping one inline selection path", () => {
    expect(CHAT_SOURCE).not.toContain('class="input-container-bottom"');
    expect(CHAT_SOURCE).not.toContain("@wheel.prevent=\"handleScroll\"");
    expect(CHAT_SOURCE).not.toContain(":style=\"containerStyle\"");
    expect(CHAT_SOURCE).not.toContain("v-for=\"agent in presetAgents\"");
    expect(CHAT_SOURCE).not.toContain(".input-container-bottom {");

    expect(CHAT_COMPOSER_SOURCE).toContain('class="agent-button"');
    expect(CHAT_COMPOSER_SOURCE).toContain("emit('agent-click', item)");
    expect(CHAT_COMPOSER_SOURCE).toContain("getAgentTooltip");
    expect(CHAT_SOURCE).toContain(':get-agent-tooltip="getAgentTooltip"');
    expect(CHAT_SOURCE).toContain('@agent-more="showMoreInfo"');
  });

  it("reconciles temporary dialogue state transactionally via coordinator", () => {
    expect(CHAT_SOURCE).toContain("rekeyChatState");
    expect(CHAT_SOURCE).toContain("reconcileMatchedDialogue");
    expect(CHAT_SOURCE).toContain("restorePendingChats(formattedData)");
    expect(CHAT_SOURCE).toMatch(
      /getHistoryQuestionData\([\s\S]*sendingDialogueId/
    );
    expect(CHAT_SOURCE).toContain("blockingDialogueId");
    expect(CHAT_SOURCE).not.toContain("chat.title.includes(");
    expect(CHAT_SOURCE).not.toMatch(/restorePendingChats\(\s*\)/);

    const coordStart = CHAT_SOURCE.indexOf("reconcileMatchedDialogue = (");
    const coordEnd = CHAT_SOURCE.indexOf("// Starter prompt cards", coordStart);
    const coordBlock = CHAT_SOURCE.slice(coordStart, coordEnd);
    expect(coordBlock).toContain("const wasCurrent = currentChatId.value === tempId");
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
    expect(sendMessageSource).not.toContain("clearPendingChat(sendingDialogueId)");
    expect(sendMessageSource).not.toMatch(
      /chatList\.value\[0\]\.dialogue_id/
    );
    expect(sendMessageSource).toContain("chatState.uploadTransfer");
    expect(sendMessageSource).not.toMatch(
      /getChatState\(sendingDialogueId\)\.uploadTransfer/
    );
  });
});
