import { describe, it, expect } from "vitest";
import { buildDisplayReferences } from "@/utils/reference-renderer";

const citation = { runs: [{ text: "Canonical title" }], links: [] };

describe("buildDisplayReferences — typed boundary", () => {
  it("returns no rows for empty or nullish lists", () => {
    for (const value of [[], null, undefined])
      expect(buildDisplayReferences(value, "test")).toEqual([]);
  });
  it("preserves canonical runs without reconstructing source metadata", () => {
    expect(
      buildDisplayReferences(
        [
          {
            citation,
            title: "file.pdf",
            au: "Wrong",
            formatted_citation: "<b>Wrong</b>",
          },
        ],
        "test"
      )
    ).toEqual([{ id: "test-ref-1", index: 1, citation }]);
  });
  it("keeps rejected members in original numbered slots without stringifying them", () => {
    const rows = buildDisplayReferences(
      [
        { citation },
        null,
        "<svg onload=x>",
        { title: "Old title" },
        { citation },
      ],
      "test"
    );
    expect(rows.map((row) => row.index)).toEqual([1, 2, 3, 4, 5]);
    expect(rows.map((row) => row.citation)).toEqual([
      citation,
      null,
      null,
      null,
      citation,
    ]);
    expect(rows.map((row) => row.id)).toEqual([
      "test-ref-1",
      "test-ref-2",
      "test-ref-3",
      "test-ref-4",
      "test-ref-5",
    ]);
  });
  it("does not restore malformed canonical data from formatted_citation", () => {
    expect(
      buildDisplayReferences(
        [
          {
            citation: { runs: "bad", links: [] },
            formatted_citation: "[x](javascript:alert(1))",
          },
        ],
        "m3"
      )[0].citation
    ).toBeNull();
  });
  it("preserves valid namespace characters and separates pages", () => {
    expect(buildDisplayReferences([{ citation }], "artifact_under")[0].id).toBe(
      "artifact_under-ref-1"
    );
    expect(buildDisplayReferences([{ citation }], "m3")[0].id).toBe("m3-ref-1");
  });
  it.each(["", 'a b"<x'])("rejects an invalid namespace %s", (ns) => {
    expect(() => buildDisplayReferences([{ citation }], ns)).toThrowError(
      "citation namespace is invalid"
    );
  });
});
