import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import ChatMessageRow from "@/views/chat/components/ChatMessageRow.vue";
import { mountWithApp } from "../helpers/test-app-context";

const CHAT_SOURCE = readFileSync(
  resolve(__dirname, "../../src/views/chat/ChatView.vue"),
  "utf8"
);
const ROW_SOURCE = readFileSync(
  resolve(__dirname, "../../src/views/chat/components/ChatMessageRow.vue"),
  "utf8"
);
const CONTENT_SOURCE = readFileSync(
  resolve(__dirname, "../../src/views/chat/components/ChatMessageContent.vue"),
  "utf8"
);
const TOKENS_SOURCE = readFileSync(
  resolve(__dirname, "../../src/styles/tokens.css"),
  "utf8"
);

const countOccurrences = (source: string, needle: string) =>
  source.split(needle).length - 1;

/** Strip Vue SFC <style> blocks for CSS-contract assertions. */
const styleBlocks = (source: string) =>
  [...source.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/g)].map((m) => m[1]);

const mountRow = (
  props: Record<string, unknown> = {},
  slots: Record<string, unknown> = {}
) =>
  mountWithApp(ChatMessageRow, {
    props: {
      role: "assistant",
      ...props,
    },
    slots,
    global: {
      stubs: {
        ElAvatar: {
          name: "ElAvatar",
          props: ["size", "src"],
          template:
            '<div class="el-avatar-stub" :data-src="src" :data-size="size" />',
        },
      },
    },
  });

