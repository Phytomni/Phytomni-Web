import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  CANONICAL_AGENT_LABEL_I18N_KEYS,
  derivePickerOptions,
} from "@/constants/agents";

const SIDEBAR_SOURCE = readFileSync(
  resolve(__dirname, "../../../../src/views/chat/ChatSidebar.vue"),
  "utf8"
);

describe("canonical agent option ownership", () => {
  it("uses the canonical localized key for picker labels", () => {
    const [chatAgent] = derivePickerOptions(["ChatAgent"]);

    expect(chatAgent.labelKey).toBe(CANONICAL_AGENT_LABEL_I18N_KEYS.ChatAgent);
    expect(derivePickerOptions(["UnknownAgent"])).toEqual([]);
  });

  it("keeps the active sidebar as the owner of the formal Case list interaction", () => {
    expect(SIDEBAR_SOURCE).toContain("deriveCaseRouteOptions");
    expect(SIDEBAR_SOURCE).toContain("const showAgentsList = ref(false)");
    expect(SIDEBAR_SOURCE).toContain(
      "showAgentsList.value = !showAgentsList.value"
    );
    expect(SIDEBAR_SOURCE).toContain("router.push(agent.route)");
    expect(SIDEBAR_SOURCE).toContain("showAgentsList.value = false");
  });

  it("does not reintroduce the removed agent-panel HTML dialog path", () => {
    expect(SIDEBAR_SOURCE).not.toContain("dangerouslyUseHTMLString");
    expect(SIDEBAR_SOURCE).not.toContain("showMoreInfo");
  });
});
