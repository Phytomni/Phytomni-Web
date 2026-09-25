import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { vi } from "vitest";

vi.mock("@/views/analysis-agent/RemoteAnalysisAgentWorkspace.vue", () => ({
  default: {
    name: "RemoteAnalysisAgentWorkspace",
    props: ["tool", "localePrefix", "state"],
    template: '<section data-test="shared-analysis-workspace" />',
  },
}));

import AnalystAgentView from "@/views/analyst-agent/AnalystAgentView.vue";
import { createTestAppContext } from "../helpers/test-app-context";

describe("AnalystAgentView", () => {
  it("is a thin shared-workspace wrapper without static storage examples", () => {
    const source = readFileSync(
      resolve(__dirname, "../../src/views/analyst-agent/AnalystAgentView.vue"),
      "utf8"
    );

    expect(source).toContain("RemoteAnalysisAgentWorkspace");
    expect(source).toContain('tool="AnalystAgent"');
    expect(source).toContain('locale-prefix="agents.analyst"');
    expect(source).not.toMatch(/\/obs\//u);
    expect(source).not.toContain("callpeak_results.zip");
    expect(source).not.toContain("document.createElement");
  });

  it("passes the Analyst product contract to the shared workspace", () => {
    const wrapper = createTestAppContext().mount(AnalystAgentView, {});
    const workspace = wrapper.getComponent({
      name: "RemoteAnalysisAgentWorkspace",
    });

    expect(workspace.props()).toMatchObject({
      tool: "AnalystAgent",
      localePrefix: "agents.analyst",
    });
    wrapper.unmount();
  });
});
