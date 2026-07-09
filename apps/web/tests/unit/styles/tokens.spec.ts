import { describe, it, expect } from "vitest";
import { PHY_TOKENS, BANNED_BRAND_HEX } from "@/styles/tokens";

describe("PHY_TOKENS", () => {
  it("locks Quiet Lab primary and accent hex values", () => {
    expect(PHY_TOKENS.primary).toBe("#3A83F7");
    expect(PHY_TOKENS.primaryHover).toBe("#6BA4F9");
    expect(PHY_TOKENS.primarySoft).toBe("#D6E6FE");
    expect(PHY_TOKENS.accent).toBe("#14644A");
    expect(PHY_TOKENS.accentHover).toBe("#3D8F72");
    expect(PHY_TOKENS.accentSoft).toBe("#D7EDE5");
    expect(PHY_TOKENS.bgPage).toBe("#F7F9FC");
    expect(PHY_TOKENS.bgSidebar).toBe("#F5F7FA");
    expect(PHY_TOKENS.text).toBe("#14201B");
  });

  it("lists legacy competing brand hexes as banned", () => {
    const banned = new Set(BANNED_BRAND_HEX.map((h) => h.toLowerCase()));
    for (const hex of [
      "#409eff",
      "#66b1ff",
      "#1890ff",
      "#626aef",
      "#4b6bfb",
      "#4f46e5",
      "#7c3aed",
      "#7171c6",
    ]) {
      expect(banned.has(hex.toLowerCase())).toBe(true);
    }
  });
});
