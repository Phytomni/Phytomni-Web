import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { mount } from "@vue/test-utils";

// The real vue-element-plus-x barrel eagerly imports aggregated CSS that the
// test transform can't load; the v-else path under test never renders
// Typewriter, so neutralize the module (and its CSS) with a bare stub.
vi.mock("vue-element-plus-x", () => ({
  Typewriter: { name: "Typewriter", template: "<div></div>" },
}));

import MarkdownViewer from "@/components/MarkdownViewer.vue";

const MARKDOWN_CSS = readFileSync(
  resolve(__dirname, "../../src/styles/markdown.css"),
  "utf8"
);
const CHAT_MESSAGE_CONTENT_SOURCE = readFileSync(
  resolve(
    __dirname,
    "../../src/views/chat/components/ChatMessageContent.vue"
  ),
  "utf8"
);

// Locks the static-render (v-else) v-html path. When instantMessage is falsy
// — history / already-finished agent messages — MarkdownViewer renders its own
// regex markdown straight through v-html, so agent-influenced content must be
// neutralized. (The live-typing path runs through Typewriter + DOMPurify, which
// is sanitized upstream and not exercised here.) Assertions read the REAL
// parsed DOM: if a breakout succeeded, jsdom would surface a live attribute.
function render(content: string, ns = "m0") {
  return mount(MarkdownViewer, {
    props: { content, instantMessage: false, ns },
    global: { stubs: { Typewriter: true } },
  });
}

describe("MarkdownViewer — XSS hardening of the v-html render path", () => {
  it("does not let an image URL break out into a live onerror attribute", () => {
    const w = render('![x](https://e.com" onerror="alert(1))');
    // The payload's quotes are entity-escaped up front, so onerror stays inside
    // the src value rather than becoming a separate, executable attribute.
    expect(w.find("img").attributes("onerror")).toBeUndefined();
  });

  it("neutralizes a javascript: link href to #", () => {
    const w = render("[click](javascript:alert(1))");
    expect(w.find("a").attributes("href")).toBe("#");
  });

  it("escapes a raw tag smuggled inside markdown emphasis", () => {
    const w = render("**<img src=x onerror=alert(1)>**");
    expect(w.find("img").exists()).toBe(false);
    expect(w.html()).toContain("&lt;img");
  });

  it("renders a benign link and image unharmed", () => {
    const w = render(
      "[doc](https://example.org/a) ![p](/attachments/p.png)"
    );
    expect(w.find("a").attributes("href")).toBe("https://example.org/a");
    expect(w.find("img").attributes("src")).toBe("/attachments/p.png");
  });
});

