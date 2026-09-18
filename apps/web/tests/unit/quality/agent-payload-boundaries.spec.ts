import { describe, expect, it } from "vitest";
import {
  decodeCitationDocuments,
  decodeTableDataInput,
  decodeTableMessagePresentation,
  optionalStringValue,
  parseAgentAnswer,
} from "@/views/chat/utils/format";

describe("agent payload boundary decoders", () => {
  it("accepts only complete finite scalar DataAgent message tables", () => {
    expect(
      decodeTableMessagePresentation(
        '{"headers":["gene","score"],"rows":[["Os01",0.5]]}'
      )
    ).toMatchObject({
      content: [{ gene: "Os01", score: 0.5 }],
      tableHeaders: [
        { prop: "gene", label: "gene" },
        { prop: "score", label: "score" },
      ],
    });
    expect(
      decodeTableMessagePresentation(
        '{"headers":["gene"],"rows":[["Os01",{"private":"value"}]]}'
      )
    ).toBeUndefined();
    expect(
      decodeTableMessagePresentation(
        '{"headers":["gene","score"],"rows":[["Os01"]]}'
      )
    ).toBeUndefined();
  });

  it.each([
    ["null", "null"],
    ["array", "[]"],
    ["number", "42"],
    ["malformed", "{not-json"],
  ])("fail closed for %s answer shapes", (_label, value) => {
    expect(parseAgentAnswer(value)).toEqual({});
  });

  it("keeps known object fields opaque and rejects non-string display values", () => {
    const answer = parseAgentAnswer(
      JSON.stringify({ content: "safe", token: "must-not-be-rendered" })
    );

    expect(optionalStringValue(answer, "content")).toBe("safe");
    expect(optionalStringValue(answer, "token")).toBe("must-not-be-rendered");
    expect(
      optionalStringValue({ content: { token: "secret" } }, "content")
    ).toBeUndefined();
  });

  it("retains rejected citation slots without exposing primitives and rejects malformed tables", () => {
    expect(
      decodeCitationDocuments([{ title: "paper" }, "secret", null, []])
    ).toEqual([
      { title: "paper", citation: null },
      { citation: null },
      { citation: null },
      { citation: null },
    ]);
    expect(decodeTableDataInput({ headers: "secret", rows: [] })).toEqual({
      headers: [],
      rows: [],
    });
    expect(
      decodeTableDataInput({ headers: ["gene"], rows: [["At1"], "secret"] })
    ).toEqual({ headers: ["gene"], rows: [["At1"]] });
  });
});
