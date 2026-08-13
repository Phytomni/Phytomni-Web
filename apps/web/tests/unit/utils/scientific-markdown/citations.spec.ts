import { describe, expect, it } from "vitest";
import {
  parseCitationBody,
  transformScientificCitations,
} from "@/utils/scientific-markdown/citations";

describe("parseCitationBody", () => {
  it.each([
    ["1", [1]],
    ["[1]", [1]],
    ["1,2", [1, 2]],
    ["[1,2]", [1, 2]],
    ["1-4", [1, 2, 3, 4]],
    ["[1-4]", [1, 2, 3, 4]],
    ["1-3,7,9-10", [1, 2, 3, 7, 9, 10]],
  ])("parses %s", (source, indices) => {
    expect(parseCitationBody(source)).toEqual({
      display: source.replace(/^\[|\]$/g, ""),
      indices,
    });
  });

  it.each(["", "0", "4-1", "1,,2", "2024", "1-9999", "1,a", "1,1"])(
    "rejects %s",
    (source) => expect(parseCitationBody(source)).toBeNull()
  );
});

describe("transformScientificCitations", () => {
  const options = { namespace: "report", referenceCount: 10 };

  it("recognizes exact superscript triplets and preserves all other raw HTML as text", () => {
    const tree = {
      type: "root",
      children: [
        {
          type: "paragraph",
          children: [
            { type: "html", value: "<sup>" },
            { type: "text", value: "1" },
            { type: "html", value: "</sup>" },
            { type: "text", value: " " },
            { type: "html", value: "<sup>" },
            { type: "text", value: "[1-4]" },
            { type: "html", value: "</sup>" },
            { type: "text", value: " " },
            { type: "html", value: "<sup class=x>" },
            { type: "text", value: "[1]" },
            { type: "html", value: "</sup>" },
            { type: "text", value: " " },
            { type: "html", value: "<sup>" },
            { type: "html", value: "<em>" },
            { type: "text", value: "1" },
            { type: "html", value: "</em>" },
            { type: "html", value: "</sup>" },
            { type: "text", value: " " },
            { type: "html", value: "<sup>" },
            { type: "text", value: "not a citation" },
            { type: "html", value: "</sup broken>" },
          ],
        },
      ],
    };

    transformScientificCitations(tree, options);

    const children = tree.children[0].children;
    expect(
      children.filter(
        (node: { type: string }) => node.type === "scientificCitation"
      )
    ).toHaveLength(2);
    expect(children).toContainEqual({
      type: "text",
      value: "<sup class=x>",
      data: { scientificRawHtml: true },
    });
    expect(children).toContainEqual({
      type: "text",
      value: "</sup broken>",
      data: { scientificRawHtml: true },
    });
  });

  it("does not rewrite protected markdown node types", () => {
    const protectedTypes = [
      "inlineCode",
      "code",
      "link",
      "image",
      "inlineMath",
      "math",
    ];
    const tree = {
      type: "root",
      children: protectedTypes.map((type) => ({
        type,
        value: "[1-3]",
        children:
          type === "link" || type === "image"
            ? [{ type: "text", value: "[1-3]" }]
            : undefined,
      })),
    };

    transformScientificCitations(tree, options);

    expect(JSON.stringify(tree)).not.toContain("scientificCitation");
  });

  it("keeps markdown links as links and renders out-of-range citations without anchors", () => {
    const tree = {
      type: "root",
      children: [
        {
          type: "paragraph",
          children: [
            {
              type: "link",
              url: "https://example.org",
              children: [{ type: "text", value: "1" }],
            },
            { type: "text", value: " [11]" },
          ],
        },
      ],
    };

    transformScientificCitations(tree, options);

    const citation = tree.children[0].children.find(
      (node: { type: string }) => node.type === "scientificCitation"
    );
    expect(tree.children[0].children[0].type).toBe("link");
    expect(citation?.type).toBe("scientificCitation");
    expect(citation?.data?.hChildren[0].type).toBe("text");
  });
});
