import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  decodeA2uiActionResponse,
  decodeA2uiOpenSurface,
  decodeA2uiTerminalSurface,
  isA2uiCatalogSupported,
  parseA2uiCustomValue,
} from "@/views/chat/streaming/a2uiParse";
import {
  A2UI_CATALOG_VERSION,
  A2UI_LIMITS,
} from "@/views/chat/streaming/a2uiContract";
import type {
  A2uiDecodeReason,
  A2uiOpenSurface,
} from "@/views/chat/streaming/a2uiParse";

const fixture = (relativePath: string): unknown =>
  JSON.parse(
    readFileSync(resolve(process.cwd(), "tests/fixtures/a2ui", relativePath), "utf8")
  );

const openSurface = (
  widget: "confirm" | "form" | "choice",
  props: Record<string, unknown>
) => ({
  catalog_version: A2UI_CATALOG_VERSION,
  surface_id: "surface-1",
  widget,
  props,
});

const confirmProps = {
  title: "Continue?",
  body: "Run the analysis as planned.",
  confirm_label: "Confirm",
  cancel_label: "Cancel",
};

function expectReason(
  result: { ok: false; reason: A2uiDecodeReason },
  reason: A2uiDecodeReason
): void {
  expect(result).toEqual({ ok: false, reason });
}

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

  it("rejects pre-v1 and empty strings", () => {
    expect(isA2uiCatalogSupported("v0.9.1")).toBe(false);
    expect(isA2uiCatalogSupported("")).toBe(false);
  });
});

