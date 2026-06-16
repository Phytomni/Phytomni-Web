import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ref } from "vue";
import { useAgentsPanel } from "@/views/chat/composables/useAgentsPanel";

// Mock element-plus ElMessageBox —— alert 返回空对象足以覆盖 showMoreInfo 主路径
vi.mock("element-plus", () => ({
  ElMessageBox: {
    alert: vi.fn(() => ({})),
  },
}));

import { ElMessageBox } from "element-plus";

const mockAlert = vi.mocked(ElMessageBox.alert);

// 特征(characterization)测试 — 锁定智能体面板:
// presetAgents 八项 + 首项 eager t、点击发送门控、滚动展开/收起、提示键转换。

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
      // 首项使用注入的 t 在 ref 创建时即时求值
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

      // 初始基础高度
      expect(panel.containerStyle.value.height).toBe("140px");

      // 向下滚动 → 展开
      panel.handleScroll({ deltaY: 100 } as WheelEvent);
      expect(panel.containerStyle.value.height).toBe("480px");

      // 等待 isAnimating 门控释放(500ms)
      vi.advanceTimersByTime(500);

      // 向上滚动 → 收起
      panel.handleScroll({ deltaY: -100 } as WheelEvent);
      expect(panel.containerStyle.value.height).toBe("140px");
    });
  });

  describe("getAgentTooltip", () => {
    it("首字母小写键转换 → t('chat.agents.chatAgent')", () => {
      const { panel } = makeComposable();
      expect(panel.getAgentTooltip("ChatAgent")).toBe("chat.agents.chatAgent");
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
