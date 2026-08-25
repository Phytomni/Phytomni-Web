import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import ExecutionWorkTrace from "@/views/chat/components/ExecutionWorkTrace.vue";
import type { ExecutionTraceResolution } from "@/views/chat/streaming/executionEvents";
import { createTestAppContext } from "../helpers/test-app-context";

function traceFixture(): ExecutionTraceResolution {
  const target = {
    kind: "trace" as const,
    id: "trc_A1b2C3d4E5f6G7h8",
  };
  return {
    schemaVersion: 1,
    target,
    health: "healthy",
    operation: {
      operationId: "op-analysis",
      operationKey: "remote.analysis",
      labelKey: "execution.operation.remote.analysis",
      fallbackLabel: "Internal analysis label",
      status: "running",
      startedAt: "2026-08-23T08:00:00Z",
      lastObservationAt: "2026-08-23T08:00:02Z",
      completedAt: null,
      durationMs: 2000,
      currentAttempt: 1,
      attempts: [],
      progress: null,
      detail: {},
      summary: null,
      target,
    },
    lastSemanticActivityAt: "2026-08-23T08:00:02Z",
    lastProviderContactAt: "2026-08-23T08:00:03Z",
    items: [
      {
        schemaVersion: 1,
        itemId: "item-reasoning",
        seq: 7,
        kind: "reasoning_summary",
        operationKey: "gene_network.target_validated",
        labelKey: "execution.trace.reasoning_summary",
        fallbackLabel: "Internal reasoning label",
        status: "running",
        attempt: 1,
        occurredAt: "2026-08-23T08:00:02Z",
        durationMs: null,
        progress: null,
        attempts: [],
        detail: {},
        summary: "Validated the trait target and species for network analysis.",
        target: null,
      },
    ],
    nextAfterSeq: 7,
    hasMore: false,
  };
}

describe("ExecutionWorkTrace accessibility", () => {
  it.each([
    ["en-US" as const, "Run analysis", "Reasoning summary"],
    ["zh-CN" as const, "运行分析", "推理摘要"],
  ])("renders localized semantic copy in %s", (locale, analysis, reasoning) => {
    const wrapper = createTestAppContext({ locale, elementPlus: false }).mount(
      ExecutionWorkTrace,
      { props: { trace: traceFixture() } }
    );
    expect(wrapper.text()).toContain(analysis);
    expect(wrapper.text()).toContain(reasoning);
    expect(wrapper.text()).not.toContain("Internal reasoning label");
  });

  it("labels live health and the feed and keeps native summary keyboard focus", () => {
    const wrapper = createTestAppContext({ elementPlus: false }).mount(
      ExecutionWorkTrace,
      { props: { trace: traceFixture() }, attachTo: document.body }
    );
    expect(wrapper.get("[role='status']").attributes("aria-live")).toBe(
      "polite"
    );
    expect(
      wrapper.get(".execution-work-trace__feed").attributes("aria-label")
    ).toBe("Analysis work trace");
    const summary = wrapper.get("summary");
    summary.element.focus();
    expect(document.activeElement).toBe(summary.element);
    wrapper.unmount();
  });

  it("retains a narrow-screen single-column layout", () => {
    const source = readFileSync(
      resolve(
        process.cwd(),
        "src/views/chat/components/ExecutionWorkTrace.vue"
      ),
      "utf8"
    );
    expect(source).toContain("@media (max-width: 640px)");
    expect(source).toContain("grid-template-columns: 1fr");
  });
});