describe("ChatMessageRow", () => {
  it("applies user/assistant/loading/streaming classes and role data hook", () => {
    const user = mountRow({ role: "user" });
    expect(user.attributes("data-testid")).toBe("chat-message-row");
    expect(user.classes()).toContain("message");
    expect(user.classes()).toContain("user");
    expect(user.attributes("data-message-role")).toBe("user");

    const assistant = mountRow({ role: "assistant" });
    expect(assistant.classes()).toContain("assistant");
    expect(assistant.attributes("data-message-role")).toBe("assistant");

    const loading = mountRow({ role: "assistant", loading: true });
    expect(loading.classes()).toContain("loading");
    expect(loading.classes()).toContain("assistant");

    const streaming = mountRow({ role: "assistant", streaming: true });
    expect(streaming.classes()).toContain("streaming");
  });

  it("opts only explicitly wide assistant rows into the full-width layout", () => {
    const regular = mountRow({ role: "assistant" });
    expect(regular.props("wide")).toBe(false);
    expect(regular.classes()).not.toContain("wide");

    const wideAssistant = mountRow({ role: "assistant", wide: true });
    expect(wideAssistant.props("wide")).toBe(true);
    expect(wideAssistant.classes()).toContain("wide");

    const wideUser = mountRow({ role: "user", wide: true });
    expect(wideUser.classes()).not.toContain("wide");
  });

  it("shows the avatar for assistant rows and hides it for user rows", () => {
    const assistant = mountRow({ role: "assistant" });
    expect(assistant.find(".message-avatar").exists()).toBe(true);
    expect(assistant.find(".el-avatar-stub").exists()).toBe(true);

    const user = mountRow({ role: "user" });
    expect(user.find(".message-avatar").exists()).toBe(false);
  });

  it("renders default, activity, artifact, follow-up, and actions slots", () => {
    const wrapper = mountRow(
      { role: "assistant" },
      {
        default: '<div data-testid="slot-default">body</div>',
        activity: '<div data-testid="slot-activity">activity</div>',
        artifact: '<div data-testid="slot-artifact">artifact</div>',
        "follow-up": '<div data-testid="slot-follow-up">follow-up</div>',
        actions: '<div data-testid="slot-actions">actions</div>',
      }
    );

    expect(wrapper.find('[data-testid="slot-default"]').text()).toBe("body");
    expect(wrapper.find('[data-testid="slot-activity"]').text()).toBe(
      "activity"
    );
    expect(wrapper.find('[data-testid="slot-artifact"]').text()).toBe(
      "artifact"
    );
    expect(wrapper.find('[data-testid="slot-follow-up"]').text()).toBe(
      "follow-up"
    );
    expect(wrapper.find('[data-testid="slot-actions"]').text()).toBe("actions");
  });

  it("exposes an accessible role label hook for the row", () => {
    const wrapper = mountRow({ role: "assistant" });
    expect(wrapper.attributes("aria-label")).toBeTruthy();
    expect(wrapper.attributes("data-message-role")).toBe("assistant");
  });

  it("omits data-message-id for ID-less loading and streaming rows", () => {
    const loading = mountRow({ role: "assistant", loading: true });
    expect(loading.attributes("data-message-id")).toBeUndefined();
    expect(loading.props("messageId")).toBeUndefined();

    const streaming = mountRow({ role: "assistant", streaming: true });
    expect(streaming.attributes("data-message-id")).toBeUndefined();
    expect(streaming.props("messageId")).toBeUndefined();
  });

  it("sets data-message-id only when a real optional messageId is provided", () => {
    const withId = mountRow({ role: "assistant", messageId: "msg-42" });
    expect(withId.attributes("data-message-id")).toBe("msg-42");

    const withoutId = mountRow({ role: "assistant" });
    expect(withoutId.attributes()).not.toHaveProperty("data-message-id");
  });

  it("does not synthesize a fake message id for reaction or download consumers", () => {
    const loading = mountRow({ role: "assistant", loading: true });
    expect(loading.html()).not.toMatch(/data-message-id="/);
    expect(loading.props("messageId")).toBeUndefined();

    const streaming = mountRow({
      role: "assistant",
      streaming: true,
      messageId: undefined,
    });
    expect(streaming.html()).not.toMatch(/data-message-id="/);
  });

  it("integration: persisted and loading rows share ChatMessageRow", () => {
    expect(countOccurrences(CHAT_SOURCE, "<ChatMessageRow")).toBe(2);
    expect(CHAT_SOURCE).toMatch(
      /<ChatMessageRow[\s\S]*v-for="\(message, index\) in currentChat\.messages"/
    );
    expect(CHAT_SOURCE).toMatch(
      /<ChatMessageRow[\s\S]*v-if="\s*isSending &&\s*!getChatState\(currentChatId\)\.isStreaming &&\s*!hasActivePollableAssistantWait\s*"/
    );
    expect(CHAT_SOURCE).not.toContain('data-testid="chat-message-row"');
  });

  it("applies pale role bubble classes via Content and token-backed surfaces", () => {
    expect(CONTENT_SOURCE).toMatch(/phy-bubble-user/);
    expect(CONTENT_SOURCE).toMatch(/phy-bubble-assistant/);
    expect(CONTENT_SOURCE).toMatch(
      /message\.role === ['"]user['"]\s*\?\s*['"]phy-bubble-user/
    );

    const rowCss = styleBlocks(ROW_SOURCE).join("\n");
    expect(rowCss).toMatch(/\.phy-bubble-user/);
    expect(rowCss).toMatch(/\.phy-bubble-assistant/);
    expect(rowCss).toMatch(/max-width:\s*72%/);
    expect(rowCss).toMatch(/padding:\s*14px\s+16px/);
    expect(rowCss).toMatch(/padding:\s*10px\s+12px/);
    expect(rowCss).toMatch(/border-radius:\s*(16px|var\(--phy-radius-lg\))/);
    // Role alignment stays structural for forced-colors when fills are ignored.
    expect(rowCss).toMatch(/forced-colors:\s*active/);
    expect(rowCss).toMatch(/data-message-role|justify-content:\s*flex-end/);
  });

  it("keeps short assistant bubbles content-sized within the full row measure", () => {
    const rowCss = styleBlocks(ROW_SOURCE).join("\n");
    const assistantRule = rowCss.match(
      /:deep\(\.message-text\.phy-bubble-assistant\)\s*\{([^}]*)\}/
    )?.[1];

    expect(assistantRule).toBeTruthy();
    expect(assistantRule).toMatch(/width:\s*fit-content/);
    expect(assistantRule).toMatch(/max-width:\s*100%/);
    expect(assistantRule).not.toMatch(/(?:^|\n)\s*width:\s*100%/);
    expect(rowCss).toMatch(
      /&\.assistant\s*\{[\s\S]*?\.message-content\s*\{[\s\S]*?flex:\s*1\s+1\s+0/
    );
  });

  it("widens explicit assistant report surfaces without selector hacks", () => {
    const rowCss = styleBlocks(ROW_SOURCE).join("\n");
    expect(rowCss).toMatch(
      /&\.assistant\.wide\s*\{[\s\S]*?:deep\(\.message-text\.phy-bubble-assistant\)\s*\{[\s\S]*?width:\s*100%/
    );
    expect(rowCss).not.toMatch(/:has\(/);

    const wideBinding =
      /:wide="\s*message\.role === ['"]assistant['"]\s*&&\s*\(\s*message\.tool_name === ['"]DeepGenomeAgent['"]\s*\|\|\s*!!artifactPreviewForMessage\(message\)\s*\)\s*"/g;
    expect(CHAT_SOURCE.match(wideBinding)).toHaveLength(1);
  });

  it("keeps the 72 percent user cap inclusive of outer row spacing", () => {
    const rowCss = styleBlocks(ROW_SOURCE).join("\n");
    const sharedContentRule = rowCss.match(
      /\.message-content\s*\{([^}]*)\}\s*\}/
    )?.[1];

    expect(sharedContentRule).toBeTruthy();
    expect(sharedContentRule).toMatch(/box-sizing:\s*border-box/);
    expect(sharedContentRule).toMatch(/padding-bottom:\s*12px/);
    expect(sharedContentRule).not.toMatch(/padding:\s*0\s+12px/);
  });

  it("locks the exact pale light-theme role surfaces and subtle shadow", () => {
    expect(TOKENS_SOURCE).toMatch(/--phy-bubble-user-bg:\s*#eaf6f1/i);
    expect(TOKENS_SOURCE).toMatch(/--phy-bubble-user-border:\s*#cfe8dc/i);
    expect(TOKENS_SOURCE).toMatch(/--phy-bubble-assistant-bg:\s*#eaf2fe/i);
    expect(TOKENS_SOURCE).toMatch(/--phy-bubble-assistant-border:\s*#d5e5fc/i);
    expect(TOKENS_SOURCE).toMatch(
      /\.phy-bubble-(?:user|assistant)\s*\{[\s\S]*?box-shadow:\s*0\s+1px\s+2px\s+rgba\(20,\s*32,\s*27,\s*0\.03\)/
    );
  });

  it("keeps loading, attachment, and tip chrome on adaptive theme tokens", () => {
    const loadingCss = CHAT_SOURCE.slice(
      CHAT_SOURCE.indexOf(".loading-message {"),
      CHAT_SOURCE.indexOf(".doc-list-title {")
    );
    const attachmentCss = CHAT_SOURCE.slice(
      CHAT_SOURCE.indexOf(".message-files {"),
      CHAT_SOURCE.indexOf("::v-deep(.el-textarea__inner)")
    );
    const tipCss = CHAT_SOURCE.slice(
      CHAT_SOURCE.indexOf(".tip-text {"),
      CHAT_SOURCE.indexOf("/* Agents architecture diagram dialog styles */")
    );

    expect(loadingCss).toContain(
      "background-color: var(--phy-bubble-assistant-bg)"
    );
    expect(attachmentCss).toContain(
      "background-color: var(--phy-color-bg-elevated)"
    );
    expect(attachmentCss).toContain(
      "border: 1px solid var(--phy-color-border-subtle)"
    );
    expect(attachmentCss).toContain("color: var(--phy-color-text-secondary)");
    expect(tipCss).toContain("color: var(--phy-color-text-muted)");
    expect(`${loadingCss}${attachmentCss}${tipCss}`).not.toMatch(
      /#[0-9a-f]{3,8}\b/i
    );
  });

  it("contains wide markdown, tables, and images inside the message measure", () => {
    const contentCss = styleBlocks(CONTENT_SOURCE).join("\n");

    expect(contentCss).toMatch(
      /\.message-text\s*\{[\s\S]*?min-width:\s*0;[\s\S]*?max-width:\s*100%;[\s\S]*?overflow-x:\s*auto/
    );
    expect(contentCss).toMatch(
      /:deep\(pre\),[\s\S]*?:deep\(table\),[\s\S]*?:deep\(\.el-table\)[\s\S]*?max-width:\s*100%/
    );
    expect(contentCss).toMatch(
      /\.table-response\s*\{[\s\S]*?min-width:\s*0;[\s\S]*?max-width:\s*100%;[\s\S]*?overflow-x:\s*auto/
    );
    expect(contentCss).toMatch(/\.result-image\s*\{[\s\S]*?max-width:\s*100%/);
  });

  it("rejects glass, gradient, and raw alternate bubble fills on the row surface", () => {
    const rowCss = styleBlocks(ROW_SOURCE).join("\n");
    expect(rowCss).not.toMatch(/backdrop-filter/);
    expect(rowCss).not.toMatch(/linear-gradient|radial-gradient/);
    expect(rowCss).not.toMatch(/#409eff|#66b1ff|#1890ff/i);
    // No competing solid fills — utilities + tokens own pale greens/blues.
    expect(rowCss).not.toMatch(
      /background(-color)?:\s*#(?!eaf6f1|eaf2fe)[0-9a-f]{3,8}/i
    );
    // Index must not strip the utility shadow or re-own bubble padding/width.
    expect(CHAT_SOURCE).not.toMatch(
      /\.message-text[^{]*\{[^}]*box-shadow:\s*none/
    );
    expect(CHAT_SOURCE).not.toMatch(
      /\.message-text[^{]*\{[^}]*padding:\s*12px/
    );
  });
});
