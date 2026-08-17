import { describe, expect, it } from "vitest";
import {
  GENERIC_REPORT_PLACEHOLDERS,
  PRODUCT_EMPTY_REPORT_PLACEHOLDERS,
  TOOL_REPORT_PLACEHOLDERS,
  isApprovedReportText,
  isDeepGenomeLedgerPlaceholder,
  matchesReportPlaceholder,
} from "@/views/chat/utils/valid-report-ledger";
import { artifactPresentationForMessage } from "@/views/chat/utils/artifact-policy";
import type { ChatMessage } from "@/views/chat/types";
import enUS from "@/locales/langs/en-US";
import zhCN from "@/locales/langs/zh-CN";

const REPORT_TOOLS = [
  "KnowledgeAgent",
  "BriefGeneAgent",
  "ReviewAgent",
  "AnalystAgent",
  "DeepGenomeAgent",
  "InSilicoResearchAgent",
  "DigitalDesignAgent",
  "GeneNetworkAgent",
] as const;

const genericExactValues = GENERIC_REPORT_PLACEHOLDERS.filter(
  (rule) => rule.match === "exact"
).map((rule) => rule.value);

const deepGenomeRules = TOOL_REPORT_PLACEHOLDERS.DeepGenomeAgent;

function reportMessage(
  tool_name: string,
  content: string,
  overrides: Partial<ChatMessage> = {}
): ChatMessage {
  return {
    role: "assistant",
    id: `${tool_name}-ledger`,
    tool_name,
    status: "FAILED",
    content,
    ...overrides,
  };
}

