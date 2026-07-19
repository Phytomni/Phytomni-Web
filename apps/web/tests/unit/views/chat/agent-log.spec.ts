import { describe, it, expect } from "vitest";
import { formatLogContentWithColors } from "@/views/chat/utils/agent-log";

// This function's output is injected into the DOM via index.vue's v-html, and the
// log body is analyst-agent output (influenceable by agent/tool/RAG), so it must be
// HTML-escaped before the ANSI→HTML conversion. Removing the escapeHtml call would
// turn the XSS cases below red (regression lock).
describe("formatLogContentWithColors", () => {
  it("empty input returns an empty string", () => {
    expect(formatLogContentWithColors("")).toBe("");
  });

  it("XSS protection: <img onerror> is escaped, producing no bare <img>/onerror", () => {
    const out = formatLogContentWithColors("<img src=x onerror=alert(1)>");
    expect(out).toContain("&lt;img");
    // No bare tags that the browser could parse as elements may remain
    expect(out).not.toContain("<img");
    expect(out).not.toContain("onerror=alert(1)>");
  });

  it("XSS protection: <script> is escaped into entities", () => {
    const out = formatLogContentWithColors("<script>alert(1)</script>");
    expect(out).toContain("&lt;script&gt;");
    expect(out).toContain("&lt;/script&gt;");
    expect(out).not.toContain("<script>");
  });

  it("valid ANSI red still renders as <span style>", () => {
    const out = formatLogContentWithColors("[31mred[0m");
    expect(out).toContain('<span style="color: #ff0000;">red</span>');
  });

  it("replaces repeated ANSI color sequences globally", () => {
    const out = formatLogContentWithColors("[32mgreen[0m and [32magain[0m");
    expect(out).toBe(
      '<span style="color: #00ff00;">green</span> and <span style="color: #00ff00;">again</span>'
    );
  });

  it("valid ANSI bold still renders as <strong>", () => {
    const out = formatLogContentWithColors("[1mbold[22m");
    expect(out).toContain("<strong>bold</strong>");
  });

  it("valid ANSI underline still renders as <u>", () => {
    const out = formatLogContentWithColors("[4munder[24m");
    expect(out).toContain("<u>under</u>");
  });
});
