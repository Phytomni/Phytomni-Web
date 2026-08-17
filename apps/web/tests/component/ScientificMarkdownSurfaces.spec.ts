import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { mountWithApp } from "../helpers/test-app-context";

import ScientificMarkdown from "@/components/ScientificMarkdown.vue";

const MARKDOWN_CSS = readFileSync(
  resolve(__dirname, "../../src/styles/markdown.css"),
  "utf8"
);
const SURFACE_CALLERS = [
  "../../src/components/CitedAnswer.vue",
  "../../src/components/DeepGenomeResultViewer.vue",
  "../../src/components/research/BotReportState.vue",
  "../../src/views/chat/components/ChatMessageContent.vue",
  "../../src/views/chat/components/blocks/MarkdownBlock.vue",
  "../../src/views/chat/components/blocks/ReasoningBlock.vue",
  "../../src/views/data-agent/DataAgentView.vue",
  "../../src/views/help/HelpView.vue",
] as const;

function cssRuleBody(selector: string): string {
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = MARKDOWN_CSS.match(
    new RegExp(`${escapedSelector}\\s*\\{([^}]*)\\}`, "s")
  );
  expect(match, `Missing Markdown CSS rule: ${selector}`).not.toBeNull();
  return match?.[1] ?? "";
}

describe("ScientificMarkdown completed surfaces", () => {
  it("uses explicit reading, chat, artifact, and document skins", () => {
    for (const surface of [
      "reading",
      "chat",
      "artifact",
      "document",
    ] as const) {
      const wrapper = mountWithApp(ScientificMarkdown, {
        props: {
          source: "Scientific result",
          citationNamespace: `surface-${surface}`,
          surface,
        },
      });
      expect(wrapper.classes()).toEqual(
        expect.arrayContaining(["phy-markdown", `phy-markdown--${surface}`])
      );
    }
  });

  it("defaults completed content to the reading surface", () => {
    const wrapper = mountWithApp(ScientificMarkdown, {
      props: {
        source: "Scientific result",
        citationNamespace: "surface-default",
      },
    });
    expect(wrapper.classes()).toContain("phy-markdown--reading");
    expect(wrapper.classes()).not.toContain("phy-markdown--legacy");
  });

  it("pins raw HTML off and sanitization on at the shared boundary", () => {
    const source = readFileSync(
      resolve(__dirname, "../../src/components/ScientificMarkdown.vue"),
      "utf8"
    );
    expect(source).toContain(':allow-html="false"');
    expect(source).toContain(':sanitize="true"');
  });

  it("keeps artifact and document overflow, font, and focus affordances", () => {
    const sharedSurface =
      ":is(.phy-markdown--artifact, .phy-markdown--document)";
    expect(cssRuleBody(`${sharedSurface} pre`)).toMatch(
      /overflow-x:\s*auto[\s\S]*overscroll-behavior-inline:\s*contain/
    );
    expect(cssRuleBody(`${sharedSurface} table`)).toMatch(
      /max-width:\s*100%[\s\S]*overflow-x:\s*auto/
    );
    expect(
      cssRuleBody(
        ".phy-markdown--artifact :is(.markdown-content, .markdown-body)"
      )
    ).toMatch(/font-family:\s*var\(--phy-font-reading\)/);
    expect(
      cssRuleBody(
        ".phy-markdown--document :is(.markdown-content, .markdown-body)"
      )
    ).toMatch(/font-family:\s*var\(--phy-font-shell\)/);
  });

  it("forces chat markdown to collapse whitespace so bubble pre-wrap cannot hide list bodies", () => {
    const chatRoot = cssRuleBody(
      ".md-block.phy-markdown--chat,\n.phy-markdown.phy-markdown--chat"
    );
    expect(chatRoot).toMatch(/white-space:\s*normal/);
    expect(chatRoot).toMatch(/white-space-collapse:\s*collapse/);
    expect(MARKDOWN_CSS).toMatch(
      /\.phy-markdown--chat \.elx-xmarkdown-container[\s\S]*white-space:\s*normal/
    );
  });

  it("forces artifact and document skins to collapse the same inherited pre-wrap", () => {
    const sharedRoot = cssRuleBody(
      ".phy-markdown--artifact,\n.phy-markdown--document"
    );
    expect(sharedRoot).toMatch(/white-space:\s*normal/);
    expect(sharedRoot).toMatch(/white-space-collapse:\s*collapse/);
    expect(MARKDOWN_CSS).toMatch(
      /:is\(\.phy-markdown--artifact, \.phy-markdown--document\)\s*:is\(\.elx-xmarkdown-container, \.elx-xmarkdown-provider\)[\s\S]*white-space:\s*normal/
    );
  });

  it("routes every completed caller to the scientific renderer without a legacy wrapper", () => {
    for (const path of SURFACE_CALLERS) {
      const source = readFileSync(resolve(__dirname, path), "utf8");
      expect(source).toContain("ScientificMarkdown");
      expect(source).not.toContain("MarkdownViewer");
    }
  });
});
