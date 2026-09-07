import { decodeString } from "micromark-util-decode-string";
import type { ScientificMarkdownNode as MdNode } from "./types";

type InlineTag = "sup" | "sub" | "i" | "em";
interface Boundary {
  kind: "open" | "close";
  tagName: string;
}
const INLINE_TAGS = new Set(["sup", "sub", "i", "em"]);
const PROTECTED = new Set([
  "inlineCode",
  "code",
  "inlineMath",
  "math",
  "image",
  "imageReference",
]);
const VOID_TAGS = new Set([
  "area",
  "base",
  "br",
  "col",
  "embed",
  "hr",
  "img",
  "input",
  "link",
  "meta",
  "param",
  "source",
  "track",
  "wbr",
]);

/** Only recognize source HTML nodes. Decoded text is never interpreted as a tag. */
export function rawHtmlBoundary(value: string): Boundary | null {
  const match = /^<\/?([a-z][\w:-]*)/i.exec(value.trim());
  if (!match) return null;
  const trimmed = value.trim();
  const tagName = match[1].toLowerCase();
  const closing = trimmed[1] === "/";
  let quote = "";
  for (let cursor = match[0].length; cursor < trimmed.length; cursor += 1) {
    const character = trimmed[cursor];
    if (quote) {
      if (character === quote) quote = "";
    } else if (character === '"' || character === "'") {
      quote = character;
    } else if (character === ">") {
      if (trimmed.slice(cursor + 1).trim()) return null;
      const suffix = trimmed.slice(match[0].length, cursor);
      if (closing)
        return /^\s*$/.test(suffix) ? { kind: "close", tagName } : null;
      return suffix.trimEnd().endsWith("/") || VOID_TAGS.has(tagName)
        ? null
        : { kind: "open", tagName };
    }
  }
  return null;
}

function isScript(tag: string): boolean {
  return tag === "sup" || tag === "sub";
}

function nodeSource(node: MdNode, source: string): string | undefined {
  const start = node.position?.start?.offset;
  const end = node.position?.end?.offset;
  return start === undefined || end === undefined
    ? undefined
    : source.slice(start, end);
}

/** Split only at physical source newlines, retaining the parser's decoded text. */
function splitTextLines(node: MdNode, source: string): MdNode[] {
  const raw = nodeSource(node, source);
  const start = node.position?.start?.offset;
  const end = node.position?.end?.offset;
  const value = node.value;
  if (
    node.type !== "text" ||
    raw === undefined ||
    start === undefined ||
    end === undefined ||
    value === undefined ||
    !/[\r\n]/.test(raw)
  )
    return [node];
  const output: MdNode[] = [];
  let sourceOffset = 0;
  let textOffset = 0;
  for (const newline of raw.matchAll(/\r\n|[\r\n]/g)) {
    const before = raw.slice(sourceOffset, newline.index);
    const length = decodeString(before).length;
    if (length)
      output.push({
        ...node,
        value: value.slice(textOffset, textOffset + length),
        position: {
          start: { offset: start + sourceOffset },
          end: { offset: start + newline.index },
        },
      });
    textOffset += length;
    output.push({
      type: "text",
      value: value.slice(textOffset, textOffset + newline[0].length),
      data: { scientificPhysicalBreak: true },
      position: {
        start: { offset: start + newline.index },
        end: { offset: start + newline.index + newline[0].length },
      },
    });
    textOffset += newline[0].length;
    sourceOffset = newline.index + newline[0].length;
  }
  if (sourceOffset < raw.length)
    output.push({
      ...node,
      value: value.slice(textOffset),
      position: {
        start: { offset: start + sourceOffset },
        end: { offset: end },
      },
    });
  return output;
}

function literalize(node: MdNode): void {
  if (node.type === "html") {
    node.type = "text";
    node.data = { ...node.data, scientificRawHtml: true };
  } else {
    node.data = { ...node.data, scientificRawHtmlContent: true };
  }
  for (const child of node.children ?? []) literalize(child);
}

