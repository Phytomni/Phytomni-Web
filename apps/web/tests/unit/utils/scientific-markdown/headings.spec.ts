import { describe, expect, it, vi } from "vitest";
import {
  collectAndAssignHeadings,
  rehypeScientificHeadings,
} from "@/utils/scientific-markdown/headings";

describe("scientific Markdown headings", () => {
  it("assigns deterministic slugs to duplicate headings", () => {
    const tree = {
      type: "root",
      children: [
        {
          type: "element",
          tagName: "h2",
          properties: {},
          children: [{ type: "text", value: "Gene" }],
        },
        {
          type: "element",
          tagName: "h3",
          properties: {},
          children: [{ type: "text", value: "Gene" }],
        },
        {
          type: "element",
          tagName: "h2",
          properties: {},
          children: [{ type: "text", value: "Gene" }],
        },
      ],
    };

    expect(collectAndAssignHeadings(tree)).toEqual([
      { id: "gene", level: 2, text: "Gene" },
      { id: "gene-2", level: 3, text: "Gene" },
      { id: "gene-3", level: 2, text: "Gene" },
    ]);
  });

  it("uses readable descendant text rather than inline markup", async () => {
    const onHeadings = vi.fn();
    const tree = {
      type: "root",
      children: [
        {
          type: "element",
          tagName: "h2",
          properties: {},
          children: [
            { type: "text", value: "Gene " },
            {
              type: "element",
              tagName: "em",
              properties: {},
              children: [{ type: "text", value: "network" }],
            },
            { type: "text", value: " [1]" },
          ],
        },
      ],
    };

    rehypeScientificHeadings({ onHeadings })(tree);
    await Promise.resolve();

    expect(onHeadings).toHaveBeenCalledWith([
      { id: "gene-network-1", level: 2, text: "Gene network [1]" },
    ]);
  });
});
