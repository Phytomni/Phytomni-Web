import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const AGENT_DEMO_SHELL_SOURCE = readFileSync(
  resolve(__dirname, "../../../src/components/demo/AgentDemoShell.vue"),
  "utf8"
);

describe("retired media agent demonstrations", () => {
  it("keeps media artifacts within the shared fluid artifact measure", () => {
    expect(AGENT_DEMO_SHELL_SOURCE).toContain(
      "width: min(100%, var(--phy-layout-artifact-wide-max-width));"
    );
    expect(AGENT_DEMO_SHELL_SOURCE).not.toContain(
      "width: min(100%, clamp(1040px"
    );
  });

  it("does not retain the old Gene Network static download demonstration", () => {
    const source = readFileSync(
      resolve(
        __dirname,
        "../../../src/views/gene-network-agent/GeneNetworkAgentView.vue"
      ),
      "utf8"
    );

    expect(source).not.toContain("AgentDemoShell");
    expect(source).not.toContain("/static/downloads/");
    expect(source).not.toContain("sampleTask");
    expect(source).not.toContain("downloadResults");
    expect(source).toContain("useBotRemoteAgentRun");
    expect(source).toContain('tool: "GeneNetworkAgent"');
  });
});
