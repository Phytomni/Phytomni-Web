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
    it("有 8 个条目，且首项 name 是 eager 解析的 t('chat.geneDetail')", () => {
      const { panel } = makeComposable();
      expect(panel.presetAgents.value).toHaveLength(8);
      // The first item uses the injected t, evaluated eagerly at ref creation time
      expect(panel.presetAgents.value[0].name).toBe("chat.geneDetail");
    });
  });

  describe("handleAgentClick", () => {
    it("isSending=false → router.push 被调用", () => {
      const { panel, router } = makeComposable();
      panel.handleAgentClick({ route: "/x" });
      expect(router.push).toHaveBeenCalledWith("/x");
    });

    it("isSending=true → router.push 不再被调用(发送门控生效)", () => {
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
    it("向下滚动 → 展开(480px);动画窗口后向上滚动 → 收起(140px)", () => {
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

    it("动画窗口内的反向滚动被 isAnimating 门控吞掉(去抖)", () => {
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
    it("首字母小写键转换 → t('chat.agents.chatAgent')", () => {
      const { panel } = makeComposable();
      expect(panel.getAgentTooltip("ChatAgent")).toBe("chat.agents.chatAgent");
    });

    it("t 返回空值时回退到原始 agentName(|| 兜底分支)", () => {
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
    it("调用 ElMessageBox.alert", () => {
      const { panel } = makeComposable();
      panel.showMoreInfo("ChatAgent");
      expect(mockAlert).toHaveBeenCalledTimes(1);
    });
  });
});
