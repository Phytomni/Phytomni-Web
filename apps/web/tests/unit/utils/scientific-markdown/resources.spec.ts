import { describe, expect, it } from "vitest";
import {
  indexScientificResources,
  resourceFor,
} from "@/utils/scientific-markdown/resources";

describe("scientific Markdown resources", () => {
  it("accepts runtime CIF readers only as an exclusive CIF render source", () => {
    const source = {
      kind: "cif-text" as const,
      read: async () => "data_model",
    };
    const resource = {
      id: "structure",
      name: "Structure",
      kind: "cif" as const,
      markdownHref: "./model.cif",
      renderSource: source,
    };
    expect(
      resourceFor(indexScientificResources([resource]), "./model.cif", "cif")
        ?.renderSource
    ).toBe(source);
    for (const invalid of [
      { ...resource, displayUrl: "/public/model.cif" },
      { ...resource, displayUrl: "blob:https://example.test/id" },
      { ...resource, kind: "image" as const },
      { ...resource, renderSource: { kind: "cif-text", read: "data_model" } },
    ]) {
      expect(indexScientificResources([invalid as typeof resource]).size).toBe(
        0
      );
    }
  });
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

    expect([...resources.keys()]).toEqual([]);
    expect(resourceFor(resources, "figures/one.png", "image")).toBeUndefined();
    expect(resourceFor(resources, "figures/two.png", "image")).toBeUndefined();

    const unique = indexScientificResources([
      {
        id: "figure-1",
        name: "Figure 1",
        kind: "image",
        markdownHref: "figures/one.png",
        displayUrl: "/safe/one.png",
      },
    ]);
    expect(resourceFor(unique, "figures/one.png", "image")?.id).toBe(
      "figure-1"
    );
    expect(resourceFor(unique, "figures/one.png", "cif")).toBeUndefined();
  });

  it("does not infer authorization from a report path or a suffix", () => {
    const resources = indexScientificResources([]);
    expect(
      resourceFor(resources, "/private/path.png", "image")
    ).toBeUndefined();
    expect(resourceFor(resources, "./.out/private.cif", "cif")).toBeUndefined();
  });
});
