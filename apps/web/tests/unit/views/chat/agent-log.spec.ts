import { describe, it, expect } from "vitest";
import { formatLogContentWithColors } from "@/views/chat/utils/agent-log";

// This function's output is injected into the DOM via index.vue's v-html, and the
// log body is analyst-agent output (influenceable by agent/tool/RAG), so it must be
// HTML-escaped before the ANSI→HTML conversion. Removing the escapeHtml call would
// turn the XSS cases below red (regression lock).
describe("formatLogContentWithColors", () => {
  it("空输入返回空串", () => {
    expect(formatLogContentWithColors("")).toBe("");
  });

  it("XSS 防护:<img onerror> 被转义,不产生裸 <img>/onerror", () => {
    const out = formatLogContentWithColors("<img src=x onerror=alert(1)>");
    expect(out).toContain("&lt;img");
    // No bare tags that the browser could parse as elements may remain
    expect(out).not.toContain("<img");
    expect(out).not.toContain("onerror=alert(1)>");
  });

  it("XSS 防护:<script> 被转义为实体", () => {
    const out = formatLogContentWithColors("<script>alert(1)</script>");
    expect(out).toContain("&lt;script&gt;");
    expect(out).toContain("&lt;/script&gt;");
    expect(out).not.toContain("<script>");
  });

  it("合法 ANSI 红色仍渲染为 <span style>", () => {
    const out = formatLogContentWithColors("[31mred[0m");
    expect(out).toContain('<span style="color: #ff0000;">red</span>');
  });

  it("合法 ANSI 加粗仍渲染为 <strong>", () => {
    const out = formatLogContentWithColors("[1mbold[22m");
    expect(out).toContain("<strong>bold</strong>");
  });

  it("合法 ANSI 下划线仍渲染为 <u>", () => {
    const out = formatLogContentWithColors("[4munder[24m");
    expect(out).toContain("<u>under</u>");
  });
});
