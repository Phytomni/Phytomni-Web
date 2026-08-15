import { describe, expect, it } from "vitest";
import {
  GENERIC_REPORT_PLACEHOLDERS,
  TOOL_REPORT_PLACEHOLDERS,
  isApprovedReportText,
  isDeepGenomeLedgerPlaceholder,
  matchesReportPlaceholder,
} from "@/views/chat/utils/valid-report-ledger";
import { artifactPresentationForMessage } from "@/views/chat/utils/artifact-policy";
import type { ChatMessage } from "@/views/chat/types";

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
      GENERIC_REPORT_PLACEHOLDERS.every((rule) => rule.match === "exact")
    ).toBe(true);
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
