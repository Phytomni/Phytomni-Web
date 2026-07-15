import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  CHAT_VISUAL_FIXTURE_KEYS,
  getChatVisualFixture,
} from "../visual/chat/fixture-registry";

const CHAT_SOURCE = readFileSync(
  resolve(__dirname, "../../src/views/chat/index.vue"),
  "utf8"
);
const CHAT_COMPOSER_SOURCE = readFileSync(
  resolve(__dirname, "../../src/views/chat/components/ChatComposer.vue"),
  "utf8"
);
const CHAT_PICKER_SOURCE = readFileSync(
  resolve(__dirname, "../../src/views/chat/components/ChatAgentPicker.vue"),
  "utf8"
);
const CHAT_NAV_SOURCE = readFileSync(
  resolve(__dirname, "../../src/views/chat/components/ChatSidebarNav.vue"),
  "utf8"
);
const FIXTURE_APP_SOURCE = readFileSync(
  resolve(__dirname, "../visual/chat/ChatVisualFixtureApp.vue"),
  "utf8"
);
const CHAT_MESSAGE_ROW_SOURCE = readFileSync(
  resolve(__dirname, "../../src/views/chat/components/ChatMessageRow.vue"),
  "utf8"
);

const countOccurrences = (source: string, needle: string) =>
  source.split(needle).length - 1;

const transcriptStart = CHAT_SOURCE.indexOf('class="message-container"');
const transcriptEnd = CHAT_SOURCE.indexOf("<el-backtop", transcriptStart);
const TRANSCRIPT_SOURCE = CHAT_SOURCE.slice(transcriptStart, transcriptEnd);

describe("ChatFrameV2 — production capture hooks", () => {
  it("exposes a singleton chat-root with exact chat and drawer state attrs", () => {
    expect(countOccurrences(CHAT_SOURCE, 'data-testid="chat-root"')).toBe(1);
    expect(CHAT_SOURCE).toContain(':data-chat-state="chatStateAttr"');
    expect(CHAT_SOURCE).toContain(
      ':data-sidebar-drawer-state="sidebarDrawerStateAttr"'
    );
    expect(CHAT_SOURCE).toContain("chatStateAttr = computed(() =>");
    expect(CHAT_SOURCE).toMatch(/chatStateAttr[\s\S]*\? "populated" : "empty"/);
    expect(CHAT_SOURCE).toContain("SIDEBAR_MOBILE_BREAKPOINT");
    expect(CHAT_SOURCE).toMatch(
      /sidebarDrawerStateAttr[\s\S]*"not-mobile"[\s\S]*"open"[\s\S]*"closed"/
    );
  });

  it("binds chat-transcript to the real scroll owner and keeps one scroll root", () => {
    expect(countOccurrences(CHAT_SOURCE, 'data-testid="chat-transcript"')).toBe(
      1
    );
    expect(CHAT_SOURCE).toMatch(
      /class="message-container"\s+data-testid="chat-transcript"/
    );
    expect(
      countOccurrences(CHAT_SOURCE, 'data-test="chat-transcript-scroll-root"')
    ).toBe(1);
    expect(countOccurrences(CHAT_SOURCE, 'ref="messageContainer"')).toBe(1);
    expect(TRANSCRIPT_SOURCE).toContain(
      'v-if="!currentChat?.messages?.length"'
    );
    expect(TRANSCRIPT_SOURCE).toContain('v-if="currentChat?.messages?.length"');
  });

  it("marks persisted and loading message rows with the repeatable hook", () => {
    // Hook lives once on ChatMessageRow; index mounts the shell for transcript + loading.
    expect(
      countOccurrences(
        CHAT_MESSAGE_ROW_SOURCE,
        'data-testid="chat-message-row"'
      )
    ).toBe(1);
    expect(countOccurrences(CHAT_SOURCE, "<ChatMessageRow")).toBe(2);
    expect(TRANSCRIPT_SOURCE).toContain(
      'v-for="(message, index) in currentChat.messages"'
    );
    expect(TRANSCRIPT_SOURCE).toContain(
      'v-if="isSending && !getChatState(currentChatId).isStreaming"'
    );
    expect(TRANSCRIPT_SOURCE).toMatch(
      /<ChatMessageRow[\s\S]*v-for="\(message, index\) in currentChat\.messages"/
    );
    expect(TRANSCRIPT_SOURCE).toMatch(
      /<ChatMessageRow[\s\S]*v-if="isSending && !getChatState\(currentChatId\)\.isStreaming"/
    );
    expect(TRANSCRIPT_SOURCE).toMatch(/<ChatMessageRow[\s\S]*\bloading\b/);
  });

  it("preserves singleton composer, primary action, sidebar trigger, and identity hooks", () => {
    expect(
      countOccurrences(CHAT_COMPOSER_SOURCE, 'data-testid="chat-composer"')
    ).toBe(1);
    expect(
      countOccurrences(CHAT_NAV_SOURCE, 'data-testid="chat-primary-action"')
    ).toBe(1);
    expect(
      countOccurrences(CHAT_NAV_SOURCE, 'data-testid="chat-account-identity"')
    ).toBe(1);
    expect(
      countOccurrences(CHAT_SOURCE, 'data-testid="chat-sidebar-trigger"')
    ).toBe(1);
  });

  it("asserts one agent picker surface, one primary action, and no HELP fallback", () => {
    expect(
      countOccurrences(CHAT_PICKER_SOURCE, 'data-testid="chat-agent-picker"')
    ).toBe(1);
    expect(countOccurrences(CHAT_COMPOSER_SOURCE, "<ChatAgentPicker")).toBe(1);
    expect(CHAT_COMPOSER_SOURCE).not.toContain('class="agent-button"');
    expect(CHAT_SOURCE).not.toContain('class="input-container-bottom"');
    expect(CHAT_SOURCE).not.toContain('"HELP"');
    expect(CHAT_SOURCE).not.toContain("使用说明");
    expect(CHAT_SOURCE).toContain('t("chat.untitledConversation")');
  });
});

