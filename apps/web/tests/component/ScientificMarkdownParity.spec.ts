import { afterEach, describe, expect, it, vi } from "vitest";
import { nextTick } from "vue";
import ScientificMarkdown from "@/components/ScientificMarkdown.vue";
import MarkdownBlock from "@/views/chat/components/blocks/MarkdownBlock.vue";
import ReasoningBlock from "@/views/chat/components/blocks/ReasoningBlock.vue";
import StreamMessage from "@/views/chat/components/StreamMessage.vue";
import type { ContentBlock } from "@/views/chat/types";
import { mountWithApp } from "../helpers/test-app-context";

const REFERENCE_COUNT = 3;
const CITATION_NAMESPACE = "stream-parity";
const FIXTURE = [
  "| Gene | Score | Note |",
  "| :--- | ---: | :---: |",
  String.raw`| Os01g | 9.5 | escaped \| pipe and [1-3] |`,
  "",
  "```text",
  "<code stays literal>",
  "```",
  "",
  "Inline $x^2$ and display:",
  "",
  "$$E = mc^2$$",
  "",
  "<sup>[1-3]</sup> [2024](https://example.org/2024)",
  "",
  '<img src=x onerror="alert(1)"><script>alert(1)</script>',
].join("\n");

afterEach(() => vi.unstubAllGlobals());

function markdownBlock(text: string): ContentBlock {
  return { type: "markdown", authority: "web", text };
}

function semanticSignature(root: Element): string[] {
  return Array.from(
    root.querySelectorAll(
      "table, th, td, pre > code, .katex, .scientific-citation__link, a[href]"
    )
  ).map((node) => {
    const tag = node.tagName.toLowerCase();
    const href = node.getAttribute("href") ?? "";
    const align = node.getAttribute("align") ?? "";
    return `${tag}|${align}|${href}|${node.textContent?.trim() ?? ""}`;
  });
}

function assertSafeAndNonblank(root: Element, label = "") {
  expect(root.textContent?.trim().length, label).toBeGreaterThan(0);
  expect(
    root.querySelectorAll("script, img, [onerror], [onclick]")
  ).toHaveLength(0);
}

describe("ScientificMarkdown parity across AG-UI streaming surfaces", () => {
  it("keeps direct, chunked, live-stream, and hydrated sources semantically aligned", async () => {
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    });
    vi.stubGlobal("cancelAnimationFrame", () => undefined);
    const direct = mountWithApp(ScientificMarkdown, {
      props: {
        source: FIXTURE,
        surface: "chat",
        citationNamespace: CITATION_NAMESPACE,
        referenceCount: REFERENCE_COUNT,
      },
    });
    const chunked = mountWithApp(MarkdownBlock, {
      props: {
        block: markdownBlock(""),
        ns: CITATION_NAMESPACE,
        referenceCount: REFERENCE_COUNT,
        streaming: false,
      },
    });
    const live = mountWithApp(StreamMessage, {
      props: {
        blocks: [markdownBlock(FIXTURE)],
        ns: CITATION_NAMESPACE,
        references: undefined,
        streaming: true,
      },
    });
    const hydrated = mountWithApp(StreamMessage, {
      props: {
        blocks: [markdownBlock(FIXTURE)],
        ns: CITATION_NAMESPACE,
        references: [{ title: "One" }, { title: "Two" }, { title: "Three" }],
        streaming: false,
      },
    });

    for (const chunk of [FIXTURE.slice(0, 39), FIXTURE.slice(0, 93), FIXTURE]) {
      await chunked.setProps({ block: markdownBlock(chunk) });
    }
    await live.setProps({
      references: [{ title: "One" }, { title: "Two" }, { title: "Three" }],
    });
    await nextTick();
    await vi.dynamicImportSettled();

    const expected = semanticSignature(direct.element);
    for (const wrapper of [chunked, live, hydrated]) {
      assertSafeAndNonblank(wrapper.element);
      expect(semanticSignature(wrapper.element)).toEqual(expected);
    }

    const directCitation = direct.get(".scientific-citation__link");
    await directCitation.trigger("click");
    expect(direct.emitted("citation-activate")).toEqual([
      [{ namespace: CITATION_NAMESPACE, indices: [1, 2, 3] }],
    ]);
    expect(hydrated.findAll(".scientific-citation__link")).toHaveLength(2);
  });

  it("keeps incomplete parser boundaries visible, inert, and convergent", async () => {
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    });
    vi.stubGlobal("cancelAnimationFrame", () => undefined);
    const direct = mountWithApp(ScientificMarkdown, {
      props: {
        source: FIXTURE,
        surface: "chat",
        citationNamespace: CITATION_NAMESPACE,
        referenceCount: REFERENCE_COUNT,
      },
    });
    const stream = mountWithApp(MarkdownBlock, {
      props: {
        block: markdownBlock("seed"),
        ns: CITATION_NAMESPACE,
        referenceCount: REFERENCE_COUNT,
        streaming: true,
      },
    });

    const fencedCode = mountWithApp(MarkdownBlock, {
      props: {
        block: markdownBlock("```text\n$$ remains code\n```"),
        streaming: true,
      },
    });
    await vi.dynamicImportSettled();
    expect(
      fencedCode.find(".scientific-markdown__stream-fallback").exists()
    ).toBe(false);
    expect(fencedCode.get("code").text()).toContain("$$ remains code");

    const inlineCode = mountWithApp(MarkdownBlock, {
      props: {
        block: markdownBlock("`$$ remains code`\n$$E ="),
        streaming: true,
      },
    });
    expect(
      inlineCode.find(".scientific-markdown__stream-fallback").exists()
    ).toBe(true);

    for (const partial of [
      "| Gene | Score |\n| :--- |",
      "```text\npartial",
      "Inline $x",
      "$$E =",
      "Evidence [1-",
      "<sup>[1-",
    ]) {
      await stream.setProps({ block: markdownBlock(partial) });
      await nextTick();
      await vi.dynamicImportSettled();
      assertSafeAndNonblank(stream.element, partial);
      if (partial === "$$E =") {
        expect(stream.get(".scientific-markdown__stream-fallback").text()).toBe(
          "$$E ="
        );
      }
      expect(stream.html()).not.toContain("<script");
      expect(stream.findAll("[onerror], [onclick]")).toHaveLength(0);
    }

    await stream.setProps({ block: markdownBlock(FIXTURE), streaming: false });
    await nextTick();
    await vi.dynamicImportSettled();
    expect(semanticSignature(stream.element)).toEqual(
      semanticSignature(direct.element)
    );
  });

  it("keeps collapsed standalone reasoning hidden while its display math is incomplete", async () => {
    const reasoning = mountWithApp(ReasoningBlock, {
      props: {
        block: { type: "reasoning", authority: "web", text: "$$E =" },
        streaming: true,
      },
    });

    expect(reasoning.find(".reasoning-toggle").exists()).toBe(true);
    expect(
      reasoning.find(".scientific-markdown__stream-fallback").exists()
    ).toBe(false);

    await reasoning.get(".reasoning-toggle").trigger("click");
    expect(reasoning.get(".scientific-markdown__stream-fallback").text()).toBe(
      "$$E ="
    );
  });
});
