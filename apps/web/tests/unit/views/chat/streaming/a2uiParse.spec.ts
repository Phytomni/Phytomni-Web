import { describe, it, expect } from "vitest";
import {
  parseA2uiCustomValue,
  isA2uiCatalogSupported,
} from "@/views/chat/streaming/a2uiParse";

describe("isA2uiCatalogSupported", () => {
  it("accepts v1.0 and forward v1.x strings", () => {
    expect(isA2uiCatalogSupported("v1.0")).toBe(true);
    expect(isA2uiCatalogSupported("v1.0.0")).toBe(true);
    expect(isA2uiCatalogSupported("1.2")).toBe(true);
  });
  it("rejects pre-v1 and empty", () => {
    expect(isA2uiCatalogSupported("v0.9.1")).toBe(false);
    expect(isA2uiCatalogSupported("")).toBe(false);
  });
});

describe("parseA2uiCustomValue", () => {
  it("accepts a confirm surface", () => {
    const r = parseA2uiCustomValue({
      catalog_version: "v1.0",
      surface_id: "s1",
      widget: "confirm",
      props: { title: "Proceed?" },
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.widget).toBe("confirm");
      expect(r.value.surface_id).toBe("s1");
    }
  });

  it("rejects missing surface_id", () => {
    const r = parseA2uiCustomValue({
      catalog_version: "v1.0",
      widget: "confirm",
      props: {},
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("missing_surface_id");
  });

  it("rejects unknown widget", () => {
    const r = parseA2uiCustomValue({
      catalog_version: "v1.0",
      surface_id: "s1",
      widget: "chart",
      props: {},
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("unknown_widget");
  });

  it("rejects catalog below v1", () => {
    const r = parseA2uiCustomValue({
      catalog_version: "v0.9.1",
      surface_id: "s1",
      widget: "choice",
      props: {},
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("catalog_too_old");
  });

  it("rejects non-objects", () => {
    expect(parseA2uiCustomValue(null).ok).toBe(false);
    expect(parseA2uiCustomValue("x").ok).toBe(false);
  });
});
