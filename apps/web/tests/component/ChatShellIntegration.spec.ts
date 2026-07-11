import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const CHAT_SOURCE = readFileSync(
  resolve(__dirname, "../../src/views/chat/index.vue"),
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
    expect(CHAT_SOURCE).toContain('ref="tourInputTarget"');
    expect(countOccurrences(CHAT_SOURCE, 'ref="tourSidebarTarget"')).toBe(1);
    expect(countOccurrences(CHAT_SOURCE, 'ref="tourCasesTarget"')).toBe(1);
    expect(countOccurrences(CHAT_SOURCE, 'ref="tourInputTarget"')).toBe(1);
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
    expect(CHAT_SOURCE).toContain('class="input-container-warpper"');
  });

  it("keeps the Chat header focused on conversation context", () => {
    expect(CHAT_SOURCE).toContain('class="chat-header"');
    expect(CHAT_SOURCE).toContain("chatHeaderTitle");
    expect(CHAT_SOURCE).toContain("chat-expert-indicator");
    expect(CHAT_SOURCE).toContain('data-test="chat-header-overflow"');
    expect(CHAT_SOURCE).not.toContain("<LangSwitch");
    expect(CHAT_SOURCE).not.toContain('class="chat-footer"');
    expect(CHAT_SOURCE).toContain('@showArchitecture="showAgentsView"');
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
});
