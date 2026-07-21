import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import PhyEmptyState from "@/components/shell/PhyEmptyState.vue";

const CHAT_SOURCE = readFileSync(
  resolve(__dirname, "../../src/views/chat/index.vue"),
  "utf8"
);
const CHAT_COMPOSER_SOURCE = readFileSync(
  resolve(__dirname, "../../src/views/chat/components/ChatComposer.vue"),
  "utf8"
);
const EMPTY_STATE_SOURCE = readFileSync(
  resolve(__dirname, "../../src/components/shell/PhyEmptyState.vue"),
  "utf8"
);
const CASES_SOURCE = readFileSync(
  resolve(__dirname, "../../src/views/chat/components/ChatCases.vue"),
  "utf8"
);
const transcriptStart = CHAT_SOURCE.indexOf('class="message-container"');
const transcriptEnd = CHAT_SOURCE.indexOf("<el-backtop", transcriptStart);
const TRANSCRIPT_SOURCE = CHAT_SOURCE.slice(transcriptStart, transcriptEnd);

describe("Chat empty state", () => {
  it("provides a stable mark/title/subtitle surface and tour anchors", () => {
    const wrapper = mount(PhyEmptyState, {
      props: {
        title: "Welcome",
        subtitle: "One line of explanation",
      },
      slots: {
        mark: '<span data-test="empty-mark">P</span>',
        default: '<button data-test="empty-content">Content</button>',
      },
    });

    expect(wrapper.find('[data-test="empty-mark"]').exists()).toBe(true);
    expect(wrapper.find(".phy-empty-state__title").text()).toBe("Welcome");
    expect(wrapper.find(".phy-empty-state__subtitle").text()).toBe(
      "One line of explanation"
    );
    expect(wrapper.find('[data-test="empty-content"]').exists()).toBe(true);
    expect(CHAT_SOURCE).toContain('ref="tourCasesTarget"');
    expect(CHAT_SOURCE).toContain("<ChatCases />");
    expect(CHAT_SOURCE).not.toContain("starterPrompts");
    expect(CHAT_SOURCE).not.toContain("<" + "Prompts");
    expect(CHAT_SOURCE).toContain(
      ':set-tour-input-target="setTourInputTarget"'
    );
    expect(CHAT_COMPOSER_SOURCE).toContain(':ref="bindTourInputTarget"');
    expect(CHAT_COMPOSER_SOURCE).toContain('class="chat-composer-surface"');
    expect(CHAT_COMPOSER_SOURCE).not.toContain(
      'class="input-container-warpper"'
    );
    const emptyStateStart = CHAT_SOURCE.indexOf(
      '<div v-if="!currentChat?.messages?.length" class="empty-chat">'
    );
    const composerStart = CHAT_SOURCE.indexOf("<ChatComposer", emptyStateStart);
    expect(CHAT_SOURCE.slice(emptyStateStart, composerStart)).not.toContain(
      "AgentsViewImg"
    );
  });

  it("keeps the empty and populated views as mutually exclusive transcript branches", () => {
    expect(
      TRANSCRIPT_SOURCE.match(/v-if="!currentChat\?\.messages\?\.length"/g)
    ).toHaveLength(1);
    expect(
      TRANSCRIPT_SOURCE.match(/v-if="currentChat\?\.messages\?\.length"/g)
    ).toHaveLength(1);
    expect(CHAT_SOURCE).toContain('data-test="chat-transcript-scroll-root"');
    expect(CHAT_SOURCE).toContain('class="transcript-content"');
    expect(CHAT_SOURCE).toContain(
      'v-for="(message, index) in currentChat.messages"'
    );
    expect(CHAT_SOURCE).toContain('data-testid="chat-content-stack"');
    expect(CHAT_SOURCE).toContain("'is-empty': chatStateAttr === 'empty'");
    expect(CHAT_SOURCE).toContain(
      "'is-populated': chatStateAttr === 'populated'"
    );
  });

  it("orders Welcome, Composer, and Cases without starter prompts", () => {
    const welcomeIndex = CHAT_SOURCE.indexOf("<PhyEmptyState");
    const composerIndex = CHAT_SOURCE.indexOf("<ChatComposer");
    const casesIndex = CHAT_SOURCE.indexOf("<ChatCases");

    expect(welcomeIndex).toBeGreaterThan(0);
    expect(composerIndex).toBeGreaterThan(welcomeIndex);
    expect(casesIndex).toBeGreaterThan(composerIndex);
    expect(CHAT_SOURCE).not.toContain("<" + "Prompts");
    expect(CHAT_SOURCE).not.toContain(["STARTER", "_PROMPTS"].join(""));
    expect(CHAT_SOURCE).not.toContain(["chat", "starter"].join("."));
  });

  it("targets the Cases region for the second tutorial step", () => {
    expect(CHAT_SOURCE).toContain('ref="tourCasesTarget"');
    expect(CHAT_SOURCE).toContain("<ChatCases />");
    expect(CHAT_SOURCE).toContain(':target="tourCasesTarget"');
  });

  it("keeps the empty state visual hierarchy", () => {
    expect(EMPTY_STATE_SOURCE).toContain(
      "font-size: clamp(1.5rem, 1.15rem + 0.75vw, 1.75rem)"
    );
    expect(EMPTY_STATE_SOURCE).toMatch(
      /@media \(max-width: 600px\)[\s\S]*?\.phy-empty-state__title \{[\s\S]*?font-size: 1\.375rem/
    );
    expect(EMPTY_STATE_SOURCE).toMatch(
      /\.phy-empty-state__title\s*\{[\s\S]*?text-wrap:\s*balance/
    );
    expect(EMPTY_STATE_SOURCE).toMatch(
      /\.phy-empty-state__subtitle\s*\{[\s\S]*?text-wrap:\s*balance/
    );

    const emptyChatBlock = CHAT_SOURCE.slice(
      CHAT_SOURCE.indexOf(".empty-chat {"),
      CHAT_SOURCE.indexOf(".input-container {")
    );
    expect(emptyChatBlock).toContain("justify-content: center");
    expect(emptyChatBlock).toContain(
      "width: min(100%, var(--phy-layout-transcript-max-width))"
    );
    expect(emptyChatBlock).toContain("padding: var(--phy-space-16)");
  });

  it("anchors Cases to the landing footer row on wide screens", () => {
    const casesRegionStart = CHAT_SOURCE.indexOf(".chat-cases-region {");
    const casesRegionEnd = CHAT_SOURCE.indexOf(
      "@media (max-width: 600px)",
      casesRegionStart
    );
    const casesRegionBlock = CHAT_SOURCE.slice(
      casesRegionStart,
      casesRegionEnd
    );

    expect(casesRegionBlock).toContain("margin-top: auto");
    expect(CASES_SOURCE).toContain(
      "grid-template-columns: repeat(4, minmax(0, 1fr))"
    );
    expect(CASES_SOURCE).toContain("@media (min-width: 1360px)");
    expect(CASES_SOURCE).toContain(
      "grid-template-columns: repeat(7, minmax(0, 1fr))"
    );
    expect(CASES_SOURCE).toContain("width: 100%;");
  });
});
