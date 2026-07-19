import { describe, it, expect } from "vitest";
import { isNetworkError } from "@/utils/network-error";

describe("isNetworkError", () => {
  it('returns true for { message: "Network Error" } (detection rule a)', () => {
    expect(isNetworkError({ message: "Network Error" })).toBe(true);
  });

  it('returns true for { message: "timeout of 30000ms exceeded" } (detection rule b — substring match)', () => {
    expect(isNetworkError({ message: "timeout of 30000ms exceeded" })).toBe(
      true
    );
  });

  it('returns true for { code: "ECONNABORTED" } (detection rule c — axios timeout code)', () => {
    expect(isNetworkError({ code: "ECONNABORTED" })).toBe(true);
  });

  it('returns true for { message: "ERR_GENERIC" } with no response/code (detection rule d — catchall)', () => {
    expect(isNetworkError({ message: "ERR_GENERIC" })).toBe(true);
  });

  it('returns false for { response: { status: 500 }, message: "Server Error" } (server-level, not network)', () => {
    expect(
      isNetworkError({ response: { status: 500 }, message: "Server Error" })
    ).toBe(false);
  });

  it("returns false for null/undefined/string/number/empty-object inputs (no throw, no false positive)", () => {
    const inputs: unknown[] = [
      null,
      undefined,
      "string literal",
      42,
      {},
      true,
      false,
    ];
    for (const input of inputs) {
      expect(isNetworkError(input)).toBe(false);
    }
  });

  it('returns false for { message: "" } (rule-d length guard — empty message must not catchall)', () => {
    expect(isNetworkError({ message: "" })).toBe(false);
  });
});
