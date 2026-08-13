import type { Plugin } from "unified";

export interface CitationOptions {
  namespace: string;
  referenceCount: number;
}

export interface ParsedCitation {
  display: string;
  indices: number[];
}

interface MdNode {
  type: string;
  value?: string;
  children?: MdNode[];
  data?: Record<string, unknown>;
  [key: string]: unknown;
}

interface MdParent extends MdNode {
  children: MdNode[];
}

const MAX_CITATION_INDEX = 999;
const MAX_EXPANDED_INDICES = 100;
const PROTECTED_NODE_TYPES = new Set([
  "inlineCode",
  "code",
  "link",
  "image",
  "inlineMath",
  "math",
]);

function normalizeCitationSource(source: string): string | null {
  const trimmed = source.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith("[") || trimmed.endsWith("]")) {
    if (!trimmed.startsWith("[") || !trimmed.endsWith("]")) return null;
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

export function parseCitationBody(source: string): ParsedCitation | null {
  const display = normalizeCitationSource(source);
  if (
    !display ||
    !/^\d{1,3}(?:-\d{1,3})?(?:,\d{1,3}(?:-\d{1,3})?)*$/.test(display)
  ) {
    return null;
  }

  const indices: number[] = [];
  const seen = new Set<number>();
  for (const segment of display.split(",")) {
    const [startSource, endSource] = segment.split("-");
    const start = Number(startSource);
    const end = endSource === undefined ? start : Number(endSource);
    if (
      start < 1 ||
      end < start ||
      end > MAX_CITATION_INDEX ||
      end - start + 1 > MAX_EXPANDED_INDICES
    ) {
      return null;
    }
    for (let index = start; index <= end; index += 1) {
      if (seen.has(index) || indices.length >= MAX_EXPANDED_INDICES)
        return null;
      seen.add(index);
      indices.push(index);
    }
  }

  return { display, indices };
}

function isInteractiveCitation(
  parsed: ParsedCitation,
  options: CitationOptions
): boolean {
  const namespace = options.namespace.replace(/[^A-Za-z0-9-]/g, "");
  return (
    Boolean(namespace) &&
    options.referenceCount > 0 &&
    parsed.indices.every((index) => index <= options.referenceCount)
  );
}

function citationNode(
  parsed: ParsedCitation,
  options: CitationOptions,
  display = `[${parsed.display}]`
): MdNode {
  const interactive = isInteractiveCitation(parsed, options);
  const namespace = options.namespace.replace(/[^A-Za-z0-9-]/g, "");
  const hChildren = interactive
    ? [
        {
          type: "element",
          tagName: "a",
          properties: {
            href: `#${namespace}-ref-${parsed.indices[0]}`,
            className: ["scientific-citation__link"],
            ariaLabel: `Citation ${parsed.display}`,
          },
          children: [{ type: "text", value: display }],
        },
      ]
    : [{ type: "text", value: display }];

  return {
    type: "scientificCitation",
    data: {
      hName: "sup",
      hProperties: { className: ["scientific-citation"] },
      hChildren,
    },
  };
}

function rewriteSupTriplets(parent: MdParent, options: CitationOptions): void {
  for (let index = 0; index <= parent.children.length - 3; index += 1) {
    const [open, body, close] = parent.children.slice(index, index + 3);
    if (
      open.type !== "html" ||
      open.value !== "<sup>" ||
      body.type !== "text" ||
      close.type !== "html" ||
      close.value !== "</sup>"
    ) {
      continue;
    }

    const parsed = parseCitationBody(body.value?.trim() ?? "");
    if (!parsed) continue;
    parent.children.splice(
      index,
      3,
      citationNode(parsed, options, body.value?.trim() ?? "")
    );
  }
}

function rewriteTextCitations(
  parent: MdParent,
  options: CitationOptions
): void {
  for (let index = 0; index < parent.children.length; index += 1) {
    const node = parent.children[index];
    const previous = parent.children[index - 1];
    const next = parent.children[index + 1];
    if (
      node.type !== "text" ||
      !node.value ||
      node.data?.scientificRawHtml ||
      previous?.data?.scientificRawHtml ||
      next?.data?.scientificRawHtml
    ) {
      continue;
    }

    const parts: MdNode[] = [];
    let offset = 0;
    const matcher = /\[(\d{1,3}(?:-\d{1,3})?(?:,\d{1,3}(?:-\d{1,3})?)*)\]/g;
    for (const match of node.value.matchAll(matcher)) {
      const matchIndex = match.index ?? 0;
      const parsed = parseCitationBody(match[0]);
      if (!parsed) continue;
      if (matchIndex > offset) {
        parts.push({
          type: "text",
          value: node.value.slice(offset, matchIndex),
        });
      }
      parts.push(citationNode(parsed, options));
      offset = matchIndex + match[0].length;
    }
    if (!parts.length) continue;
    if (offset < node.value.length) {
      parts.push({ type: "text", value: node.value.slice(offset) });
    }
    parent.children.splice(index, 1, ...parts);
    index += parts.length - 1;
  }
}

function rewriteHtmlNodes(parent: MdParent): void {
  for (const node of parent.children) {
    if (node.type === "html") {
      node.type = "text";
      node.data = { ...node.data, scientificRawHtml: true };
    }
  }
}

function visit(
  parent: MdParent,
  options: CitationOptions,
  protectedByAncestor = false
): void {
  const protectedHere =
    protectedByAncestor || PROTECTED_NODE_TYPES.has(parent.type);
  if (!protectedHere) {
    rewriteSupTriplets(parent, options);
    rewriteHtmlNodes(parent);
    rewriteTextCitations(parent, options);
  }

  for (const child of parent.children) {
    if (child.children) visit(child as MdParent, options, protectedHere);
  }
}

export function transformScientificCitations(
  tree: MdNode,
  options: CitationOptions
): void {
  if (tree.children) visit(tree as MdParent, options);
}

export const scientificCitationRemarkPlugin: Plugin<[CitationOptions]> =
  function (options) {
    return (tree) => transformScientificCitations(tree as MdNode, options);
  };