describe("decodeA2uiOpenSurface", () => {
  it.each([
    ["confirm", "upstream/chat_confirm/downlink.json"],
    ["form", "upstream/chat_form/downlink.json"],
    ["choice", "upstream/chat_choice/downlink.json"],
  ] as const)("decodes the valid %s upstream fixture", (_widget, path) => {
    const result = decodeA2uiOpenSurface(fixture(path));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.widget).toBe(_widget);
  });

  it("accepts an ordinary object and a null-prototype object", () => {
    const value = Object.create(null) as Record<string, unknown>;
    value.catalog_version = "v1.0";
    value.surface_id = "surface-1";
    value.widget = "confirm";
    value.props = { ...confirmProps };
    expect(decodeA2uiOpenSurface(value).ok).toBe(true);
  });

  it.each(["__proto__", "prototype", "constructor"])(
    "rejects reserved form field name %s",
    (name) => {
      const result = decodeA2uiOpenSurface(
        openSurface("form", {
          title: "Fields",
          fields: [{ name, label: "Value", type: "text", required: false }],
        })
      );
      expectReason(result, "unsafe_field_name");
    }
  );

  it("rejects a field-name map that would pollute the prototype", () => {
    const fields = Object.create(null) as Record<string, unknown>;
    fields.__proto__ = "attacker";
    const result = decodeA2uiTerminalSurface({
      ...openSurface("form", {
        status: "submitted",
        fields,
      }),
    });
    expectReason(result, "unsafe_field_name");
  });

  it("rejects duplicate form field names", () => {
    const result = decodeA2uiOpenSurface(
      openSurface("form", {
        title: "Fields",
        fields: [
          { name: "gene", label: "Gene", type: "text", required: false },
          { name: "gene", label: "Gene again", type: "text", required: false },
        ],
      })
    );
    expectReason(result, "duplicate_field");
  });

  it("rejects duplicate choice option IDs", () => {
    const result = decodeA2uiOpenSurface(
      openSurface("choice", {
        title: "Choices",
        options: [
          { id: "a", label: "A" },
          { id: "a", label: "A again" },
        ],
        multiple: false,
      })
    );
    expectReason(result, "duplicate_field");
  });

  it.each(["text", "number", "select"] as const)(
    "accepts form field type %s",
    (type) => {
      const field: Record<string, unknown> = {
        name: "value",
        label: "Value",
        type,
        required: false,
      };
      if (type === "select") field.options = ["one", 2];
      expect(
        decodeA2uiOpenSurface(
          openSurface("form", { title: "Fields", fields: [field] })
        ).ok
      ).toBe(true);
    }
  );

  it("rejects form field types outside the contract", () => {
    const result = decodeA2uiOpenSurface(
      openSurface("form", {
        title: "Fields",
        fields: [
          { name: "value", label: "Value", type: "date", required: false },
        ],
      })
    );
    expectReason(result, "props_invalid");
  });

  it("accepts only bounded string/number scalars for select options", () => {
    expect(
      decodeA2uiOpenSurface(
        openSurface("form", {
          title: "Fields",
          fields: [
            {
              name: "value",
              label: "Value",
              type: "select",
              required: false,
              options: ["one", 2],
            },
          ],
        })
      ).ok
    ).toBe(true);

    const result = decodeA2uiOpenSurface(
      openSurface("form", {
        title: "Fields",
        fields: [
          {
            name: "value",
            label: "Value",
            type: "select",
            required: false,
            options: ["one", { bad: true }],
          },
        ],
      })
    );
    expectReason(result, "props_invalid");
  });

  it.each([
    ["title", "labelChars"],
    ["confirm_label", "labelChars"],
    ["cancel_label", "labelChars"],
  ] as const)("allows %s at 256 chars and rejects 257", (key) => {
    const atLimit = decodeA2uiOpenSurface(
      openSurface("confirm", { ...confirmProps, [key]: "x".repeat(256) })
    );
    expect(atLimit.ok).toBe(true);

    const overLimit = decodeA2uiOpenSurface(
      openSurface("confirm", { ...confirmProps, [key]: "x".repeat(257) })
    );
    expectReason(overLimit, "limit_exceeded");
  });

  it("allows body/text at 4096 chars and rejects 4097", () => {
    expect(
      decodeA2uiOpenSurface(
        openSurface("confirm", { ...confirmProps, body: "x".repeat(4096) })
      ).ok
    ).toBe(true);
    expectReason(
      decodeA2uiOpenSurface(
        openSurface("confirm", { ...confirmProps, body: "x".repeat(4097) })
      ),
      "limit_exceeded"
    );
  });

  it("allows identifiers at 256 chars and rejects 257", () => {
    expect(
      decodeA2uiOpenSurface(
        openSurface("confirm", { ...confirmProps, surface_id: "x".repeat(256) })
      ).ok
    ).toBe(true);
    expectReason(
      decodeA2uiOpenSurface({
        ...openSurface("confirm", confirmProps),
        surface_id: "x".repeat(257),
      }),
      "limit_exceeded"
    );
  });

  it("allows 20 form fields and rejects 21", () => {
    const field = (index: number) => ({
      name: `field-${index}`,
      label: `Field ${index}`,
      type: "text" as const,
      required: false,
    });
    expect(
      decodeA2uiOpenSurface(
        openSurface("form", { title: "Fields", fields: Array.from({ length: 20 }, (_, i) => field(i)) })
      ).ok
    ).toBe(true);
    expectReason(
      decodeA2uiOpenSurface(
        openSurface("form", { title: "Fields", fields: Array.from({ length: 21 }, (_, i) => field(i)) })
      ),
      "limit_exceeded"
    );
  });

  it("allows 100 choice options and rejects 101", () => {
    const option = (index: number) => ({ id: `option-${index}`, label: `Option ${index}` });
    expect(
      decodeA2uiOpenSurface(
        openSurface("choice", {
          title: "Choices",
          options: Array.from({ length: 100 }, (_, i) => option(i)),
          multiple: false,
        })
      ).ok
    ).toBe(true);
    expectReason(
      decodeA2uiOpenSurface(
        openSurface("choice", {
          title: "Choices",
          options: Array.from({ length: 101 }, (_, i) => option(i)),
          multiple: false,
        })
      ),
      "limit_exceeded"
    );
  });

  it.each([
    [null, "invalid_object"],
    ["text", "invalid_object"],
    [[], "invalid_object"],
    [{ ...openSurface("confirm", confirmProps), props: [] }, "props_invalid"],
    [{ ...openSurface("confirm", confirmProps), props: null }, "props_invalid"],
    [{ ...openSurface("confirm", confirmProps), widget: "chart" }, "widget_unsupported"],
    [{ ...openSurface("confirm", confirmProps), catalog_version: "v0.9" }, "catalog_unsupported"],
    [{ ...openSurface("confirm", confirmProps), surface_id: 4 }, "identifier_invalid"],
  ] as const)("fails closed for malformed open input %#", (value, reason) => {
    expectReason(decodeA2uiOpenSurface(value), reason);
  });

  it("requires trimmed, non-empty strings for identifiers", () => {
    for (const surface_id of ["", " surface-1", "surface-1 "]) {
      expectReason(
        decodeA2uiOpenSurface({ ...openSurface("confirm", confirmProps), surface_id }),
        surface_id ? "identifier_invalid" : "identifier_invalid"
      );
    }
  });

  it("does not trust a non-ordinary object prototype", () => {
    const value = Object.create({ inherited: true }) as Record<string, unknown>;
    Object.assign(value, openSurface("confirm", confirmProps));
    expectReason(decodeA2uiOpenSurface(value), "invalid_object");
  });

  it("does not throw when an attacker-controlled getter fails", () => {
    const value = {
      get catalog_version(): never {
        throw new Error("attacker data");
      },
    };
    expect(() => decodeA2uiOpenSurface(value)).not.toThrow();
    expectReason(decodeA2uiOpenSurface(value), "props_invalid");
  });
});

