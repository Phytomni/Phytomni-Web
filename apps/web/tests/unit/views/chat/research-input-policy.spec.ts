import { describe, expect, it } from "vitest";
import {
  countUnicodeCodePoints,
  queryWithinLimit,
} from "@/views/chat/utils/research-input-policy";

describe("research input policy", () => {
  it("counts Unicode code points instead of UTF-16 code units", () => {
    expect(countUnicodeCodePoints("\u7a3b🧬")).toBe(2);
  });

  it("accepts exactly 131072 emoji code points", () => {
    expect(queryWithinLimit("🧬".repeat(131072), 131072)).toBe(true);
  });

  it("rejects 131073 emoji code points", () => {
    expect(queryWithinLimit("🧬".repeat(131073), 131072)).toBe(false);
  });

  it("uses trimming only to identify blank input", () => {
    expect(queryWithinLimit("\n  research question  \n", 23)).toBe(true);
    expect(queryWithinLimit(" \n\t ", 131072)).toBe(false);
  });
});