describe("ChatFrameV2 — compact Composer surface", () => {
  it("owns one elevated surface without legacy wrappers", () => {
    expect(CHAT_COMPOSER_SOURCE).toContain('class="chat-composer-surface"');
    expect(CHAT_COMPOSER_SOURCE).not.toContain(
      'class="input-container-warpper"'
    );
    expect(CHAT_COMPOSER_SOURCE).not.toContain('class="input-box"');
    expect(CHAT_COMPOSER_SOURCE).not.toContain(
      'class="input-container-bottom"'
    );
    expect(CHAT_COMPOSER_SOURCE).not.toContain("PhyComposerFrame");
    expect(CHAT_COMPOSER_SOURCE).toContain('class="phy-composer-frame"');
    expect(CHAT_COMPOSER_SOURCE).toContain(
      'class="phy-composer-frame__attachments'
    );
    expect(CHAT_COMPOSER_SOURCE).toMatch(
      /:deep\(\.el-sender\) \{[\s\S]*?box-shadow: none;/
    );
    expect(CHAT_COMPOSER_SOURCE).not.toContain("<template #header>");
    expect(CHAT_COMPOSER_SOURCE).toContain(
      "min-height: var(--phy-control-height-primary)"
    );
    expect(CHAT_COMPOSER_SOURCE).toContain("safe-area-inset-bottom");
    expect(CHAT_COMPOSER_SOURCE).toContain(
      "var(--phy-layout-transcript-max-width)"
    );
    expect(CHAT_COMPOSER_SOURCE).toMatch(
      /\.chat-composer\s+\.chat-composer-body\s+:deep\(\.el-textarea__inner\)\s*\{[\s\S]*?background-color:\s*transparent\s*!important;[\s\S]*?color:\s*var\(--phy-color-text\)/
    );
  });

  it("keeps mode, picker, and actions in a stable order", () => {
    const modeIdx = CHAT_COMPOSER_SOURCE.indexOf("<ChatModeSelector");
    const surfaceIdx = CHAT_COMPOSER_SOURCE.indexOf(
      'class="chat-composer-surface"'
    );
    const pickerIdx = CHAT_COMPOSER_SOURCE.indexOf("<ChatAgentPicker");
    const mentionIdx = CHAT_COMPOSER_SOURCE.indexOf("<MentionSender");
    const sendIdx = CHAT_COMPOSER_SOURCE.indexOf('class="send-btn"');
    expect(modeIdx).toBeGreaterThan(-1);
    expect(mentionIdx).toBeGreaterThan(surfaceIdx);
    expect(modeIdx).toBeGreaterThan(mentionIdx);
    expect(pickerIdx).toBeGreaterThan(modeIdx);
    expect(sendIdx).toBeGreaterThan(pickerIdx);
    expect(CHAT_COMPOSER_SOURCE).toContain(
      'class="phy-composer-frame__actions'
    );
    expect(CHAT_COMPOSER_SOURCE).toContain("<template #action-list />");
    expect(CHAT_COMPOSER_SOURCE).toMatch(
      /:deep\(\.el-sender-updown-wrap\) \{[\s\S]*?display: none !important;/
    );
    expect(CHAT_COMPOSER_SOURCE).toContain('class="stop-btn"');
    expect(CHAT_COMPOSER_SOURCE).not.toContain("abort-button-overlay");
  });

  it("binds the Tour input target to the compact surface", () => {
    expect(CHAT_COMPOSER_SOURCE).toContain(':ref="bindTourInputTarget"');
    expect(CHAT_COMPOSER_SOURCE).toMatch(
      /:ref="bindTourInputTarget"[\s\S]*class="chat-composer-surface"/
    );
    expect(CHAT_SOURCE).toContain(
      ':set-tour-input-target="setTourInputTarget"'
    );
  });
});

describe("ChatFrameV2 — frame state matrix via 3A.8 registry", () => {
  it("covers empty, populated, attachment, sending, picker, and sidebar states", () => {
    const required = [
      "empty",
      "populated",
      "attachment",
      "sending",
      "picker-open",
      "picker-selected",
      "sidebar-expanded",
      "sidebar-compact",
      "sidebar-mobile-closed",
      "sidebar-mobile-open",
    ] as const;
    for (const key of required) {
      expect(CHAT_VISUAL_FIXTURE_KEYS).toContain(key);
    }

    expect(getChatVisualFixture("empty").chatState).toBe("empty");
    expect(getChatVisualFixture("empty").messageCount).toBe(0);
    expect(getChatVisualFixture("populated").chatState).toBe("populated");
    expect(getChatVisualFixture("populated").messageCount).toBeGreaterThan(0);
    expect(getChatVisualFixture("attachment").hasAttachment).toBe(true);
    expect(getChatVisualFixture("sending").isSending).toBe(true);
    expect(getChatVisualFixture("picker-open").pickerOpen).toBe(true);
    expect(getChatVisualFixture("picker-selected").selectedAgent).toBe(
      "KnowledgeAgent"
    );
    expect(getChatVisualFixture("sidebar-expanded").sidebarCollapsed).toBe(
      false
    );
    expect(getChatVisualFixture("sidebar-compact").sidebarCollapsed).toBe(true);
    expect(
      getChatVisualFixture("sidebar-mobile-closed").showSidebarTrigger
    ).toBe(true);
    expect(getChatVisualFixture("sidebar-mobile-open").drawerOpen).toBe(true);
  });

  it("keeps the harness drawer-state attribute exact for mobile and not-mobile", () => {
    expect(FIXTURE_APP_SOURCE).toContain(
      ':data-sidebar-drawer-state="drawerStateAttr"'
    );
    expect(FIXTURE_APP_SOURCE).toContain('return "closed"');
    expect(FIXTURE_APP_SOURCE).toContain('return "open"');
    expect(FIXTURE_APP_SOURCE).toContain('return "not-mobile"');
    expect(FIXTURE_APP_SOURCE).toContain('data-testid="chat-transcript"');
    expect(FIXTURE_APP_SOURCE).toContain("<ChatMessageRow");
    expect(FIXTURE_APP_SOURCE).toContain("<ChatComposer");
  });

  it("aligns empty-state and Composer to one transcript measure without a second scroll root", () => {
    expect(CHAT_SOURCE).toContain("phy-layout-transcript-max-width");
    expect(CHAT_SOURCE).toContain('class="chat-header-inner"');
    expect(CHAT_SOURCE).toMatch(
      /\.chat-header-inner \{[\s\S]*?width: min\(100%, var\(--phy-layout-transcript-max-width\)\)/
    );
    expect(CHAT_SOURCE).toMatch(
      /\.transcript-content \{[\s\S]*?width: min\(100%, var\(--phy-layout-transcript-max-width\)\)/
    );
    expect(CHAT_SOURCE).toContain('class="empty-chat"');
    expect(CHAT_SOURCE).toContain('class="input-container"');
    expect(CHAT_SOURCE).toMatch(
      /\.message-container \{[\s\S]*?overflow-y: auto;/
    );
    const emptyChatBlock = CHAT_SOURCE.slice(
      CHAT_SOURCE.indexOf(".empty-chat {"),
      CHAT_SOURCE.indexOf(".input-container {")
    );
    const inputBlock = CHAT_SOURCE.slice(
      CHAT_SOURCE.indexOf(".input-container {"),
      CHAT_SOURCE.indexOf(".message-user {")
    );
    expect(emptyChatBlock).not.toContain("overflow-y");
    expect(inputBlock).not.toContain("overflow-y");
    expect(CHAT_COMPOSER_SOURCE).toContain(
      "var(--phy-layout-transcript-max-width)"
    );
  });
});
