import { describe, expect, it } from "vitest";
import {
  indexScientificResources,
  resourceFor,
} from "@/utils/scientific-markdown/resources";

describe("scientific Markdown resources", () => {
  it("indexes only exact unambiguous authorized resources", () => {
    const resources = indexScientificResources([
      {
        id: "figure-1",
        name: "Figure 1",
        kind: "image",
        markdownHref: "figures/one.png",
        displayUrl: "/safe/one.png",
      },
      {
        id: "figure-1",
        name: "Duplicate id",
        kind: "image",
        markdownHref: "figures/two.png",
        displayUrl: "/safe/two.png",
      },
      {
        id: "figure-3",
        name: "Duplicate href",
        kind: "image",
        markdownHref: "figures/one.png",
        displayUrl: "/safe/three.png",
      },
      {
        id: "unsafe",
        name: "Unsafe",
        kind: "image",
        markdownHref: "javascript:alert(1)",
        displayUrl: "/safe/four.png",
      },
      {
        id: "unsafe-display",
        name: "Unsafe display",
        kind: "image",
        markdownHref: "figures/five.png",
        displayUrl: "javascript:alert(1)",
      },
    ]);

    expect([...resources.keys()]).toEqual(["figures/one.png"]);
    expect(resourceFor(resources, "figures/one.png", "image")?.id).toBe(
      "figure-1"
    );
    expect(resourceFor(resources, "figures/one.png", "cif")).toBeUndefined();
  });

  it("does not infer authorization from a report path or a suffix", () => {
    const resources = indexScientificResources([]);
    expect(
      resourceFor(resources, "/private/path.png", "image")
    ).toBeUndefined();
    expect(resourceFor(resources, "./.out/private.cif", "cif")).toBeUndefined();
  });
});
