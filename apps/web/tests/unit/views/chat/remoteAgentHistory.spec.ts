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
        "run-research",
        "19",
        "dialogue-42"
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
        "run-research",
        "19",
        "dialogue-42"
      )
    ).toBeNull();
    expect(
      findRemoteAgentHistorySnapshot(
        [{ ...finalRow, bot_run_id: "run-foreign" }],
        "InSilicoResearchAgent",
        "run-research",
        "19",
        "dialogue-42"
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
        "run-research",
        "19",
        "dialogue-42"
      )
    ).toBeNull();
    expect(
      findRemoteAgentHistorySnapshot(
        [finalRow],
        "InSilicoResearchAgent",
        "run-research",
        "19",
        "dialogue-42"
      )?.projection
    ).toEqual(
      expect.objectContaining({
        status: "SUCCEEDED",
        finalReport: "Final report",
      })
    );
  });

  it("continues past an explicit dialogue mismatch and accepts legacy nullish dialogue", () => {
    const wrongDialogue = {
      ...baseRow,
      dialogue_id: "dialogue-foreign",
      status: "SUCCEEDED",
      answer: JSON.stringify({ final_report: "Foreign dialogue report" }),
    };
    const exactDialogue = {
      ...baseRow,
      status: "SUCCEEDED",
      answer: JSON.stringify({ final_report: "Exact dialogue report" }),
    };

    expect(
      findRemoteAgentHistorySnapshot(
        [wrongDialogue, exactDialogue],
        "InSilicoResearchAgent",
        "run-research",
        "19",
        "dialogue-42"
      )?.projection.finalReport
    ).toBe("Exact dialogue report");
    const absentDialogue = { ...exactDialogue } as Record<string, unknown>;
    delete absentDialogue.dialogue_id;
    for (const legacyRow of [
      absentDialogue,
      { ...exactDialogue, dialogue_id: undefined },
      { ...exactDialogue, dialogue_id: null },
    ]) {
      expect(
        findRemoteAgentHistorySnapshot(
          [legacyRow],
          "InSilicoResearchAgent",
          "run-research",
          "19",
          "dialogue-42"
        )?.dialogueId
      ).toBeNull();
    }
  });

  it.each([
    ["an empty string", "", "dialogue-42"],
    ["illegal characters", "dialogue/foreign", "dialogue-42"],
    ["an object", { id: "dialogue-42" }, "dialogue-42"],
    ["a safe number", 42, "42"],
    ["an unsafe number", Number.MAX_SAFE_INTEGER + 1, "dialogue-42"],
  ])(
    "skips a row with %s as its explicit dialogue identity",
    (_description, invalidDialogueId, expectedDialogueId) => {
      const invalidDialogue = {
        ...baseRow,
        dialogue_id: invalidDialogueId,
        status: "SUCCEEDED",
        answer: JSON.stringify({ final_report: "Invalid dialogue report" }),
      };
      const exactDialogue = {
        ...baseRow,
        dialogue_id: expectedDialogueId,
        status: "SUCCEEDED",
        answer: JSON.stringify({ final_report: "Exact dialogue report" }),
      };

      expect(
        findRemoteAgentHistorySnapshot(
          [invalidDialogue, exactDialogue],
          "InSilicoResearchAgent",
          "run-research",
          "19",
          expectedDialogueId
        )?.projection.finalReport
      ).toBe("Exact dialogue report");
    }
  );

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
      "run-research",
      "19",
      "dialogue-42"
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
        "run-research",
        "19",
        "dialogue-42"
      )
    ).toBeNull();
    for (const id of [0, -1, Number.MAX_SAFE_INTEGER + 1, "01", "unsafe"]) {
      expect(
        findRemoteAgentHistorySnapshot(
          [{ ...baseRow, id }],
          "InSilicoResearchAgent",
          "run-research",
          "19",
          "dialogue-42"
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
        "run-research",
        "19",
        "dialogue-42"
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
      "run-research",
      "19",
      "dialogue-42"
    );

    expect(snapshot?.projection.artifacts).toHaveLength(64);
    expect(snapshot?.projection.artifacts.at(-1)).toEqual({
      outputDir: "/obs/bucket/run-63",
      paths: ["/obs/bucket/run-63/result.txt"],
    });
  });
});
