import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import ChatMessageRow from "@/views/chat/components/ChatMessageRow.vue";

const CHAT_SOURCE = readFileSync(
  resolve(__dirname, "../../src/views/chat/index.vue"),
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

const countOccurrences = (source: string, needle: string) =>
  source.split(needle).length - 1;

/** Strip Vue SFC <style> blocks for CSS-contract assertions. */
const styleBlocks = (source: string) =>
  [...source.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/g)].map((m) => m[1]);

const mountRow = (
  props: Record<string, unknown> = {},
  slots: Record<string, unknown> = {}
) =>
  mount(ChatMessageRow, {
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
      /<ChatMessageRow[\s\S]*v-if="isSending && !getChatState\(currentChatId\)\.isStreaming"/
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
    expect(rowCss).toMatch(/padding:\s*12px\s+14px/);
    expect(rowCss).toMatch(/border-radius:\s*(16px|var\(--phy-radius-lg\))/);
    // Role alignment stays structural for forced-colors when fills are ignored.
    expect(rowCss).toMatch(/forced-colors:\s*active/);
    expect(rowCss).toMatch(/data-message-role|justify-content:\s*flex-end/);
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