describe("decodeA2uiTerminalSurface", () => {
  it.each([
    "upstream/chat_confirm/success_accept.json",
    "upstream/chat_form/success_submit.json",
    "upstream/chat_form/success_cancel.json",
    "upstream/chat_choice/success_submit.json",
    "upstream/chat_choice/success_cancel.json",
  ])("decodes the terminal projection %s", (path) => {
    const value = (fixture(path) as { result: { a2ui: unknown } }).result.a2ui;
    const result = decodeA2uiTerminalSurface(value);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.props.status).toBe("submitted");
  });

  it("rejects terminal surfaces without submitted status", () => {
    const result = decodeA2uiTerminalSurface(
      openSurface("confirm", { accepted: true })
    );
    expectReason(result, "response_invalid");
  });

  it.each([
    { ...openSurface("confirm", { status: "submitted", accepted: "yes" }) },
    { ...openSurface("form", { status: "submitted", fields: { gene: true } }) },
    { ...openSurface("choice", { status: "submitted", selected: { id: "a" } }) },
  ])("rejects invalid terminal scalar branches", (value) => {
    expectReason(decodeA2uiTerminalSurface(value), "props_invalid");
  });
});

describe("decodeA2uiActionResponse", () => {
  it("decodes terminal_succeeded with full-envelope metadata", () => {
    const result = decodeA2uiActionResponse(fixture("http/terminal_succeeded.json"));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.status).toBe("succeeded");
      expect(result.value.run_id).toBe("run-contract-1");
    }
  });

  it("decodes input_required_round2 with its fresh draft surface", () => {
    const result = decodeA2uiActionResponse(
      fixture("http/input_required_round2.json")
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.status).toBe("input_required");
      if (result.value.status === "input_required") {
        expect(result.value.interrupt.draft.a2ui.surface_id).toBe("sfc-contract-2");
      }
    }
  });

  it("rejects empty, malformed, unknown-status, missing-branch, and mixed branches", () => {
    const terminal = fixture("http/terminal_succeeded.json") as Record<string, unknown>;
    const input = fixture("http/input_required_round2.json") as Record<string, unknown>;
    const cases: [unknown, A2uiDecodeReason][] = [
      [null, "invalid_object"],
      [[], "invalid_object"],
      [{ run_id: "run-1" }, "status_unsupported"],
      [{ status: "unknown", run_id: "run-1" }, "status_unsupported"],
      [{ status: "succeeded", run_id: "run-1" }, "response_invalid"],
      [{ status: "input_required", run_id: "run-1" }, "response_invalid"],
      [
        { ...terminal, status: "input_required", interrupt: input.interrupt },
        "response_invalid",
      ],
      [
        { ...input, status: "succeeded", result: terminal.result },
        "response_invalid",
      ],
    ];
    for (const [value, reason] of cases) expectReason(decodeA2uiActionResponse(value), reason);
  });

  it("does not accept conflict_not_open as a success response", () => {
    expectReason(
      decodeA2uiActionResponse(fixture("http/conflict_not_open.json")),
      "status_unsupported"
    );
  });

  it("requires a bounded trimmed run_id", () => {
    const response = fixture("http/terminal_succeeded.json") as Record<string, unknown>;
    for (const run_id of ["", " run-1", "run-1 ", "x".repeat(257)]) {
      const result = decodeA2uiActionResponse({ ...response, run_id });
      expectReason(
        result,
        run_id.length > A2UI_LIMITS.identifierChars ? "limit_exceeded" : "identifier_invalid"
      );
    }
  });

  it("preserves typed result data without exposing arbitrary envelope fields", () => {
    const result = decodeA2uiActionResponse({
      ...fixture("http/terminal_succeeded.json"),
      attacker: "ignored",
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).not.toHaveProperty("attacker");
      expect(result.value).toMatchObject({ status: "succeeded", run_id: "run-contract-1" });
    }
  });
});

describe("parseA2uiCustomValue alias", () => {
  it("uses the strict open-surface decoder", () => {
    const result = parseA2uiCustomValue(openSurface("confirm", confirmProps));
    expect(result.ok).toBe(true);
    if (result.ok) {
      const value: A2uiOpenSurface = result.value;
      expect(value.widget).toBe("confirm");
    }
  });

  it("returns enum reasons only and never attacker-controlled text", () => {
    const result = parseA2uiCustomValue({
      catalog_version: "v1.0",
      surface_id: "secret-should-not-appear",
      widget: "<script>alert(1)</script>",
      props: {},
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("widget_unsupported");
    expect(JSON.stringify(result)).not.toContain("secret-should-not-appear");
  });
});
