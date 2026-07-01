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
function render(content: string) {
  return mount(MarkdownViewer, {
    props: { content, instantMessage: false },
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

describe("MarkdownViewer citation linkification", () => {
  it("linkifies [N] and [N,M] markers into #ref anchors", () => {
    const html = render("See [1] and [2,3].").html();
    expect(html).toContain('href="#ref-1"');
    expect(html).toContain('href="#ref-2"');
    expect(html).toContain('href="#ref-3"');
  });

  it("treats [1](url) as a markdown link, not a citation (ordering)", () => {
    const html = render("[1](https://x.test)").html();
    expect(html).toContain('href="https://x.test"');
    expect(html).not.toContain("#ref-1");
  });

  it("keeps a smuggled tag inert (escapeHtml runs before linkification)", () => {
    const html = render("[<img onerror=alert(1)>]").html();
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;img");
  });
});
