import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { nextTick } from "vue";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import SendProgress from "@/views/chat/components/SendProgress.vue";
import { createTestAppContext } from "../helpers/test-app-context";

const PROGRESS_SOURCE = readFileSync(
  resolve(__dirname, "../../src/views/chat/components/SendProgress.vue"),
  "utf8"
);

type SendProgressProps = {
  startedAt: number | null;
  agentName: string;
  completing: boolean;
  stageLabel?: string;
  forceLastStage?: boolean;
};

function fillScalePct(el: HTMLElement): number {
  const match = el.style.transform.match(/scaleX\(([\d.]+)\)/);
  return match ? Number(match[1]) * 100 : Number.NaN;
}

function mountProgress(
  props: SendProgressProps,
  locale: "en-US" | "zh-CN" = "en-US"
) {
  const context = createTestAppContext({ locale });
  return {
    wrapper: context.mount(SendProgress, {
      props,
    }),
    i18n: context.i18n,
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
    const widthPct = fillScalePct(bar.element as HTMLElement);
    expect(widthPct).toBeGreaterThan(40);
    expect(widthPct).toBeLessThanOrEqual(98);
  });

  it("shows the graph-derived Chat stage for the current half-life", async () => {
    const now = Date.now();
    const { wrapper } = mountProgress({
      startedAt: now,
      agentName: "ChatAgent",
      completing: false,
    });
    vi.advanceTimersByTime(10_000);
    await nextTick();
    expect(wrapper.find('[data-test="progress-label"]').text()).toBe(
      "Writing the answer"
    );
    const pctText = wrapper.find('[data-test="progress-percent"]').text();
    expect(pctText).toMatch(/^\d+%$/);
    expect(Number.parseInt(pctText, 10)).toBeGreaterThanOrEqual(40);
    expect(Number.parseInt(pctText, 10)).toBeLessThanOrEqual(98);
  });

  it("reveals graph steps in a collapsible chain and flushes the rest on complete", async () => {
    const now = Date.now();
    const { wrapper } = mountProgress({
      startedAt: now,
      agentName: "ChatAgent",
      completing: false,
    });
    expect(wrapper.find('[data-test="progress-cot"]').exists()).toBe(true);
    expect(wrapper.findAll(".send-progress__cot-item")).toHaveLength(1);
    expect(
      wrapper
        .find('[data-test="progress-cot-current"] .send-progress__cot-copy')
        .text()
    ).toBe("Preparing conversation context...");
    expect(wrapper.find('[data-test="progress-cot-spin"]').exists()).toBe(true);
    vi.advanceTimersByTime(10_000);
    await nextTick();
    expect(wrapper.findAll(".send-progress__cot-item")).toHaveLength(2);
    expect(
      wrapper
        .find('[data-test="progress-cot-current"] .send-progress__cot-copy')
        .text()
    ).toBe("Writing the answer...");
    await wrapper.setProps({ completing: true });
    vi.advanceTimersByTime(90);
    await nextTick();
    expect(wrapper.findAll(".send-progress__cot-item")).toHaveLength(3);
    expect(
      wrapper
        .find('[data-test="progress-cot-current"] .send-progress__cot-copy')
        .text()
    ).toBe("Preparing follow-up questions...");
    expect(wrapper.emitted("flushed")?.length).toBe(1);
  });

  it("keeps the last revealed step current with a leading spinner while still waiting", async () => {
    const now = Date.now();
    const { wrapper } = mountProgress({
      startedAt: now,
      agentName: "ChatAgent",
      completing: false,
    });
    vi.advanceTimersByTime(30_000);
    await nextTick();
    const current = wrapper.find('[data-test="progress-cot-current"]');
    expect(wrapper.findAll(".send-progress__cot-item")).toHaveLength(3);
    expect(current.attributes("data-current")).toBe("true");
    expect(current.find('[data-test="progress-cot-spin"]').exists()).toBe(true);
    expect(current.find(".send-progress__cot-index").text()).toBe("3.");
    expect(current.find(".send-progress__cot-copy").text()).toBe(
      "Preparing follow-up questions..."
    );
    expect(wrapper.findAll('[data-test="progress-cot-spin"]')).toHaveLength(1);
  });

  it("drops the spinner after forceLastStage settles the list", async () => {
    const { wrapper } = mountProgress({
      startedAt: Date.now(),
      agentName: "ChatAgent",
      completing: false,
      forceLastStage: true,
    });
    await nextTick();
    const current = wrapper.find('[data-test="progress-cot-current"]');
    expect(current.attributes("data-current")).toBe("false");
    expect(wrapper.find('[data-test="progress-cot-spin"]').exists()).toBe(
      false
    );
  });

  it("shows every remaining graph step immediately when forceLastStage is set", async () => {
    const { wrapper } = mountProgress({
      startedAt: Date.now(),
      agentName: "ChatAgent",
      completing: false,
      forceLastStage: true,
    });
    await nextTick();
    expect(wrapper.findAll(".send-progress__cot-item")).toHaveLength(3);
    expect(wrapper.find('[data-test="progress-label"]').text()).toBe(
      "Preparing follow-up questions"
    );
    expect(wrapper.emitted("flushed")?.length).toBe(1);
  });

  it("jumps to 100% when completing is true", async () => {
    const { wrapper } = mountProgress({
      startedAt: Date.now(),
      agentName: "ChatAgent",
      completing: true,
    });
    await nextTick();
    const bar = wrapper.find('[data-test="progress-fill"]');
    expect(fillScalePct(bar.element as HTMLElement)).toBe(100);
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
    expect(wrapper.find('[data-test="progress-eta"]').text()).toBe(
      "Usually 1–3 min"
    );
    expect(wrapper.text()).not.toMatch(/chat\.eta/);
  });

  it("shows the parent-supplied neutral agent-selection label", () => {
    const { wrapper } = mountProgress({
      startedAt: Date.now(),
      agentName: "",
      completing: false,
      stageLabel: "Selecting an agent…",
    });
    expect(wrapper.find('[data-test="progress-label"]').text()).toBe(
      "Selecting an agent…"
    );
  });

  it("shows a static eta range for chat and archive-class agents", () => {
    const chat = mountProgress({
      startedAt: Date.now(),
      agentName: "ChatAgent",
      completing: false,
    });
    expect(chat.wrapper.find('[data-test="progress-eta"]').text()).toBe(
      "Usually 5–30 seconds"
    );
    chat.wrapper.unmount();

    const design = mountProgress({
      startedAt: Date.now(),
      agentName: "DigitalDesignAgent",
      completing: false,
    });
    expect(design.wrapper.find('[data-test="progress-eta"]').text()).toBe(
      "Usually 12–48 hours"
    );
    expect(
      design.i18n.global.t("chat.progress.etaHours", { min: 12, max: 48 })
    ).toBe("Usually 12–48 hours");
    design.wrapper.unmount();
  });

  it("localizes the eta range with the processing copy", async () => {
    const { wrapper, i18n } = mountProgress({
      startedAt: Date.now(),
      agentName: "DeepGenomeAgent",
      completing: false,
    });
    expect(wrapper.find('[data-test="progress-eta"]').text()).toBe(
      "Usually 24–72 hours"
    );
    (i18n.global.locale as { value: string }).value = "zh-CN";
    await nextTick();
    expect(wrapper.find('[data-test="progress-eta"]').text()).toBe(
      "通常需要 24–72 小时"
    );
    wrapper.unmount();
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

  it("renders Quiet Lab Q+ETA: blue track, no green card chrome", () => {
    const styles = PROGRESS_SOURCE.slice(PROGRESS_SOURCE.indexOf("<style"));
    expect(styles).toContain("height: 3px");
    expect(styles).toContain("scaleX(0)");
    expect(styles).toContain("transform-origin: left center");
    expect(styles).toContain("var(--phy-color-brand-blue)");
    expect(styles).not.toContain("var(--phy-color-accent)");
    expect(styles).not.toContain("var(--phy-shadow-soft)");
    expect(styles).not.toContain("send-progress-pulse");
    expect(styles).toContain("prefers-reduced-motion");
    expect(styles).not.toMatch(/#[\da-f]{3,8}\b/i);
  });

  it("same-mount locale switch updates processing copy", async () => {
    const { wrapper, i18n } = mountProgress({
      startedAt: Date.now(),
      agentName: "ChatAgent",
      completing: false,
    });
    expect(wrapper.find('[data-test="progress-label"]').text()).toBe(
      "Preparing conversation context"
    );
    (i18n.global.locale as { value: string }).value = "zh-CN";
    await nextTick();
    expect(wrapper.find('[data-test="progress-label"]').text()).toBe(
      "正在整理对话上下文"
    );
    const root = wrapper.find('[data-test="send-progress"]');
    const nowVal = root.attributes("aria-valuenow");
    expect(root.attributes("aria-valuetext")).toBe(`处理中，${nowVal}%`);
  });
});
