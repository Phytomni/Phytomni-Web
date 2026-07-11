import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PHY_TOKENS, BANNED_BRAND_HEX } from "@/styles/tokens";

const TOKENS_CSS = readFileSync(
  resolve(__dirname, "../../../src/styles/tokens.css"),
  "utf8"
);

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

  it("locks split accessible action roles separately from brand blue", () => {
    expect(PHY_TOKENS.actionFill).toBe("#2F6FD4");
    expect(PHY_TOKENS.actionFillHover).toBe("#255EB8");
    expect(PHY_TOKENS.onAction).toBe("#FFFFFF");
    expect(PHY_TOKENS.actionText).toBe("#2F6FD4");
    expect(PHY_TOKENS.actionTextHover).toBe("#255EB8");
    expect(PHY_TOKENS.focus).toBe("#2F6FD4");
    expect(PHY_TOKENS.brandBlue).toBe("#3A83F7");
    expect(PHY_TOKENS.brandBlueSoft).toBe("#D6E6FE");
  });

  it("maps Element Plus primary companions to the approved action scale", () => {
    for (const declaration of [
      "--el-color-primary: var(--phy-color-action-fill);",
      "--el-color-primary-dark-2: var(--phy-color-action-fill-hover);",
      "--el-color-primary-light-3: #6d9ae1;",
      "--el-color-primary-light-5: #97b7ea;",
      "--el-color-primary-light-7: #c1d4f2;",
      "--el-color-primary-light-8: #d5e2f6;",
      "--el-color-primary-light-9: #eaf1fb;",
    ]) {
      expect(TOKENS_CSS).toContain(declaration);
    }
    expect(TOKENS_CSS).toContain(
      "--phy-color-action: var(--phy-color-action-text);"
    );
  });

  it("uses deterministic, very pale solid message bubbles", () => {
    for (const declaration of [
      "--phy-bubble-user-bg: #eaf6f1;",
      "--phy-bubble-user-border: #cfe8dc;",
      "--phy-bubble-assistant-bg: #eaf2fe;",
      "--phy-bubble-assistant-border: #d5e5fc;",
    ]) {
      expect(TOKENS_CSS).toContain(declaration);
    }

    const userRule = TOKENS_CSS.match(
      /\.phy-bubble-user\s*\{[\s\S]*?\n\}/
    )?.[0];
    const assistantRule = TOKENS_CSS.match(
      /\.phy-bubble-assistant\s*\{[\s\S]*?\n\}/
    )?.[0];
    expect(userRule).toBeDefined();
    expect(assistantRule).toBeDefined();
    expect(userRule).not.toMatch(/backdrop-filter|color-mix|transparent/);
    expect(assistantRule).not.toMatch(/backdrop-filter|color-mix|transparent/);
    expect(TOKENS_CSS).not.toContain("prefers-reduced-transparency");
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
