import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ref } from "vue";
import { useAgentsPanel } from "@/views/chat/composables/useAgentsPanel";

// Mock element-plus ElMessageBox — alert returning an empty object is enough to cover the showMoreInfo main path
vi.mock("element-plus", () => ({
  ElMessageBox: {
    alert: vi.fn(() => ({})),
  },
}));

import { ElMessageBox } from "element-plus";

const mockAlert = vi.mocked(ElMessageBox.alert);

// Characterization test — locks down the agents panel:
// presetAgents' eight items + eager t on the first item, click send-gating, scroll expand/collapse, tooltip key conversion.

describe("useAgentsPanel", () => {
  const t = (k: string) => k;

  function makeComposable(overrides?: {
    isSending?: ReturnType<typeof ref<boolean>>;
    router?: { push: ReturnType<typeof vi.fn> };
    scrollToBottom?: ReturnType<typeof vi.fn>;
  }) {
    const isSending = overrides?.isSending ?? ref(false);
    const router = overrides?.router ?? { push: vi.fn() };
    const scrollToBottom = overrides?.scrollToBottom ?? vi.fn();
    const panel = useAgentsPanel({
      t,
      isSending: isSending as any,
      router: router as any,
      scrollToBottom,
    });
    return { panel, isSending, router, scrollToBottom };
  }

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("presetAgents", () => {
    it("has 8 items, and the first item's name is the eagerly resolved t('chat.deepGenome')", () => {
      const { panel } = makeComposable();
      expect(panel.presetAgents.value).toHaveLength(8);
      // The first item uses the injected t, evaluated eagerly at ref creation time
      expect(panel.presetAgents.value[0].name).toBe("chat.deepGenome");
    });
  });

  describe("handleAgentClick", () => {
    it("isSending=false → router.push is called", () => {
      const { panel, router } = makeComposable();
      panel.handleAgentClick({ route: "/x" });
      expect(router.push).toHaveBeenCalledWith("/x");
    });

    it("isSending=true → router.push is no longer called (send gating in effect)", () => {
      const isSending = ref(false);
      const { panel, router } = makeComposable({ isSending });
      panel.handleAgentClick({ route: "/x" });
      expect(router.push).toHaveBeenCalledTimes(1);

      isSending.value = true;
      panel.handleAgentClick({ route: "/y" });
      expect(router.push).toHaveBeenCalledTimes(1);
    });
  });

  describe("handleScroll", () => {
    it("scroll down → expand (480px); after the animation window, scroll up → collapse (140px)", () => {
      vi.useFakeTimers();
      const { panel } = makeComposable();

      // Initial base height
      expect(panel.containerStyle.value.height).toBe("140px");

      // Scroll down → expand
      panel.handleScroll({ deltaY: 100 } as WheelEvent);
      expect(panel.containerStyle.value.height).toBe("480px");

      // Wait for the isAnimating gate to release (500ms)
      vi.advanceTimersByTime(500);

      // Scroll up → collapse
      panel.handleScroll({ deltaY: -100 } as WheelEvent);
      expect(panel.containerStyle.value.height).toBe("140px");
    });

    it("reverse scroll within the animation window is swallowed by the isAnimating gate (debounce)", () => {
      vi.useFakeTimers();
      const { panel } = makeComposable();

      // Scroll down → expand, and set isAnimating=true (500ms gate)
      panel.handleScroll({ deltaY: 100 } as WheelEvent);
      expect(panel.containerStyle.value.height).toBe("480px");

      // Before 500ms elapses: the reverse scroll should be swallowed by the gate, staying expanded
      panel.handleScroll({ deltaY: -100 } as WheelEvent);
      expect(panel.containerStyle.value.height).toBe("480px");

      // Only after advancing past the animation window does the reverse scroll take effect → collapse
      vi.advanceTimersByTime(500);
      panel.handleScroll({ deltaY: -100 } as WheelEvent);
      expect(panel.containerStyle.value.height).toBe("140px");
    });
  });

  describe("getAgentTooltip", () => {
    it("lowercases the first letter into a key → t('chat.agents.chatAgent')", () => {
      const { panel } = makeComposable();
      expect(panel.getAgentTooltip("ChatAgent")).toBe("chat.agents.chatAgent");
    });

    it("falls back to the raw agentName when t returns empty (|| fallback branch)", () => {
      const emptyT = (_k: string) => "";
      const panel = useAgentsPanel({
        t: emptyT,
        isSending: ref(false) as any,
        router: { push: vi.fn() } as any,
        scrollToBottom: vi.fn(),
      });
      expect(panel.getAgentTooltip("ChatAgent")).toBe("ChatAgent");
    });
  });

  describe("showMoreInfo", () => {
    it("calls ElMessageBox.alert", () => {
      const { panel } = makeComposable();
      panel.showMoreInfo("ChatAgent");
      expect(mockAlert).toHaveBeenCalledTimes(1);
    });
  });
});
