import { describe, expect, it } from "vitest";
import {
  decodeCitationDocuments,
  decodeTableDataInput,
  optionalStringValue,
  parseAgentAnswer,
} from "@/views/chat/utils/format";

describe("agent payload boundary decoders", () => {
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

  it("drops primitive citation rows and malformed table shapes", () => {
    expect(
      decodeCitationDocuments([{ title: "paper" }, "secret", null, []])
    ).toEqual([{ title: "paper" }]);
    expect(decodeTableDataInput({ headers: "secret", rows: [] })).toEqual({
      headers: [],
      rows: [],
    });
    expect(
      decodeTableDataInput({ headers: ["gene"], rows: [["At1"], "secret"] })
    ).toEqual({ headers: ["gene"], rows: [["At1"]] });
  });
});
