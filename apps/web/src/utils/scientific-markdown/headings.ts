import type { Plugin } from "unified";
import type { ScientificHeading } from "./types";

interface HastNode {
  type: string;
  tagName?: string;
  value?: string;
  properties?: Record<string, unknown>;
  children?: HastNode[];
}

function headingText(node: HastNode): string {
  if (node.type === "text") return node.value ?? "";
  return (node.children ?? []).map(headingText).join("");
}

function slugify(text: string): string {
  return (
    text
      .normalize("NFKD")
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, "-")
      .replace(/^-+|-+$/g, "") || "section"
  );
}

function isHeading(node: HastNode): node is HastNode & { tagName: string } {
  return Boolean(node.tagName && /^h[1-6]$/.test(node.tagName));
}

function isBlankText(node: HastNode): boolean {
  return node.type === "text" && !(node.value ?? "").trim();
}

/** Drop a heading that repeats the previous heading's visible text. */
export function collapseConsecutiveDuplicateHeadings(tree: HastNode): void {
  function visit(node: HastNode): void {
    if (!node.children) return;
    const next: HastNode[] = [];
    let lastHeadingText: string | null = null;
    for (const child of node.children) {
      if (isBlankText(child)) {
        next.push(child);
        continue;
      }
      if (isHeading(child)) {
        const text = headingText(child).replace(/\s+/g, " ").trim();
        if (lastHeadingText !== null && text === lastHeadingText) {
          continue;
        }
        lastHeadingText = text;
        visit(child);
        next.push(child);
        continue;
      }
      lastHeadingText = null;
      visit(child);
      next.push(child);
    }
    node.children = next;
  }
  visit(tree);
}

export function collectAndAssignHeadings(
  tree: HastNode,
  seen = new Map<string, number>()
): ScientificHeading[] {
  const headings: ScientificHeading[] = [];

  function visit(node: HastNode): void {
    if (isHeading(node)) {
      const text = headingText(node).replace(/\s+/g, " ").trim();
      const baseId = slugify(text);
      const count = (seen.get(baseId) ?? 0) + 1;
      seen.set(baseId, count);
      const id = count === 1 ? baseId : `${baseId}-${count}`;
      node.properties = { ...node.properties, id };
      headings.push({
        id,
        level: Number(node.tagName.slice(1)) as ScientificHeading["level"],
        text,
      });
    }
    for (const child of node.children ?? []) visit(child);
  }

  visit(tree);
  return headings;
}

export const rehypeScientificHeadings: Plugin<
  [{ onHeadings: (headings: ScientificHeading[]) => void }]
> = function (options) {
  return (tree) => {
    collapseConsecutiveDuplicateHeadings(tree as HastNode);
    const headings = collectAndAssignHeadings(tree as HastNode, new Map());
    queueMicrotask(() =>
      options.onHeadings(headings.map((heading) => ({ ...heading })))
    );
  };
};
