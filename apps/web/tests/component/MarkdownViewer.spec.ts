import { describe, it, expect, vi } from "vitest";
import { mount } from "@vue/test-utils";

// The real vue-element-plus-x barrel eagerly imports aggregated CSS that the
// test transform can't load; the v-else path under test never renders
// Typewriter, so neutralize the module (and its CSS) with a bare stub.
vi.mock("vue-element-plus-x", () => ({
  Typewriter: { name: "Typewriter", template: "<div></div>" },
}));

import MarkdownViewer from "@/components/MarkdownViewer.vue";

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

  it("keeps long table/code/image overflow ownership on the chat surface", () => {
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
    // Pipeline still emits the same structural tags; overflow is CSS-owned on the skin.
    expect(w.find("img").attributes("onerror")).toBeUndefined();
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
