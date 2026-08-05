import { describe, expect, it } from "vitest";
import { findRemoteAgentHistorySnapshot } from "@/views/chat/composables/remoteAgentHistory";

const baseRow = {
  id: 19,
  dialogue_id: "dialogue-42",
  tool_name: "InSilicoResearchAgent",
  bot_run_id: "run-research",
  status: "RUNNING",
  report_revision: 1,
  answer: JSON.stringify({
    intermediate_report: "Intermediate report",
    report_stage: "intermediate",
  }),
};

describe("findRemoteAgentHistorySnapshot", () => {
  it("returns a bounded intermediate projection for the exact tool and run", () => {
    expect(
      findRemoteAgentHistorySnapshot(
        [
          {
            ...baseRow,
            download_path: "/obs/bucket/research",
            image_paths: JSON.stringify([
              "/obs/bucket/research/figure.png",
              "javascript:alert(1)",
            ]),
          },
        ],
        "InSilicoResearchAgent",
        "run-research"
      )
    ).toEqual({
      rowId: "19",
      dialogueId: "dialogue-42",
      projection: expect.objectContaining({
        runId: "run-research",
        agent: "InSilicoResearchAgent",
        status: "RUNNING",
        reportRevision: 1,
        intermediateReport: "Intermediate report",
        artifacts: [
          {
            outputDir: "/obs/bucket/research",
            paths: ["/obs/bucket/research/figure.png"],
          },
        ],
      }),
    });
  });

  it("returns a final projection without accepting a foreign tool or run", () => {
    const finalRow = {
      ...baseRow,
      status: "SUCCEEDED",
      answer: JSON.stringify({ final_report: "Final report" }),
    };

    expect(
      findRemoteAgentHistorySnapshot(
        [{ ...finalRow, tool_name: "DigitalDesignAgent" }],
        "InSilicoResearchAgent",
        "run-research"
      )
    ).toBeNull();
    expect(
      findRemoteAgentHistorySnapshot(
        [{ ...finalRow, bot_run_id: "run-foreign" }],
        "InSilicoResearchAgent",
        "run-research"
      )
    ).toBeNull();
    expect(
      findRemoteAgentHistorySnapshot(
        [
          {
            ...finalRow,
            bot_run_id: "run-foreign",
            answer: JSON.stringify({
              bot_run_id: "run-research",
              final_report: "Conflicting report",
            }),
          },
        ],
        "InSilicoResearchAgent",
        "run-research"
      )
    ).toBeNull();
    expect(
      findRemoteAgentHistorySnapshot(
        [finalRow],
        "InSilicoResearchAgent",
        "run-research"
      )?.projection
    ).toEqual(
      expect.objectContaining({
        status: "SUCCEEDED",
        finalReport: "Final report",
      })
    );
  });

  it("hydrates v1 delivery and opaque artifact links without legacy OBS paths", () => {
    const snapshot = findRemoteAgentHistorySnapshot(
      [
        {
          ...baseRow,
          status: "SUCCEEDED",
          download_path: "/obs/private/research",
          image_paths: JSON.stringify(["/obs/private/research/results.tsv"]),
          artifacts: [
            { id: "archive-1", name: "research-results.zip", kind: "archive" },
          ],
          answer: JSON.stringify({
            final_report: "Final report",
            result_archive_v1: true,
            delivery: {
              schema_version: 1,
              required: true,
              status: "ready",
              revision: 1,
              name: "research-results.zip",
              size_bytes: 1024,
              error_code: null,
              retryable: false,
            },
          }),
        },
      ],
      "InSilicoResearchAgent",
      "run-research"
    );

    expect(snapshot?.delivery?.name).toBe("research-results.zip");
    expect(snapshot?.artifactLinks).toEqual([
      { id: "archive-1", name: "research-results.zip", kind: "archive" },
    ]);
    expect(snapshot?.projection.artifacts).toEqual([]);
    expect(JSON.stringify(snapshot)).not.toContain("/obs/private");
  });

  it("rejects malformed answers and unsafe Web row identities", () => {
    expect(
      findRemoteAgentHistorySnapshot(
        [{ ...baseRow, answer: { report_revision: "not-an-integer" } }],
        "InSilicoResearchAgent",
        "run-research"
      )
    ).toBeNull();
    for (const id of [0, -1, Number.MAX_SAFE_INTEGER + 1, "01", "unsafe"]) {
      expect(
        findRemoteAgentHistorySnapshot(
          [{ ...baseRow, id }],
          "InSilicoResearchAgent",
          "run-research"
        )
      ).toBeNull();
    }
  });

  it("does not scan beyond the bounded history window", () => {
    const rows = Array.from({ length: 64 }, (_, index) => ({
      ...baseRow,
      id: index + 1,
      tool_name: "DigitalDesignAgent",
    }));
    rows.push(baseRow);

    expect(
      findRemoteAgentHistorySnapshot(
        rows,
        "InSilicoResearchAgent",
        "run-research"
      )
    ).toBeNull();
  });

  it("bounds server-returned artifact arrays before projection", () => {
    const outputDirs = Array.from(
      { length: 65 },
      (_, index) => `/obs/bucket/run-${index}`
    );
    const snapshot = findRemoteAgentHistorySnapshot(
      [
        {
          ...baseRow,
          download_path: JSON.stringify(outputDirs),
          image_paths: JSON.stringify(
            outputDirs.map((directory) => `${directory}/result.txt`)
          ),
        },
      ],
      "InSilicoResearchAgent",
      "run-research"
    );

    expect(snapshot?.projection.artifacts).toHaveLength(64);
    expect(snapshot?.projection.artifacts.at(-1)).toEqual({
      outputDir: "/obs/bucket/run-63",
      paths: ["/obs/bucket/run-63/result.txt"],
    });
  });
});
