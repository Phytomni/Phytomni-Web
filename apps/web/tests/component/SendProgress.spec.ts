import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mount } from "@vue/test-utils";
import SendProgress from "@/views/chat/components/SendProgress.vue";

describe("SendProgress.vue", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("grows the bar over time and never exceeds 99 while pending", async () => {
    // startedAt 略早于"现在",模拟已发送 1 个半衰期。
    const now = Date.now();
    const wrapper = mount(SendProgress, {
      props: { startedAt: now, agentName: "ChatAgent", completing: false },
    });
    vi.advanceTimersByTime(7500); // 一个 ChatAgent 半衰期
    await wrapper.vm.$nextTick();
    const bar = wrapper.find('[data-test="progress-fill"]');
    const widthPct = parseFloat((bar.element as HTMLElement).style.width);
    expect(widthPct).toBeGreaterThan(40);
    expect(widthPct).toBeLessThanOrEqual(99);
  });

  it("jumps to 100% when completing is true", async () => {
    const wrapper = mount(SendProgress, {
      props: { startedAt: Date.now(), agentName: "ChatAgent", completing: true },
    });
    await wrapper.vm.$nextTick();
    const bar = wrapper.find('[data-test="progress-fill"]');
    expect((bar.element as HTMLElement).style.width).toBe("100%");
  });

  it("shows the agent ETA copy", () => {
    const wrapper = mount(SendProgress, {
      props: { startedAt: Date.now(), agentName: "KnowledgeAgent", completing: false },
    });
    // 全局 i18n stub messages 为空 → $t 回显 key,断言 etaKey 已接线。
    expect(wrapper.text()).toContain("chat.eta.medium");
  });
});
