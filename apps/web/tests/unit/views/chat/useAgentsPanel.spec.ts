import { describe, it, expect, vi, beforeEach } from "vitest";
import { useAgentsPanel } from "@/views/chat/composables/useAgentsPanel";

// Mock element-plus ElMessageBox — alert returning an empty object is enough to cover the showMoreInfo main path
vi.mock("element-plus", () => ({
  ElMessageBox: {
    alert: vi.fn(() => ({})),
  },
}));

import { ElMessageBox } from "element-plus";

const mockAlert = vi.mocked(ElMessageBox.alert);

describe("useAgentsPanel", () => {
  const t = (k: string) => k;

  function makeComposable() {
    const panel = useAgentsPanel({ t });
    return { panel };
  }

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("removed stage-only exports", () => {
    it("does not export permanent stage state or handlers", () => {
      const { panel } = makeComposable();

      expect(panel).not.toHaveProperty("presetAgents");
      expect(panel).not.toHaveProperty("containerStyle");
      expect(panel).not.toHaveProperty("handleScroll");
      expect(panel).not.toHaveProperty("handleAgentClick");
    });
  });

  describe("getAgentTooltip", () => {
    it("lowercases the first letter into a key → t('chat.agents.chatAgent')", () => {
      const { panel } = makeComposable();
      expect(panel.getAgentTooltip("ChatAgent")).toBe("chat.agents.chatAgent");
    });

    it("falls back to the raw agentName when t returns empty (|| fallback branch)", () => {
      const emptyT = (_k: string) => "";
      const panel = useAgentsPanel({ t: emptyT });
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