describe("MarkdownViewer surface classes", () => {
  it("defaults to legacy surface wrapper classes", () => {
    const w = render("hello");
    const root = w.find(".phy-markdown");
    expect(root.exists()).toBe(true);
    expect(root.classes()).toContain("phy-markdown--legacy");
    expect(root.classes()).not.toContain("phy-markdown--chat");
  });

  it("applies explicit chat surface classes without a renderer handoff", () => {
    const w = mount(MarkdownViewer, {
      props: { content: "hello", instantMessage: false, surface: "chat" },
      global: { stubs: { Typewriter: true } },
    });
    const root = w.find(".phy-markdown");
    expect(root.classes()).toContain("phy-markdown--chat");
    expect(root.classes()).not.toContain("phy-markdown--legacy");
  });

  it("keeps Typewriter on the chat surface without phy-reading", () => {
    const w = mount(MarkdownViewer, {
      props: { content: "hello", instantMessage: true, surface: "chat" },
      global: { stubs: { Typewriter: true } },
    });
    const root = w.find(".phy-markdown");
    expect(root.classes()).toContain("phy-markdown");
    expect(root.classes()).toContain("phy-markdown--chat");
    expect(root.classes()).not.toContain("phy-reading");
    expect(root.classes()).not.toContain("phy-markdown--legacy");
    expect(w.findComponent({ name: "Typewriter" }).exists()).toBe(true);
  });

  it("renders long chat-surface fixtures with structure + XSS intact; CSS owns overflow", () => {
    const fixture = [
      "# Long heading that should wrap inside the transcript measure",
      "",
      "- list item one",
      "- list item two",
      "",
      "```",
      "const wide = '" + "x".repeat(120) + "';",
      "```",
      "",
      "| a | b | c | d | e | f | g | h |",
      "| - | - | - | - | - | - | - | - |",
      "| 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 |",
      "",
      "![wide](https://example.org/p.png)",
    ].join("\n");
    const w = mount(MarkdownViewer, {
      props: { content: fixture, instantMessage: false, surface: "chat", ns: "m0" },
      global: { stubs: { Typewriter: true } },
    });
    const root = w.find(".phy-markdown.phy-markdown--chat");
    expect(root.exists()).toBe(true);
    expect(w.find("pre").exists()).toBe(true);
    expect(w.find("img").exists()).toBe(true);
    // Mount asserts structure + XSS intact; overflow ownership is a CSS contract.
    expect(w.find("img").attributes("onerror")).toBeUndefined();
    expect(MARKDOWN_CSS).toMatch(
      /\.phy-markdown--chat\s+pre\s*\{[^}]*overflow-x:\s*auto/
    );
    expect(MARKDOWN_CSS).toMatch(
      /\.phy-markdown--chat\s+table\s*\{[^}]*overflow-x:\s*auto/
    );
    expect(MARKDOWN_CSS).toMatch(
      /\.phy-markdown--chat\s+img\s*\{[^}]*max-width:\s*100%/
    );
  });

  it("keeps the chat skin compact and bounded by the message bubble", () => {
    expect(MARKDOWN_CSS).toMatch(
      /\.phy-markdown\.phy-markdown--chat\s*\{[^}]*width:\s*100%[^}]*max-width:\s*100%/
    );
    expect(MARKDOWN_CSS).toMatch(
      /\.phy-markdown--chat\s*>\s*:first-child[\s\S]*margin-top:\s*0/
    );
    expect(MARKDOWN_CSS).toMatch(
      /\.phy-markdown--chat\s*>\s*:last-child[\s\S]*margin-bottom:\s*0/
    );
    expect(MARKDOWN_CSS).toMatch(
      /\.phy-markdown--chat\s+pre\s+code\s*\{[^}]*white-space:\s*pre/
    );
    expect(MARKDOWN_CSS).not.toMatch(/#[0-9a-f]{3,8}/i);
  });

  it("keeps horizontal overflow on code and table surfaces, not the prose wrapper", () => {
    const nestedWrapper = MARKDOWN_CSS.match(
      /\/\* Nested content wrappers[\s\S]*?\{([^}]*)\}/
    )?.[1];
    expect(nestedWrapper).toBeDefined();
    expect(nestedWrapper).not.toMatch(/overflow-x:\s*auto/);
    expect(MARKDOWN_CSS).toMatch(
      /\.phy-markdown--chat\s+pre\s*\{[^}]*overscroll-behavior-inline:\s*contain/
    );
    expect(MARKDOWN_CSS).toMatch(
      /\.phy-markdown--chat\s+table\s*\{[^}]*overscroll-behavior-inline:\s*contain/
    );
  });

  it("tightens static-render line breaks without changing rendered markup", () => {
    const w = render("# Heading\nAlpha\nBeta\n## Next");
    expect(w.findAll("br")).toHaveLength(3);
    expect(MARKDOWN_CSS).toMatch(
      /\.phy-markdown--chat\s+\.markdown-content\s+br\s*\{[^}]*display:\s*inline/
    );
    expect(MARKDOWN_CSS).toContain(
      "br:has(+ :is(h1, h2, h3, h4, h5, h6, blockquote, pre, table, ul, ol))"
    );
    expect(MARKDOWN_CSS).toContain(".markdown-content li + br");
    expect(MARKDOWN_CSS).not.toMatch(/\+\s*br\s*\+\s*br/);
    expect(MARKDOWN_CSS).not.toMatch(/br:has\(\s*\+\s*br\s*\+/);
    expect(MARKDOWN_CSS).not.toContain("display: contents");
  });

  it("ChatMessageContent wires MarkdownViewer / CitedAnswer with surface chat", () => {
    expect(CHAT_MESSAGE_CONTENT_SOURCE).toMatch(
      /<CitedAnswer[\s\S]*?surface="chat"/
    );
    expect(CHAT_MESSAGE_CONTENT_SOURCE).toMatch(
      /<MarkdownViewer[\s\S]*?surface="chat"/
    );
  });
});

describe("MarkdownViewer citation linkification", () => {
  it("linkifies [N] and [N,M] markers into #ns-ref anchors", () => {
    const html = render("See [1] and [2,3].", "m0").html();
    expect(html).toContain('href="#m0-ref-1"');
    expect(html).toContain('href="#m0-ref-2"');
    expect(html).toContain('href="#m0-ref-3"');
  });

  it("treats [1](url) as a markdown link, not a citation (ordering)", () => {
    const html = render("[1](https://x.test)", "m0").html();
    expect(html).toContain('href="https://x.test"');
    expect(html).not.toContain("#m0-ref-1");
  });

  it("keeps a smuggled tag inert (escapeHtml runs before linkification)", () => {
    const html = render("[<img onerror=alert(1)>]", "m0").html();
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;img");
  });

  it("does NOT linkify when no ns is supplied (scope gate)", () => {
    const html = mount(MarkdownViewer, {
      props: { content: "See [1].", instantMessage: false },
      global: { stubs: { Typewriter: true } },
    }).html();
    expect(html).not.toContain("ref-1");
    expect(html).toContain("[1]");
  });
});
