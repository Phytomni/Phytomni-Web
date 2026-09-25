import { describe, expect, it, vi } from "vitest";
import {
  collapseConsecutiveDuplicateHeadings,
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

  it("does not let the host locale change heading IDs", () => {
    const localeLower = vi
      .spyOn(String.prototype, "toLocaleLowerCase")
      .mockImplementation(() => "locale-sensitive");
    const tree = {
      type: "root",
      children: [
        {
          type: "element",
          tagName: "h2",
          properties: {},
          children: [{ type: "text", value: "Istanbul" }],
        },
      ],
    };

    expect(collectAndAssignHeadings(tree)).toEqual([
      { id: "istanbul", level: 2, text: "Istanbul" },
    ]);
    expect(localeLower).not.toHaveBeenCalled();
  });

  it("drops a heading that repeats the previous heading text", () => {
    const tree = {
      type: "root",
      children: [
        {
          type: "element",
          tagName: "h2",
          properties: {},
          children: [{ type: "text", value: "Digital Design" }],
        },
        {
          type: "element",
          tagName: "h3",
          properties: {},
          children: [{ type: "text", value: "Promoter Design" }],
        },
        { type: "text", value: "\n" },
        {
          type: "element",
          tagName: "h1",
          properties: {},
          children: [{ type: "text", value: "Promoter Design" }],
        },
        {
          type: "element",
          tagName: "p",
          properties: {},
          children: [{ type: "text", value: "Result artifacts" }],
        },
        {
          type: "element",
          tagName: "h2",
          properties: {},
          children: [{ type: "text", value: "Protein Design" }],
        },
      ],
    };

    collapseConsecutiveDuplicateHeadings(tree);
    expect(collectAndAssignHeadings(tree)).toEqual([
      { id: "digital-design", level: 2, text: "Digital Design" },
      { id: "promoter-design", level: 3, text: "Promoter Design" },
      { id: "protein-design", level: 2, text: "Protein Design" },
    ]);
  });
});
