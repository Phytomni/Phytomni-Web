import { describe, it, expect } from "vitest";
import type { ContentBlock } from "@/views/chat/types";
import {
  buildPresentationItems,
  type PresentationItem,
} from "@/views/chat/streaming/presentation";

function md(text: string): ContentBlock {
  return { type: "markdown", authority: "web", text };
}

function tool(toolName: string): ContentBlock {
  return { type: "tool", authority: "web", toolName };
}

function step(label: string): ContentBlock {
  return { type: "step", authority: "web", label };
}

function reasoning(text: string): ContentBlock {
  return { type: "reasoning", authority: "web", text };
}

function agentSurface(surfaceId: string): ContentBlock {
  return {
    type: "agent-surface",
    authority: "agent",
    interactive: true,
    surfaceId,
    widget: "confirm",
  };
}

function blockItem(index: number, block: ContentBlock): PresentationItem {
  return {
    kind: "block",
    key: `block-${index}`,
    index,
    block,
  };
}

function activityItem(
  startIndex: number,
  endIndex: number,
  blocks: ContentBlock[]
): PresentationItem {
  return {
    kind: "activity",
    key: `activity-${startIndex}`,
    startIndex,
    endIndex,
    blocks,
  };
}

type Case = {
  name: string;
  blocks: ContentBlock[];
  expected: (blocks: ContentBlock[]) => PresentationItem[];
};

describe("buildPresentationItems", () => {
  const cases: Case[] = [
    {
      name: "empty input",
      blocks: [],
      expected: () => [],
    },
    {
      name: "single markdown block",
      blocks: [md("hello")],
      expected: (blocks) => [blockItem(0, blocks[0])],
    },
    {
      name: "single activity block",
      blocks: [tool("search")],
      expected: (blocks) => [activityItem(0, 0, [blocks[0]])],
    },
    {
      name: "consecutive activity blocks merge into one group",
      blocks: [tool("a"), step("b"), reasoning("c")],
      expected: (blocks) => [activityItem(0, 2, blocks)],
    },
    {
      name: "interleaved markdown and activity",
      blocks: [md("intro"), tool("t1"), step("s1"), md("outro")],
      expected: (blocks) => [
        blockItem(0, blocks[0]),
        activityItem(1, 2, [blocks[1], blocks[2]]),
        blockItem(3, blocks[3]),
      ],
    },
    {
      name: "leading activity blocks",
      blocks: [reasoning("think"), md("answer")],
      expected: (blocks) => [
        activityItem(0, 0, [blocks[0]]),
        blockItem(1, blocks[1]),
      ],
    },
    {
      name: "trailing activity blocks",
      blocks: [md("answer"), tool("t1"), tool("t2")],
      expected: (blocks) => [
        blockItem(0, blocks[0]),
        activityItem(1, 2, [blocks[1], blocks[2]]),
      ],
    },
    {
      name: "agent-surface splits activity groups",
      blocks: [tool("before"), agentSurface("surf-1"), tool("after")],
      expected: (blocks) => [
        activityItem(0, 0, [blocks[0]]),
        blockItem(1, blocks[1]),
        activityItem(2, 2, [blocks[2]]),
      ],
    },
    {
      name: "multiple markdown blocks stay separate",
      blocks: [md("a"), md("b")],
      expected: (blocks) => [blockItem(0, blocks[0]), blockItem(1, blocks[1])],
    },
    {
      name: "activity groups separated by markdown",
      blocks: [tool("t1"), md("mid"), step("s1")],
      expected: (blocks) => [
        activityItem(0, 0, [blocks[0]]),
        blockItem(1, blocks[1]),
        activityItem(2, 2, [blocks[2]]),
      ],
    },
  ];

  it.each(cases)("$name", ({ blocks, expected }) => {
    const items = buildPresentationItems(blocks);
    expect(items).toEqual(expected(blocks));
  });

  it("preserves original block object references", () => {
    const b0 = md("intro");
    const b1 = tool("search");
    const b2 = md("outro");
    const items = buildPresentationItems([b0, b1, b2]);

    expect(items[0].kind).toBe("block");
    if (items[0].kind === "block") expect(items[0].block).toBe(b0);

    expect(items[1].kind).toBe("activity");
    if (items[1].kind === "activity") {
      expect(items[1].blocks).toHaveLength(1);
      expect(items[1].blocks[0]).toBe(b1);
    }

    expect(items[2].kind).toBe("block");
    if (items[2].kind === "block") expect(items[2].block).toBe(b2);
  });

  it("preserves input order in activity group blocks array", () => {
    const blocks = [step("first"), tool("second"), reasoning("third")];
    const items = buildPresentationItems(blocks);
    expect(items).toEqual([activityItem(0, 2, blocks)]);
    if (items[0].kind === "activity") {
      expect(items[0].blocks.map((b) => b.type)).toEqual([
        "step",
        "tool",
        "reasoning",
      ]);
    }
  });

  it("keeps activity key stable when trailing activity blocks append", () => {
    const t0 = tool("a");
    const t1 = tool("b");
    const first = buildPresentationItems([t0, t1]);
    const t2 = tool("c");
    const second = buildPresentationItems([t0, t1, t2]);

    expect(first).toHaveLength(1);
    expect(second).toHaveLength(1);
    expect(first[0].key).toBe("activity-0");
    expect(second[0].key).toBe("activity-0");
    if (first[0].kind === "activity" && second[0].kind === "activity") {
      expect(first[0].endIndex).toBe(1);
      expect(second[0].endIndex).toBe(2);
      expect(second[0].blocks).toEqual([t0, t1, t2]);
    }
  });

  it("never merges activity across agent-surface boundaries", () => {
    const surface = agentSurface("x");
    const items = buildPresentationItems([
      tool("a"),
      step("b"),
      surface,
      reasoning("c"),
      tool("d"),
    ]);
    expect(items.map((item) => item.key)).toEqual([
      "activity-0",
      "block-2",
      "activity-3",
    ]);
    if (items[0].kind === "activity") expect(items[0].blocks).toHaveLength(2);
    if (items[2].kind === "activity") expect(items[2].blocks).toHaveLength(2);
  });
});
