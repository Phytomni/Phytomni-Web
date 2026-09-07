import { describe, expect, it } from "vitest";
import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import { transformScientificCitations } from "@/utils/scientific-markdown/citations";
import type { ScientificMarkdownNode as MdNode } from "@/utils/scientific-markdown/types";
import grammar from "../../../../../server/common/document_format/testdata/scientific-inline-grammar.json";

interface Run {
  text: string;
  bold?: boolean;
  italic?: boolean;
  vertical?: string;
  href?: string;
  code?: boolean;
}

function semantics(
  source: string,
  namespace = "grammar",
  referenceCount = 999
) {
  const tree = unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkMath)
    .parse(source) as unknown as MdNode;
  transformScientificCitations(tree, { namespace, referenceCount }, source);
  const runs: Run[] = [];
  const citationIndices: number[][] = [];
  function append(text: string, style: Omit<Run, "text">) {
    if (!text) return;
    const previous = runs.at(-1);
    const run = { text, ...style };
    if (
      previous &&
      ["bold", "italic", "vertical", "href", "code"].every(
        (key) => previous[key as keyof Run] === run[key as keyof Run]
      )
    )
      previous.text += text;
    else runs.push(run);
  }
  function walk(node: MdNode, style: Omit<Run, "text"> = {}) {
    const next = { ...style };
    if (node.type === "strong") next.bold = true;
    if (node.type === "emphasis" || node.data?.hName === "em")
      next.italic = true;
    if (node.data?.scientificVertical)
      next.vertical = String(node.data.scientificVertical);
    if (node.type === "link") next.href = String(node.url);
    if (node.type === "inlineCode") next.code = true;
    if (node.type === "scientificCitation") {
      const child = (node.data?.hChildren as MdNode[])[0];
      const properties = child.properties as { ariaLabel?: string } | undefined;
      const label =
        properties?.ariaLabel?.replace("Citation ", "") ?? child.value ?? "";
      if (properties?.ariaLabel)
        citationIndices.push(
          label.split(",").flatMap((part) => {
            const [start, end = start] = part.split("-").map(Number);
            return Array.from(
              { length: end - start + 1 },
              (_, index) => start + index
            );
          })
        );
      append(child.children?.[0]?.value ?? child.value ?? "", next);
    } else if (node.value !== undefined) append(node.value, next);
    else for (const child of node.children ?? []) walk(child, next);
  }
  walk(tree);
  return { runs, citationIndices };
}

describe("ordinary scientific inline grammar", () => {
  it.each(grammar)("shares decoded semantics: $name", (fixture) => {
    expect(semantics(fixture.source)).toEqual({
      runs: fixture.runs,
      citationIndices: fixture.citationIndices,
    });
  });

  it("formats ordinary scripts with zero references and an empty namespace", () => {
    expect(semantics("x<sup>2</sup> H<sub>2</sub>O", "", 0)).toEqual({
      runs: [
        { text: "x" },
        { text: "2", vertical: "superscript" },
        { text: " H" },
        { text: "2", vertical: "subscript" },
        { text: "O" },
      ],
      citationIndices: [],
    });
  });

  it.each([
    ["<sup>2 [2]\nOutside [3]", "<sup>2 [2]\nOutside 3"],
    ["<sup>2&#10;3 [2]\nOutside [3]", "<sup>2\n3 [2]\nOutside 3"],
    ["<sup>2&#13;3 [2]\r\nOutside [3]", "<sup>2\r3 [2]\r\nOutside 3"],
    ["<sup>\n2\n</sup>", "<sup>\n2\n</sup>"],
  ])(
    "keeps source-line recovery separate from decoded newlines: %s",
    (source, text) => {
      const result = semantics(source);
      expect(result.runs).toEqual([{ text }]);
      expect(result.citationIndices).toEqual(
        source.includes("Outside") ? [[3]] : []
      );
    }
  );

  it("recovers at the physical line inside a Markdown emphasis child", () => {
    const result = semantics("<sup>*first [2]\nOutside [3]*");
    expect(result.runs).toEqual([
      { text: "<sup>" },
      { text: "first [2]\nOutside 3", italic: true },
    ]);
    expect(result.citationIndices).toEqual([[3]]);
  });

  it("rejects a pair crossing emphasis boundaries but recovers at its closer", () => {
    const result = semantics("<sup>*2</sup>* [3]");
    expect(result.runs.map((run) => run.text).join("")).toBe("<sup>2</sup> 3");
    expect(result.citationIndices).toEqual([[3]]);
    expect(result.runs.every((run) => !run.vertical)).toBe(true);
  });

  it.each([
    ["<sup>$[2]$</sup> [3]", "<sup>[2]</sup> 3"],
    ["<sup>[2](https://example.org)</sup> [3]", "<sup>2</sup> 3"],
    [
      '<sup onmouseover="x"class="y">[2]</sup> [3]',
      '<sup onmouseover="x"class="y">[2]</sup> 3',
    ],
    ["<sup>2</sub> [3] </sup> [2]", "<sup>2</sub> 3 </sup> 2"],
    ["<sup>\n2\n</sup>\n\nAfter [3]", "<sup>\n2\n</sup>After 3"],
  ])(
    "preserves restricted or protected content without affecting later citations: %s",
    (source, text) => {
      const result = semantics(source);
      expect(result.runs.map((run) => run.text).join("")).toBe(text);
      expect(result.citationIndices).toEqual(
        source.includes("</sup> [2]") ? [[3], [2]] : [[3]]
      );
      expect(result.runs.every((run) => !run.vertical)).toBe(true);
    }
  );
});
