import { describe, it, expect } from "vitest";
import { formatLogContentWithColors } from "@/views/chat/utils/agent-log";

// 该函数的输出经 index.vue 的 v-html 注入 DOM,而日志正文是 analyst-agent
// 输出(agent/tool/RAG 可影响),故必须先 HTML 转义再做 ANSI→HTML 转换。
// 删除 escapeHtml 调用会让下面的 XSS 用例转红(回归锁)。
describe("formatLogContentWithColors", () => {
  it("空输入返回空串", () => {
    expect(formatLogContentWithColors("")).toBe("");
  });

  it("XSS 防护:<img onerror> 被转义,不产生裸 <img>/onerror", () => {
    const out = formatLogContentWithColors("<img src=x onerror=alert(1)>");
    expect(out).toContain("&lt;img");
    // 不得残留可被浏览器解析为元素的裸标签
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
