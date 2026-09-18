import { describe, expect, it } from "vitest";
import { decodeChatHistory, decodeQueryData } from "@/api/types";
import { parseBotProjection } from "@/views/chat/botProjection";
import { findRemoteAgentHistorySnapshot } from "@/views/chat/composables/remoteAgentHistory";
import { artifactPreviewTitleKey } from "@/views/chat/utils/artifact-policy";
import golden from "../../../fixtures/report-integrity/public-projection.json";

describe("report integrity through public API decoding", () => {
  it.each(golden.cases)(
    "preserves $id report identity and warnings",
    ({ history }) => {
      for (const decoded of [
        decodeQueryData(history),
        ...decodeChatHistory([history]),
      ]) {
        const projection = parseBotProjection(decoded);
        expect(projection.reportRevision).toBe(
          history.projection.report_revision
        );
        expect(projection.reportWarningCodes).toEqual(
          history.projection.report_warning_codes
        );
        expect(projection.report).toMatchObject({
          state: history.projection.report.state,
          degraded: history.projection.report.degraded,
          sourceArtifactCount: history.projection.report.source_artifact_count,
        });
        expect(projection.finalReport).toBe(history.projection.final_report);
        expect(projection.intermediateReport).toBe(
          history.projection.intermediate_report
        );
        expect(decoded.projection?.resultArchiveV1).toBe(
          history.result_archive_v1 === true
        );
        expect(decoded.projection?.delivery).toEqual(decoded.delivery);
      }
    }
  );

  it("keeps the decoded partial history scientific rather than serializing its envelope", () => {
    const fixture = golden.cases.find(
      (entry) => entry.id === "partial-failed-deep-genome"
    );
    if (!fixture) throw new Error("Partial golden is missing");
    const row = {
      ...fixture.history,
      tool_name: "InSilicoResearchAgent",
      projection: { ...fixture.history.projection, agent: "research" },
    };
    const snapshot = findRemoteAgentHistorySnapshot(
      decodeChatHistory([row]),
      "InSilicoResearchAgent",
      row.bot_run_id,
      String(row.id),
      row.dialogue_id
    );
    expect(snapshot?.projection.intermediateReport).toBe(
      row.projection.intermediate_report
    );
    expect(snapshot?.projection.reportRevision).toBe(
      row.projection.report_revision
    );
  });

  it("validates the nested projection and discards unknown diagnostic fields", () => {
    const row = {
      id: 19,
      tool_name: "DigitalDesignAgent",
      answer: "",
      projection: {
        agent: "design",
        status: "SUCCEEDED",
        report: { state: "final", degraded: false, source_artifact_count: 1 },
        report_warning_codes: ["report_synthesis_failed", "private diagnostic"],
        private_field: "private diagnostic",
      },
    };
    expect(JSON.stringify(decodeQueryData(row))).not.toContain(
      "private diagnostic"
    );
    expect(() =>
      decodeQueryData({
        ...row,
        projection: {
          ...row.projection,
          report: { ...row.projection.report, source_artifact_count: -1 },
        },
      })
    ).toThrow();
  });

  it("uses terminal report facts ahead of a stale preview poller", () => {
    const message = {
      role: "assistant",
      id: "4000",
      tool_name: "DeepGenomeAgent",
      status: "FAILED",
      content: "",
      botProjection: parseBotProjection({
        agent: "DeepGenomeAgent",
        status: "FAILED",
        report_revision: 12,
        intermediate_report: "# Retained science",
      }),
    };
    expect(
      artifactPreviewTitleKey(message, { phase: "RUNNING", terminal: false })
    ).toBe("chat.botReport.partial");
  });
});
