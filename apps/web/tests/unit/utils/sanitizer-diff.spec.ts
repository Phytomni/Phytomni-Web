import { describe, it, expect } from "vitest";
import { diffSanitizers } from "@/utils/sanitizer-diff";

// A stub candidate renderer that passes raw HTML through unchanged models the
// worst case (allowHtml=true). The harness must flag it as looser than the
// current escape-first pipeline for a script payload.
const rawPassthrough = (md: string) => md;

describe("diffSanitizers", () => {
  it("flags a raw-passthrough candidate as looser on a script payload", () => {
    const d = diffSanitizers('<img src=x onerror="alert(1)">', rawPassthrough);
    expect(d.verdict).toBe("candidate-looser");
  });

  it("reports identical when candidate strips the same as current", () => {
    // A candidate that escapes exactly like the current pipeline.
    const escaper = (md: string) =>
      md.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const d = diffSanitizers("plain text no tags", escaper);
    expect(d.verdict).toBe("identical");
  });

  it("reports candidate-stricter when candidate strips more than current", () => {
    // A candidate that strips ALL HTML, even safe content the current pipeline keeps.
    const stripper = () => "plain text only";
    const d = diffSanitizers("![alt](https://example.com/img.png)", stripper);
    expect(d.verdict).toBe("candidate-stricter");
  });
});