describe("valid report ledger", () => {
  it("encodes only the approved generic and DeepGenome placeholder sets", () => {
    expect(Object.keys(TOOL_REPORT_PLACEHOLDERS)).toEqual(["DeepGenomeAgent"]);
    expect(
      GENERIC_REPORT_PLACEHOLDERS.map((rule) => `${rule.match}:${rule.value}`)
    ).toEqual([
      "exact:PENDING",
      "exact:QUEUED",
      "exact:RUNNING",
      "exact:INPUT_REQUIRED",
      "exact:SUCCEEDED",
      "exact:FAILED",
      "exact:CANCELLED",
      "exact:CANCELED",
      "exact:TIMED_OUT",
      "exact:TIMEOUT",
      "exact:Sorry, I cannot answer this question.",
      "exact:Task created",
      "prefix:Task created:",
      "prefix:Task created successfully",
      "prefix:Tasks created successfully:",
      "prefix:Task submission failed:",
      "prefix:Server task created:",
      ...PRODUCT_EMPTY_REPORT_PLACEHOLDERS.map(
        (rule) => `${rule.match}:${rule.value}`
      ),
    ]);
    expect(
      deepGenomeRules.map((rule) => `${rule.match}:${rule.value}`)
    ).toEqual([
      "prefix:Server task created:",
      "exact:Loading file content...",
      "exact:Loading file content..",
      "exact:File content is empty or failed to load",
      "prefix:Failed to load file",
    ]);
  });

  it.each(genericExactValues)(
    "rejects generic placeholder %j for every report tool",
    (content) => {
      expect(
        matchesReportPlaceholder(content, GENERIC_REPORT_PLACEHOLDERS)
      ).toBe(true);
      for (const tool_name of REPORT_TOOLS) {
        expect(isApprovedReportText(tool_name, content)).toBe(false);
        expect(
          isApprovedReportText(tool_name, `  ${content.toLowerCase()}  `)
        ).toBe(false);
        expect(
          artifactPresentationForMessage(reportMessage(tool_name, content))
        ).toBeNull();
      }
    }
  );

  it.each([
    "Server task created: child-task-123",
    "server task created: child-task-123",
    "Loading file content...",
    "Loading file content..",
    "File content is empty or failed to load",
    "Failed to load file, please try again later",
    "failed to load file",
  ])("rejects the approved DeepGenome placeholder %j", (content) => {
    expect(isDeepGenomeLedgerPlaceholder(content)).toBe(true);
    expect(isApprovedReportText("DeepGenomeAgent", content)).toBe(false);
    expect(
      artifactPresentationForMessage(reportMessage("DeepGenomeAgent", content))
    ).toBeNull();
  });

  it.each(REPORT_TOOLS.filter((tool) => tool !== "DeepGenomeAgent"))(
    "does not apply DeepGenome placeholders to %s",
    (tool_name) => {
      const content = "Failed to load file, please try again later";
      expect(isApprovedReportText(tool_name, content)).toBe(true);
      expect(
        artifactPresentationForMessage(reportMessage(tool_name, content))
          ?.report
      ).toBe(content);
    }
  );

  it.each(REPORT_TOOLS)(
    "keeps a substantive failed %s report eligible",
    (tool_name) => {
      const content =
        "# Partial scientific report\n\nFailure occurred after evidence collection.";
      expect(isApprovedReportText(tool_name, content)).toBe(true);
      expect(
        artifactPresentationForMessage(
          reportMessage(tool_name, content, { status: "FAILED" })
        )
      ).toMatchObject({
        report: content,
        source: "message",
      });
    }
  );

  it("rejects the expert send fallback so a running Research row cannot look finished", () => {
    const content = "Sorry, I cannot answer this question.";
    expect(isApprovedReportText("InSilicoResearchAgent", content)).toBe(false);
    expect(
      artifactPresentationForMessage(
        reportMessage("InSilicoResearchAgent", content, { status: "RUNNING" })
      )
    ).toBeNull();
    for (const tool_name of REPORT_TOOLS) {
      expect(isApprovedReportText(tool_name, content)).toBe(false);
    }
  });

  it.each([
    "Task created",
    "Task created: child-1",
    "Task created successfully:d6470062-99ac-11f1-bbb4-fa163e7f72d1",
    "Tasks created successfully: child-1,child-2",
    "Task submission failed: missing task_id",
    "Task submission failed: no task ids",
    "Server task created: dg-child-1",
    "任务创建成功",
    "任务创建成功: dg-child-1",
  ])(
    "rejects transport acknowledgement %j for every report tool",
    (content) => {
      for (const tool_name of REPORT_TOOLS) {
        expect(isApprovedReportText(tool_name, content)).toBe(false);
        expect(
          artifactPresentationForMessage(
            reportMessage(tool_name, content, { status: "RUNNING" })
          )
        ).toBeNull();
      }
    }
  );

  it("harvests every agent emptyReport and DeepGenome noReferences string", () => {
    const harvested: string[] = [];
    for (const pack of [enUS, zhCN]) {
      const agents = (
        pack as { agents?: Record<string, Record<string, unknown>> }
      ).agents;
      if (!agents) continue;
      for (const agent of Object.values(agents)) {
        if (typeof agent.emptyReport === "string") {
          harvested.push(agent.emptyReport);
        }
        if (typeof agent.noReferences === "string") {
          harvested.push(agent.noReferences);
        }
        if (typeof agent.taskCreated === "string") {
          harvested.push(agent.taskCreated);
        }
      }
    }
    const encoded = new Set(
      PRODUCT_EMPTY_REPORT_PLACEHOLDERS.map((rule) => rule.value)
    );
    expect(harvested.sort()).toEqual([...encoded].sort());
    for (const content of harvested) {
      for (const tool_name of REPORT_TOOLS) {
        expect(isApprovedReportText(tool_name, content)).toBe(false);
      }
    }
  });

  it("never rejects useful text merely because it contains failed", () => {
    const content =
      "The alignment failed at locus 12 and was retried successfully.";
    for (const tool_name of REPORT_TOOLS) {
      expect(isApprovedReportText(tool_name, content)).toBe(true);
    }
  });

  it("preserves original report bytes after a validity trim check", () => {
    const content = "  # Final report\n\nPreserve bytes.  ";
    expect(
      artifactPresentationForMessage(
        reportMessage("KnowledgeAgent", "ignored", {
          botLifecycle: {
            runId: "run-ledger",
            status: "FAILED",
            reportRevision: 1,
            visibleReport: content,
            finalReport: content,
            intermediateReport: "",
            degraded: false,
            failures: [],
            artifacts: [],
          },
        })
      )?.report
    ).toBe(content);
  });
});