function boundaryFor(node: MdNode): Boundary | null {
  if (typeof node.data?.scientificRejectedTag === "string")
    return { kind: "open", tagName: node.data.scientificRejectedTag };
  return node.type === "html" ? rawHtmlBoundary(node.value ?? "") : null;
}

/** Malformed attribute syntax may be a text node, but still rejects a candidate. */
function splitRejectedOpeners(node: MdNode, source: string): MdNode[] {
  const raw = nodeSource(node, source);
  const start = node.position?.start?.offset;
  const value = node.value;
  if (
    node.type !== "text" ||
    raw === undefined ||
    start === undefined ||
    value === undefined ||
    node.data?.scientificRawHtml ||
    node.data?.scientificRawHtmlContent ||
    node.data?.scientificRejectedTag
  )
    return [node];
  const output: MdNode[] = [];
  let offset = 0;
  const slice = (from: number, to: number): MdNode => ({
    ...node,
    value: value.slice(
      decodeString(raw.slice(0, from)).length,
      decodeString(raw.slice(0, to)).length
    ),
    position: { start: { offset: start + from }, end: { offset: start + to } },
  });
  for (const match of raw.matchAll(/<(sup|sub|i|em)(?=[\s/>]|$)/gi)) {
    if (match.index < offset) continue;
    let escapes = 0;
    for (
      let cursor = match.index - 1;
      cursor >= 0 && raw[cursor] === "\\";
      cursor -= 1
    )
      escapes += 1;
    if (escapes % 2) continue;
    let end = match.index + match[0].length;
    let quote = "";
    for (; end < raw.length; end += 1) {
      const character = raw[end];
      if (quote) {
        if (character === quote) quote = "";
      } else if (character === '"' || character === "'") quote = character;
      else if (character === ">") {
        end += 1;
        break;
      } else if (character === "\r" || character === "\n") break;
    }
    if (match.index > offset) output.push(slice(offset, match.index));
    output.push({
      ...slice(match.index, end),
      data: { ...node.data, scientificRejectedTag: match[1].toLowerCase() },
    });
    offset = end;
  }
  if (!output.length) return [node];
  if (offset < raw.length) output.push(slice(offset, raw.length));
  return output;
}

function candidateEnd(
  nodes: MdNode[],
  start: number,
  source: string
): { end: number; limit: number } | null {
  const opening = boundaryFor(nodes[start]);
  const sourceStart = nodes[start].position?.start?.offset;
  if (!opening || sourceStart === undefined) return null;
  const newline = /[\r\n]/.exec(source.slice(sourceStart));
  let limit = newline ? sourceStart + newline.index : source.length;
  const stack = [opening.tagName];
  function inspect(node: MdNode): boolean {
    if ((node.position?.start?.offset ?? limit) >= limit) return true;
    const boundary = boundaryFor(node);
    if (boundary && INLINE_TAGS.has(boundary.tagName)) {
      if (boundary.kind === "open") stack.push(boundary.tagName);
      else {
        const matched = stack.at(-1) === boundary.tagName;
        stack.pop();
        if (!matched || !stack.length) {
          limit = node.position?.end?.offset ?? limit;
          return true;
        }
      }
    }
    if (node.type === "strong" || node.type === "emphasis")
      return (node.children ?? []).some(inspect);
    return false;
  }
  nodes.slice(start + 1).some(inspect);
  let end = start;
  while (
    end < nodes.length &&
    (nodes[end].position?.end?.offset ?? Infinity) <= limit
  )
    end += 1;
  return { end: Math.max(start + 1, end), limit };
}

function literalizeUntil(
  node: MdNode,
  limit: number,
  source: string
): MdNode[] {
  const start = node.position?.start?.offset;
  const end = node.position?.end?.offset;
  if (start === undefined || end === undefined || start >= limit) return [node];
  if (end <= limit) {
    literalize(node);
    return [node];
  }
  if (node.children)
    node.children = node.children.flatMap((child) =>
      literalizeUntil(child, limit, source)
    );
  else if (node.type === "text" && node.value !== undefined) {
    const length = decodeString(source.slice(start, limit)).length;
    const before = {
      ...node,
      value: node.value.slice(0, length),
      position: { start: { offset: start }, end: { offset: limit } },
    };
    literalize(before);
    return [
      before,
      {
        ...node,
        value: node.value.slice(length),
        position: { start: { offset: limit }, end: { offset: end } },
      },
    ];
  }
  return [node];
}

