import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("retired media agent demonstrations", () => {
  it("does not retain the old Gene Network static download demonstration", () => {
    const source = readFileSync(
      resolve(__dirname, "../../../src/views/gene-network-agent/index.vue"),
      "utf8"
    );

    expect(source).not.toContain("AgentDemoShell");
    expect(source).not.toContain("/static/downloads/");
    expect(source).not.toContain("sampleTask");
    expect(source).not.toContain("downloadResults");
    expect(source).toContain('useBotRemoteAgentRun');
    expect(source).toContain('tool: "GeneNetworkAgent"');
  });
});
