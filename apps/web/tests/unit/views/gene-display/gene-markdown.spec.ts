import { describe, it, expect } from "vitest";
import { buildDisplayContent } from "@/views/gene-display/gene-markdown";

describe("buildDisplayContent", () => {
  it("strips the DOC TITLES section", () => {
    const raw =
      "# Gene\n\nBody text\n\n--- DOC TITLES ---\n1. Ref one\n2. Ref two";
    const out = buildDisplayContent(raw);
    expect(out).not.toContain("DOC TITLES");
    expect(out).not.toContain("Ref one");
    expect(out).toContain("Body text");
  });

  it("preserves real CRLF and LF as Markdown newlines", () => {
    const raw = "line1\r\nline2\nline3";
    const out = buildDisplayContent(raw);
    expect(out).toBe("line1\nline2\nline3");
    expect(out).not.toMatch(/\r/);
  });

  it("preserves a literal backslash-n sequence in source text", () => {
    const raw = String.raw`line1\nline2`;
    expect(buildDisplayContent(raw)).toBe(raw);
  });

  it("leaves a backend gene-image URL untouched (no client rewrite)", () => {
    const url = "/api/v1/gene-images/Os01g0107900/Os01g0107900_tree.png";
    const raw = `![tree](${url})`;
    const out = buildDisplayContent(raw);
    expect(out).toContain(url);
    expect(out).toContain("![tree](");
  });

  it("returns empty string for empty input", () => {
    expect(buildDisplayContent("")).toBe("");
  });
});
