import { describe, expect, it } from "vitest";

import {
  primaryExecutionActivitySurface,
  usesLegacyTaskLog,
} from "@/views/chat/executionLogPolicy";

describe("execution log policy", () => {
  it("uses capability-backed execution activity as the primary Gene Network surface", () => {
    expect(
      primaryExecutionActivitySurface({
        tool: "GeneNetworkAgent",
        hasExecutionRun: true,
        workTraceSupported: true,
      })
    ).toBe("execution");
    expect(usesLegacyTaskLog("GeneNetworkAgent")).toBe(false);
  });

  it.each(["AnalystAgent", "InSilicoResearchAgent"] as const)(
    "retains %s legacy task-log compatibility when execution activity is absent",
    (tool) => {
      expect(usesLegacyTaskLog(tool)).toBe(true);
      expect(
        primaryExecutionActivitySurface({
          tool,
          hasExecutionRun: false,
          workTraceSupported: false,
        })
      ).toBe("legacy_log");
    }
  );

  it("never fabricates an empty trace surface from capability alone", () => {
    expect(
      primaryExecutionActivitySurface({
        tool: "GeneNetworkAgent",
        hasExecutionRun: false,
        workTraceSupported: true,
      })
    ).toBe("none");
  });
});