function semanticNode(tag: InlineTag, children: MdNode[]): MdNode {
  const vertical =
    tag === "sup" ? "superscript" : tag === "sub" ? "subscript" : undefined;
  return {
    type: "scientificInline",
    children,
    data: {
      ...(vertical ? { scientificVertical: vertical } : {}),
      hName: vertical ? tag : "em",
      hProperties: {
        className: [
          vertical
            ? `scientific-inline--${vertical}`
            : "scientific-inline--italic",
        ],
      },
    },
  };
}

/** Validate a complete candidate before replacing any of its descendants. */
function formatChildren(
  nodes: MdNode[],
  source: string,
  script: boolean
): MdNode[] | null {
  const output: MdNode[] = [];
  for (let index = 0; index < nodes.length; index += 1) {
    const node = nodes[index];
    if (node.type === "text") {
      output.push(node);
      continue;
    }
    if (node.type === "strong" || node.type === "emphasis") {
      const children = formatChildren(node.children ?? [], source, script);
      if (!children) return null;
      output.push({ ...node, children });
      continue;
    }
    if (node.type !== "html") return null;
    const match = /^<(sup|sub|i|em)>$/.exec(node.value ?? "");
    if (!match || (script && isScript(match[1]))) return null;
    const tag = match[1] as InlineTag;
    const boundary = candidateEnd(nodes, index, source);
    if (!boundary) return null;
    const { end } = boundary;
    if (nodes[end - 1]?.value !== `</${tag}>`) return null;
    const children = formatChildren(
      nodes.slice(index + 1, end - 1),
      source,
      script || isScript(tag)
    );
    if (!children) return null;
    output.push(semanticNode(tag, children));
    index = end - 1;
  }
  return output;
}

function visit(parent: MdNode, source: string): void {
  if (!parent.children || PROTECTED.has(parent.type)) return;
  parent.children = parent.children
    .flatMap((node) => splitTextLines(node, source))
    .flatMap((node) => splitRejectedOpeners(node, source));
  const nodes = parent.children;
  const rawTags: string[] = [];
  for (let index = 0; index < nodes.length; index += 1) {
    const node = nodes[index];
    const boundary = boundaryFor(node);
    if (rawTags.length) {
      if (boundary?.kind === "close" && rawTags.at(-1) === boundary.tagName)
        rawTags.pop();
      else if (boundary?.kind === "open") rawTags.push(boundary.tagName);
      literalize(node);
      continue;
    }
    if (boundary?.kind === "open" && INLINE_TAGS.has(boundary.tagName)) {
      const candidateBoundary = candidateEnd(nodes, index, source);
      if (!candidateBoundary) {
        literalize(node);
        continue;
      }
      const { end, limit } = candidateBoundary;
      const candidate = nodes.slice(index, end);
      const raw = nodeSource(node, source);
      const formatted =
        node.type === "html" && raw !== undefined && raw === node.value
          ? formatChildren(candidate, source, false)
          : null;
      if (formatted) nodes.splice(index, end - index, ...formatted);
      else {
        for (const rejected of candidate) literalize(rejected);
        if (nodes[end])
          nodes.splice(end, 1, ...literalizeUntil(nodes[end], limit, source));
      }
      index += (formatted?.length ?? candidate.length) - 1;
      continue;
    }
    if (boundary?.kind === "open") rawTags.push(boundary.tagName);
    if (node.type === "html") literalize(node);
    else visit(node, source);
  }
}

export function transformScientificInlineFormatting(
  tree: MdNode,
  source: string
): void {
  visit(tree, source);
}
