import { describe, expect, it } from "vitest";
import {
  parseCitationBody,
  requireCitationNamespace,
  transformScientificCitations,
} from "@/utils/scientific-markdown/citations";

describe("parseCitationBody", () => {
  it.each([
    ["1", [1]],
    ["[1]", [1]],
    ["1,2", [1, 2]],
    ["[1,2]", [1, 2]],
    ["[1, 2-3]", [1, 2, 3]],
    ["1-4", [1, 2, 3, 4]],
    ["[1-4]", [1, 2, 3, 4]],
    ["1-3,7,9-10", [1, 2, 3, 7, 9, 10]],
    ["[document:21]", [21]],
    ["[document 3, 4, 21, 23]", [3, 4, 21, 23]],
  ])("parses %s", (source, indices) => {
    const display = source
      .replace(/^\[|\]$/g, "")
      .replace(/^document(?:\s*:\s*|\s+)/i, "")
      .replace(/\s+/g, "");
    expect(parseCitationBody(source)).toEqual({
      display,
      indices,
    });
  });

  it.each([
    "",
    "0",
    "4-1",
    "1,,2",
    "2024",
    "1-9999",
    "1,a",
    "1,1",
    "1 2",
    "document",
    "documented:1",
    "document:1,a",
  ])("rejects %s", (source) => expect(parseCitationBody(source)).toBeNull());
});

describe("requireCitationNamespace", () => {
  it.each([undefined, null, true, 1])(
    "rejects non-string runtime input %s",
    (namespace) => {
      expect(() =>
        requireCitationNamespace(namespace as unknown as string)
      ).toThrowError("citation namespace is invalid");
    }
  );
});

describe("transformScientificCitations", () => {
  const options = { namespace: "report", referenceCount: 10 };

  it("rejects malformed and missing referenced namespaces", () => {
    const tree = {
      type: "root",
      children: [
        {
          type: "paragraph",
          children: [{ type: "text", value: "Evidence [1]" }],
        },
      ],
    };

    expect(() =>
      transformScientificCitations(tree, {
        namespace: "report:1",
        referenceCount: 1,
      })
    ).toThrowError("citation namespace is invalid");
    expect(() =>
      transformScientificCitations(tree, { namespace: "", referenceCount: 1 })
    ).toThrowError("citation namespace is invalid");
  });

  it("allows an omitted namespace only when no reference rows exist", () => {
    const tree = {
      type: "root",
      children: [
        {
          type: "paragraph",
          children: [{ type: "text", value: "Uncited note [1]" }],
        },
      ],
    };

    transformScientificCitations(tree, { namespace: "", referenceCount: 0 });

    expect(JSON.stringify(tree)).toContain("scientificCitation");
    expect(JSON.stringify(tree)).not.toContain('"href"');
  });

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

  it("rewrites citations next to escaped raw HTML without touching the HTML", () => {
    const tree = {
      type: "root",
      children: [
        {
          type: "paragraph",
          children: [
            { type: "html", value: "<span>" },
            { type: "text", value: "raw" },
            { type: "html", value: "</span>" },
            { type: "text", value: " Evidence [1]" },
          ],
        },
      ],
    };

    transformScientificCitations(tree, options);

    expect(tree.children[0].children).toContainEqual({
      type: "text",
      value: "<span>",
      data: { scientificRawHtml: true },
    });
    expect(
      tree.children[0].children.some(
        (node: { type: string }) => node.type === "scientificCitation"
      )
    ).toBe(true);
  });

  it("keeps citations inside quoted and nested raw HTML inert", () => {
    const tree = {
      type: "root",
      children: [
        {
          type: "paragraph",
          children: [
            { type: "html", value: '<span title=">">' },
            { type: "text", value: "raw [1]" },
            { type: "html", value: "<em>" },
            { type: "text", value: "nested [2]" },
            { type: "html", value: "</em>" },
            { type: "html", value: "</span>" },
            { type: "text", value: " Evidence [3]" },
          ],
        },
      ],
    };

    transformScientificCitations(tree, options);

    const serialized = JSON.stringify(tree);
    expect(serialized.match(/scientificCitation/g)).toHaveLength(1);
    expect(serialized).toContain("raw [1]");
    expect(serialized).toContain("nested [2]");
    expect(serialized).toContain("Citation 3");
  });

  it("does not let a mismatched closing tag escape raw HTML protection", () => {
    const tree = {
      type: "root",
      children: [
        {
          type: "paragraph",
          children: [
            { type: "html", value: "<span>" },
            { type: "html", value: "</em>" },
            { type: "text", value: "raw [1]" },
            { type: "html", value: "</span>" },
            { type: "text", value: " Evidence [2]" },
          ],
        },
      ],
    };

    transformScientificCitations(tree, options);

    const serialized = JSON.stringify(tree);
    expect(serialized.match(/scientificCitation/g)).toHaveLength(1);
    expect(serialized).toContain("raw [1]");
    expect(serialized).toContain("Citation 2");
  });

  it("keeps exact superscript triplets inert inside nested raw HTML", () => {
    const tree = {
      type: "root",
      children: [
        {
          type: "paragraph",
          children: [
            { type: "html", value: "<span>" },
            { type: "html", value: "<sup>" },
            { type: "text", value: "1" },
            { type: "html", value: "</sup>" },
            { type: "html", value: "</span>" },
            { type: "text", value: " " },
            { type: "html", value: "<sup>" },
            { type: "text", value: "2" },
            { type: "html", value: "</sup>" },
          ],
        },
      ],
    };

    transformScientificCitations(tree, options);

    const serialized = JSON.stringify(tree);
    expect(serialized.match(/scientificCitation/g)).toHaveLength(1);
    expect(serialized).toContain("Citation 2");
    expect(serialized).toContain('"value":"1"');
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

  it("rewrites Bot document markers and preserves their source spelling", () => {
    const tree = {
      type: "root",
      children: [
        {
          type: "paragraph",
          children: [
            {
              type: "text",
              value: "Evidence [document:1] and [document 3, 4].",
            },
          ],
        },
      ],
    };

    transformScientificCitations(tree, {
      namespace: "report",
      referenceCount: 4,
    });

    const citations = tree.children[0].children.filter(
      (node: { type: string }) => node.type === "scientificCitation"
    );
    expect(citations).toHaveLength(2);
    expect(citations[0]?.data?.hChildren[0]).toMatchObject({
      properties: {
        href: "#report-ref-1",
        ariaLabel: "Citation 1",
      },
      children: [{ type: "text", value: "[document:1]" }],
    });
    expect(citations[1]?.data?.hChildren[0]).toMatchObject({
      properties: {
        href: "#report-ref-3",
        ariaLabel: "Citation 3,4",
      },
      children: [{ type: "text", value: "[document 3, 4]" }],
    });
  });
});
