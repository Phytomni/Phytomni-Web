import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import { nextTick, reactive } from "vue";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createI18n } from "vue-i18n";
import ChatActivity from "@/views/chat/components/ChatActivity.vue";
import type { ContentBlock } from "@/views/chat/types";
import { activityDisclosureStateKey } from "@/views/chat/streaming/presentation";

const ACTIVITY_SOURCE = readFileSync(
  resolve(__dirname, "../../src/views/chat/components/ChatActivity.vue"),
  "utf8"
);

const i18n = createI18n({
  legacy: false,
  locale: "en-US",
  messages: {
    "en-US": {
      chat: {
        activity: {
          label: "Activity",
          count: "{count}",
          status: { running: "In progress", done: "Done" },
        },
        tools: {
          knowledge_search: "Searching literature",
          generic: "Calling a tool",
        },
        steps: { retrieving: "Retrieving" },
        reasoning: { show: "Show reasoning", hide: "Hide reasoning" },
      },
    },
  },
});

type ChatActivityProps = {
  blocks?: ContentBlock[];
  stateKey?: string | null;
  expanded?: boolean;
  streaming?: boolean;
  ns?: string;
  label?: string;
  hideCount?: boolean;
};

function mountActivity(props: ChatActivityProps) {
  return mount(ChatActivity, {
    props,
    global: {
      plugins: [i18n],
    },
  });
}

describe("ChatActivity", () => {
  const blocks: ContentBlock[] = [
    { type: "tool", authority: "web", toolName: "knowledge_search" },
    { type: "step", authority: "web", label: "retrieving" },
    { type: "reasoning", authority: "web", text: "thinking…" },
  ];

  const stateKey = activityDisclosureStateKey("req-1", 0);
  const regionId = "chat-activity-stream%3Areq-1%3Aactivity-0";

  it("defaults closed with summary/count/status and controlled region id", () => {
    const w = mountActivity({
      blocks,
      stateKey,
      expanded: false,
      streaming: true,
    });
    const btn = w.find("button");
    expect(btn.exists()).toBe(true);
    expect(btn.attributes("aria-expanded")).toBe("false");
    expect(btn.attributes("aria-controls")).toBe(regionId);
    expect(w.text()).toContain("Activity");
    expect(w.text()).toContain("3");
    expect(w.text()).toContain("In progress");
    expect(w.find(".chat-activity__status").classes()).toContain("is-running");
    expect(w.find(".chat-activity__chevron").attributes("aria-hidden")).toBe(
      "true"
    );
    expect(w.find(".chat-activity__chevron").classes()).not.toContain(
      "is-expanded"
    );
    expect(w.find(`#${CSS.escape(regionId)}`).exists()).toBe(false);
    expect(w.find(".tool-block").exists()).toBe(false);
  });

  it("opens and closes via the disclosure button and emits update:expanded", async () => {
    const w = mountActivity({
      blocks,
      stateKey,
      expanded: false,
      streaming: false,
    });
    await w.find("button").trigger("click");
    expect(w.emitted("update:expanded")?.[0]).toEqual([true]);

    await w.setProps({ expanded: true });
    await nextTick();
    const region = w.find(`#${CSS.escape(regionId)}`);
    expect(region.exists()).toBe(true);
    expect(w.find("button").attributes("aria-expanded")).toBe("true");
    expect(w.find(".tool-block").exists()).toBe(true);
    expect(w.text()).toContain("Done");
    expect(w.find(".chat-activity__status").classes()).toContain("is-done");
    expect(w.find(".chat-activity__chevron").classes()).toContain(
      "is-expanded"
    );

    await w.find("button").trigger("click");
    expect(w.emitted("update:expanded")?.[1]).toEqual([false]);
  });

  it("restores expanded state when parent reopens the same controlled key (A→B→A)", async () => {
    const map = reactive<Record<string, boolean>>({ [stateKey]: true });
    const w = mountActivity({
      blocks,
      stateKey,
      expanded: map[stateKey] === true,
      streaming: false,
    });
    expect(w.find(".tool-block").exists()).toBe(true);

    await w.setProps({
      stateKey: activityDisclosureStateKey("other", 0),
      expanded: false,
    });
    expect(w.find(".tool-block").exists()).toBe(false);

    await w.setProps({ stateKey, expanded: map[stateKey] === true });
    expect(w.find(".tool-block").exists()).toBe(true);
  });

  it("missing state key renders safe content expanded with no disclosure control", () => {
    const w = mountActivity({
      blocks,
      stateKey: null,
      expanded: false,
      streaming: false,
    });
    expect(w.find("button").exists()).toBe(false);
    expect(w.findAll("[aria-expanded]")).toHaveLength(0);
    expect(w.find(".tool-block").exists()).toBe(true);
    expect(w.find(".step-block").exists()).toBe(true);
    expect(w.find(".reasoning-body").exists()).toBe(true);
  });

  it("passes withinActivity to reasoning and exposes exactly one disclosure control", async () => {
    const w = mountActivity({
      blocks,
      stateKey,
      expanded: true,
      streaming: false,
    });
    expect(w.findAll("button[aria-expanded]")).toHaveLength(1);
    expect(w.findAll("[aria-expanded]")).toHaveLength(1);
    expect(w.find("details").exists()).toBe(false);
    expect(w.find(".reasoning-toggle").exists()).toBe(false);
    expect(w.find(".reasoning-body").exists()).toBe(true);
  });

  it("supports label override, hideCount, and default slot body content", async () => {
    const w = mount(ChatActivity, {
      props: {
        blocks: [],
        stateKey: "log:42",
        expanded: true,
        label: "Execution log",
        hideCount: true,
      },
      slots: { default: '<div data-testid="slot-body">analyst body</div>' },
      global: { plugins: [i18n] },
    });
    expect(w.text()).toContain("Execution log");
    expect(w.text()).not.toMatch(/\b0\b/);
    expect(w.find("[data-testid='slot-body']").text()).toBe("analyst body");
  });

  it("uses semantic tokens for a compact timeline instead of nested cards", () => {
    const styles = ACTIVITY_SOURCE.slice(ACTIVITY_SOURCE.indexOf("<style"));
    expect(styles).toContain("max-width: min(100%, 42rem)");
    expect(styles).toContain("var(--phy-color-accent)");
    expect(styles).toContain("var(--phy-color-brand-blue)");
    expect(styles).toContain(":deep(.tool-block)");
    expect(styles).toContain(":deep(.step-block)");
    expect(styles).toContain(":deep(.reasoning-body)");
    expect(styles).toContain(
      ".chat-activity__body--forced :deep(.tool-block)::before"
    );
    expect(styles).not.toMatch(/#[\da-f]{3,8}\b/i);
  });
});
