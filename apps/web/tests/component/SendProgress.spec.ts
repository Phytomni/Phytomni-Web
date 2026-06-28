import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mount } from "@vue/test-utils";
import SendProgress from "@/views/chat/components/SendProgress.vue";

describe("SendProgress.vue", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("grows the bar over time and never exceeds 99 while pending", async () => {
    // startedAt is slightly earlier than "now", simulating one half-life elapsed since send.
    const now = Date.now();
    const wrapper = mount(SendProgress, {
      props: { startedAt: now, agentName: "ChatAgent", completing: false },
    });
    vi.advanceTimersByTime(7500); // one ChatAgent half-life
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
    // The global i18n stub has empty messages → $t echoes the key, asserting etaKey is wired up.
    expect(wrapper.text()).toContain("chat.eta.medium");
  });
});
