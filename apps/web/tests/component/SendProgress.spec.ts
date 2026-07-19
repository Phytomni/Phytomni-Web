import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mount } from "@vue/test-utils";
import { nextTick } from "vue";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createI18n } from "vue-i18n";
import SendProgress from "@/views/chat/components/SendProgress.vue";
import enUS from "@/locales/langs/en-US";
import zhCN from "@/locales/langs/zh-CN";

const PROGRESS_SOURCE = readFileSync(
  resolve(__dirname, "../../src/views/chat/components/SendProgress.vue"),
  "utf8"
);

function mountProgress(
  props: Record<string, unknown>,
  locale: "en-US" | "zh-CN" = "en-US"
) {
  const i18n = createI18n({
    legacy: false,
    locale,
    messages: {
      "en-US": enUS,
      "zh-CN": zhCN,
    },
  });
  return {
    wrapper: mount(SendProgress, {
      props: props as any,
      global: { plugins: [i18n] },
    }),
    i18n,
  };
}

describe("SendProgress.vue", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("grows the bar over time and never exceeds 98 while pending", async () => {
    const now = Date.now();
    const { wrapper } = mountProgress({
      startedAt: now,
      agentName: "ChatAgent",
      completing: false,
    });
    vi.advanceTimersByTime(7500);
    await nextTick();
    const bar = wrapper.find('[data-test="progress-fill"]');
    const widthPct = parseFloat((bar.element as HTMLElement).style.width);
    expect(widthPct).toBeGreaterThan(40);
    expect(widthPct).toBeLessThanOrEqual(98);
  });

  it("shows neutral processing label and integer percentage", async () => {
    const now = Date.now();
    const { wrapper } = mountProgress({
      startedAt: now,
      agentName: "ChatAgent",
      completing: false,
    });
    vi.advanceTimersByTime(7500);
    await nextTick();
    expect(wrapper.find('[data-test="progress-label"]').text()).toBe(
      "Processing"
    );
    const pctText = wrapper.find('[data-test="progress-percent"]').text();
    expect(pctText).toMatch(/^\d+%$/);
    expect(Number.parseInt(pctText, 10)).toBeGreaterThanOrEqual(40);
    expect(Number.parseInt(pctText, 10)).toBeLessThanOrEqual(98);
  });

  it("jumps to 100% when completing is true", async () => {
    const { wrapper } = mountProgress({
      startedAt: Date.now(),
      agentName: "ChatAgent",
      completing: true,
    });
    await nextTick();
    const bar = wrapper.find('[data-test="progress-fill"]');
    expect((bar.element as HTMLElement).style.width).toBe("100%");
    expect(wrapper.find('[data-test="progress-percent"]').text()).toBe("100%");
    const root = wrapper.find('[data-test="send-progress"]');
    expect(root.attributes("aria-valuenow")).toBe("100");
  });

  it("exposes progressbar min/max/now and valuetext", async () => {
    const now = Date.now();
    const { wrapper } = mountProgress({
      startedAt: now,
      agentName: "ChatAgent",
      completing: false,
    });
    vi.advanceTimersByTime(7500);
    await nextTick();
    const root = wrapper.find('[data-test="send-progress"]');
    expect(root.attributes("role")).toBe("progressbar");
    expect(root.attributes("aria-valuemin")).toBe("0");
    expect(root.attributes("aria-valuemax")).toBe("100");
    const nowVal = Number(root.attributes("aria-valuenow"));
    expect(nowVal).toBeGreaterThanOrEqual(40);
    expect(nowVal).toBeLessThanOrEqual(98);
    expect(root.attributes("aria-valuetext")).toBe(`Processing, ${nowVal}%`);
  });

  it("uses optional stage label without inferring from elapsed time", async () => {
    const { wrapper } = mountProgress({
      startedAt: Date.now(),
      agentName: "KnowledgeAgent",
      completing: false,
      stageLabel: "Searching literature",
    });
    vi.advanceTimersByTime(45_000);
    await nextTick();
    expect(wrapper.find('[data-test="progress-label"]').text()).toBe(
      "Searching literature"
    );
    expect(wrapper.text()).not.toMatch(/Usually|预计|chat\.eta/);
  });

  it("announces only the stage label in a polite live region", () => {
    const { wrapper } = mountProgress({
      startedAt: Date.now(),
      agentName: "ChatAgent",
      completing: false,
      stageLabel: "Retrieving",
    });
    const live = wrapper.find('[data-test="progress-label"]');
    expect(live.attributes("aria-live")).toBe("polite");
    const pct = wrapper.find('[data-test="progress-percent"]');
    expect(pct.attributes("aria-live")).toBeUndefined();
    expect(pct.attributes("aria-hidden")).toBe("true");
    expect(pct.element.tagName).toBe("SMALL");
    expect(
      live.element.compareDocumentPosition(pct.element) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
  });

  it("renders a thin semantic green-to-blue track with subdued fake percent", () => {
    const styles = PROGRESS_SOURCE.slice(PROGRESS_SOURCE.indexOf("<style"));
    expect(styles).toContain("height: 3px");
    expect(styles).toContain("linear-gradient(");
    expect(styles).toContain("var(--phy-color-accent)");
    expect(styles).toContain("var(--phy-color-primary)");
    expect(styles).toMatch(/\.send-progress__percent\s*\{[\s\S]*?opacity:/);
    expect(styles).not.toMatch(/#[\da-f]{3,8}\b/i);
  });

  it("same-mount locale switch updates processing copy", async () => {
    const { wrapper, i18n } = mountProgress({
      startedAt: Date.now(),
      agentName: "ChatAgent",
      completing: false,
    });
    expect(wrapper.find('[data-test="progress-label"]').text()).toBe(
      "Processing"
    );
    (i18n.global.locale as { value: string }).value = "zh-CN";
    await nextTick();
    expect(wrapper.find('[data-test="progress-label"]').text()).toBe("处理中");
    const root = wrapper.find('[data-test="send-progress"]');
    const nowVal = root.attributes("aria-valuenow");
    expect(root.attributes("aria-valuetext")).toBe(`处理中，${nowVal}%`);
  });
});
