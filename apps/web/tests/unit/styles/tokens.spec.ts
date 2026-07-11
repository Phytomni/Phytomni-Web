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

  it("exports the approved spacing, controls, layout, and responsive values", () => {
    expect({
      space4: PHY_TOKENS.space4,
      space8: PHY_TOKENS.space8,
      space12: PHY_TOKENS.space12,
      space16: PHY_TOKENS.space16,
      space20: PHY_TOKENS.space20,
      space24: PHY_TOKENS.space24,
      space32: PHY_TOKENS.space32,
      space40: PHY_TOKENS.space40,
      space48: PHY_TOKENS.space48,
      space64: PHY_TOKENS.space64,
      controlHeightCompact: PHY_TOKENS.controlHeightCompact,
      controlHeightDefault: PHY_TOKENS.controlHeightDefault,
      controlHeightPrimary: PHY_TOKENS.controlHeightPrimary,
      sidebarExpandedWidth: PHY_TOKENS.sidebarExpandedWidth,
      sidebarCompactWidth: PHY_TOKENS.sidebarCompactWidth,
      transcriptMaxWidth: PHY_TOKENS.transcriptMaxWidth,
      readingMaxWidth: PHY_TOKENS.readingMaxWidth,
      artifactChatMinWidth: PHY_TOKENS.artifactChatMinWidth,
      artifactContentMinWidth: PHY_TOKENS.artifactContentMinWidth,
      breakpointSmall: PHY_TOKENS.breakpointSmall,
      breakpointMedium: PHY_TOKENS.breakpointMedium,
      breakpointLarge: PHY_TOKENS.breakpointLarge,
      motionFast: PHY_TOKENS.motionFast,
      motionNormal: PHY_TOKENS.motionNormal,
      motionSlow: PHY_TOKENS.motionSlow,
      motionEaseOut: PHY_TOKENS.motionEaseOut,
      zSticky: PHY_TOKENS.zSticky,
      zDropdown: PHY_TOKENS.zDropdown,
      zDrawer: PHY_TOKENS.zDrawer,
      zModal: PHY_TOKENS.zModal,
      zToast: PHY_TOKENS.zToast,
      zTransfer: PHY_TOKENS.zTransfer,
    }).toEqual({
      space4: "4px",
      space8: "8px",
      space12: "12px",
      space16: "16px",
      space20: "20px",
      space24: "24px",
      space32: "32px",
      space40: "40px",
      space48: "48px",
      space64: "64px",
      controlHeightCompact: "32px",
      controlHeightDefault: "40px",
      controlHeightPrimary: "48px",
      sidebarExpandedWidth: "272px",
      sidebarCompactWidth: "56px",
      transcriptMaxWidth: "860px",
      readingMaxWidth: "760px",
      artifactChatMinWidth: "360px",
      artifactContentMinWidth: "560px",
      breakpointSmall: "600px",
      breakpointMedium: "900px",
      breakpointLarge: "1280px",
      motionFast: "150ms",
      motionNormal: "220ms",
      motionSlow: "360ms",
      motionEaseOut: "cubic-bezier(0.22, 1, 0.36, 1)",
      zSticky: 10,
      zDropdown: 100,
      zDrawer: 1000,
      zModal: 2000,
      zToast: 3000,
      zTransfer: 4000,
    });
  });

  it("keeps the token sheet as the single source for layout measures", () => {
    const declarations = [
      "--phy-layout-sidebar-expanded-width",
      "--phy-layout-sidebar-compact-width",
      "--phy-layout-transcript-max-width",
      "--phy-layout-reading-max-width",
      "--phy-layout-artifact-chat-min-width",
      "--phy-layout-artifact-content-min-width",
    ];

    for (const token of declarations) {
      expect(
        (TOKENS_CSS.match(new RegExp(`${token}\\s*:`, "g")) ?? []).length
      ).toBe(1);
    }
  });

  it("matches the CSS layout, responsive, motion, and z-index contract", () => {
    for (const declaration of [
      "--phy-space-4: 4px;",
      "--phy-space-8: 8px;",
      "--phy-space-12: 12px;",
      "--phy-space-16: 16px;",
      "--phy-space-20: 20px;",
      "--phy-space-24: 24px;",
      "--phy-space-32: 32px;",
      "--phy-space-40: 40px;",
      "--phy-space-48: 48px;",
      "--phy-space-64: 64px;",
      "--phy-control-height-compact: 32px;",
      "--phy-control-height-default: 40px;",
      "--phy-control-height-primary: 48px;",
      "--phy-layout-sidebar-expanded-width: 272px;",
      "--phy-layout-sidebar-compact-width: 56px;",
      "--phy-layout-transcript-max-width: 860px;",
      "--phy-layout-reading-max-width: 760px;",
      "--phy-layout-artifact-chat-min-width: 360px;",
      "--phy-layout-artifact-content-min-width: 560px;",
      "--phy-breakpoint-small: 600px;",
      "--phy-breakpoint-medium: 900px;",
      "--phy-breakpoint-large: 1280px;",
      "--phy-motion-fast: 150ms;",
      "--phy-motion-normal: 220ms;",
      "--phy-motion-slow: 360ms;",
      "--phy-motion-ease-out: cubic-bezier(0.22, 1, 0.36, 1);",
      "--phy-z-sticky: 10;",
      "--phy-z-dropdown: 100;",
      "--phy-z-drawer: 1000;",
      "--phy-z-modal: 2000;",
      "--phy-z-toast: 3000;",
      "--phy-z-transfer: 4000;",
    ]) {
      expect(TOKENS_CSS).toContain(declaration);
    }
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
