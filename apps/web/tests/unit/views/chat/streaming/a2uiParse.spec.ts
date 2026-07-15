import { describe, it, expect } from "vitest";
import {
  parseA2uiCustomValue,
  isA2uiCatalogSupported,
} from "@/views/chat/streaming/a2uiParse";
import {
  A2UI_CATALOG_VERSION,
  A2UI_LIMITS,
} from "@/views/chat/streaming/a2uiContract";
import type {
  A2uiOpenSurface,
  A2uiTerminalSurface,
} from "@/views/chat/streaming/a2uiContract";

const confirmOpenSurface = {
  catalog_version: A2UI_CATALOG_VERSION,
  surface_id: "sfc-confirm",
  widget: "confirm",
  props: {
    title: "Continue?",
    body: "Run the analysis as planned.",
    confirm_label: "Confirm",
    cancel_label: "Cancel",
  },
} satisfies A2uiOpenSurface;

const formOpenSurface = {
  catalog_version: A2UI_CATALOG_VERSION,
  surface_id: "sfc-form",
  widget: "form",
  props: {
    title: "Gene ID",
    fields: [
      {
        name: "gene_id",
        label: "Gene ID",
        type: "text",
        required: true,
      },
    ],
  },
} satisfies A2uiOpenSurface;

const choiceOpenSurface = {
  catalog_version: A2UI_CATALOG_VERSION,
  surface_id: "sfc-choice",
  widget: "choice",
  props: {
    title: "Choice",
    options: [
      { id: "a", label: "Option A" },
      { id: "b", label: "Option B" },
    ],
    multiple: false,
  },
} satisfies A2uiOpenSurface;

const terminalSurface = {
  catalog_version: A2UI_CATALOG_VERSION,
  surface_id: "sfc-form",
  widget: "form",
  props: {
    status: "submitted",
    fields: { gene_id: "AT1G01010" },
  },
} satisfies A2uiTerminalSurface;

void confirmOpenSurface;
void formOpenSurface;
void choiceOpenSurface;
void terminalSurface;

describe("A2UI resource limits", () => {
  it("keeps reviewed request, response, and content budgets", () => {
    expect(A2UI_LIMITS).toEqual({
      requestBytes: 64 * 1024,
      responseBytes: 1024 * 1024,
      identifierChars: 256,
      formFields: 20,
      choiceItems: 100,
      labelChars: 256,
      textChars: 4096,
    });
  });
});

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
