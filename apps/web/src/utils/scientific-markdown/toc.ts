import type { ScientificHeading } from "./types";

export interface NestedScientificHeading extends ScientificHeading {
  children: NestedScientificHeading[];
}

const NUMBERED_HEADING = /^\d+[.)]\s/;

function isNumberedHeading(text: string): boolean {
  return NUMBERED_HEADING.test(text);
}

/**
 * Demote `1. …` headings that share a level with a preceding unnumbered
 * sibling so protocol sections nest under titles like "Recommended experiments".
 */
export function adjustNumberedHeadingLevels(
  headings: readonly ScientificHeading[]
): ScientificHeading[] {
  return headings.map((heading, index) => {
    if (!isNumberedHeading(heading.text) || heading.level >= 6) {
      return { ...heading };
    }
    for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
      const previous = headings[cursor];
      if (previous.level < heading.level) break;
      if (
        previous.level === heading.level &&
        !isNumberedHeading(previous.text)
      ) {
        return {
          ...heading,
          level: (heading.level + 1) as ScientificHeading["level"],
        };
      }
    }
    return { ...heading };
  });
}

export function buildNestedHeadings(
  flatHeadings: readonly ScientificHeading[]
): NestedScientificHeading[] {
  const nested: NestedScientificHeading[] = [];
  const stack: NestedScientificHeading[] = [];

  for (const heading of adjustNumberedHeadingLevels(flatHeadings)) {
    if (heading.level < 2 || heading.level > 4) continue;
    while (true) {
      const parent = stack.at(-1);
      if (!parent || parent.level < heading.level) break;
      stack.pop();
    }
    const item: NestedScientificHeading = { ...heading, children: [] };
    const parent = stack.at(-1);
    if (parent) parent.children.push(item);
    else nested.push(item);
    stack.push(item);
  }

  return nested;
}
