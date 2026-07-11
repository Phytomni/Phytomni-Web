import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const CHAT_SOURCE = readFileSync(
  resolve(__dirname, "../../src/views/chat/index.vue"),
  "utf8"
);

describe("Chat adaptive shell integration", () => {
  it("mounts Chat on the adaptive shell with explicit layout state", () => {
    expect(CHAT_SOURCE).toContain("<PhyAdaptiveShell");
    expect(CHAT_SOURCE).not.toContain("<PhyAppShell");
    expect(CHAT_SOURCE).toContain(':sidebar-collapsed="leftSidebarCollapsed"');
    expect(CHAT_SOURCE).toContain(":artifact-open=\"false\"");
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
});
