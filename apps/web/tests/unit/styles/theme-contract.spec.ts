import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const TOKENS_CSS = readFileSync(
  resolve(__dirname, "../../../src/styles/tokens.css"),
  "utf8"
);
const THEME_CSS = readFileSync(
  resolve(__dirname, "../../../src/assets/theme.css"),
  "utf8"
);

function modeBlock(selector: string): string {
  const block = TOKENS_CSS.match(
    new RegExp(`${selector}\\s*\\{([\\s\\S]*?)\\n\\}`)
  )?.[1];
  expect(block, `${selector} token block`).toBeDefined();
  return block ?? "";
}

const lightTokens: Record<string, string> = {
  "--phy-color-bg-page": "#f7f9fc",
  "--phy-color-bg-elevated": "#ffffff",
  "--phy-color-bg-sidebar": "#f5f7fa",
  "--phy-color-fill-subtle": "#eef3f0",
  "--phy-color-overlay": "rgba(10, 24, 18, 0.48)",
  "--phy-color-text": "#14201b",
  "--phy-color-text-secondary": "#5b6b63",
  "--phy-color-text-muted": "#68776f",
  "--phy-color-text-placeholder": "#65736b",
  "--phy-color-text-disabled": "#7c8981",
  "--phy-color-border-subtle": "#e6ebe7",
  "--phy-color-border-control": "#6f7d75",
  "--phy-color-action-fill": "#2f6fd4",
  "--phy-color-action-fill-hover": "#255eb8",
  "--phy-color-on-action": "#ffffff",
  "--phy-color-action-text": "#2f6fd4",
  "--phy-color-action-text-hover": "#255eb8",
  "--phy-color-focus": "#2f6fd4",
  "--phy-color-brand-blue": "#3a83f7",
  "--phy-color-brand-blue-soft": "#d6e6fe",
  "--phy-color-accent": "#14644a",
  "--phy-color-accent-hover": "#0f4d39",
  "--phy-color-accent-soft": "#d7ede5",
  "--phy-color-accent-text": "#14644a",
  "--phy-color-bubble-user": "#eaf6f1",
  "--phy-color-bubble-user-border": "#cfe8dc",
  "--phy-color-bubble-assistant": "#eaf2fe",
  "--phy-color-bubble-assistant-border": "#d5e5fc",
  "--el-color-primary": "var(--phy-color-action-fill)",
  "--el-color-primary-dark-2": "var(--phy-color-action-fill-hover)",
  "--el-color-primary-light-3": "#6d9ae1",
  "--el-color-primary-light-5": "#97b7ea",
  "--el-color-primary-light-7": "#c1d4f2",
  "--el-color-primary-light-8": "#d5e2f6",
  "--el-color-primary-light-9": "#eaf1fb",
  "--el-color-success": "#14644a",
  "--el-color-success-dark-2": "#0f4d39",
  "--el-color-success-light-3": "#3d8f72",
  "--el-color-success-light-5": "#7eb59a",
  "--el-color-success-light-7": "#b6d7c8",
  "--el-color-success-light-8": "#d7ede5",
  "--el-color-success-light-9": "#eaf6f1",
};

const darkTokens: Record<string, string> = {
  "--phy-color-bg-page": "#101815",
  "--phy-color-bg-elevated": "#17221d",
  "--phy-color-bg-sidebar": "#121d19",
  "--phy-color-fill-subtle": "#1d2b24",
  "--phy-color-overlay": "rgba(0, 0, 0, 0.64)",
  "--phy-color-text": "#f2f7f4",
  "--phy-color-text-secondary": "#b7c5be",
  "--phy-color-text-muted": "#9aaba2",
  "--phy-color-text-placeholder": "#a5b6ad",
  "--phy-color-text-disabled": "#7f9188",
  "--phy-color-border-subtle": "#2a3a32",
  "--phy-color-border-control": "#71857a",
  "--phy-color-action-fill": "#2f6fd4",
  "--phy-color-action-fill-hover": "#255eb8",
  "--phy-color-on-action": "#ffffff",
  "--phy-color-action-text": "#8cb8ff",
  "--phy-color-action-text-hover": "#b7d4ff",
  "--phy-color-focus": "#8cb8ff",
  "--phy-color-brand-blue": "#3a83f7",
  "--phy-color-brand-blue-soft": "#203d63",
  "--phy-color-accent": "#2b7a59",
  "--phy-color-accent-hover": "#347f61",
  "--phy-color-accent-soft": "#193a2e",
  "--phy-color-accent-text": "#7fd0ae",
  "--phy-color-bubble-user": "#17352a",
  "--phy-color-bubble-user-border": "#2b5b48",
  "--phy-color-bubble-assistant": "#182d49",
  "--phy-color-bubble-assistant-border": "#2c4d73",
  "--el-color-primary": "var(--phy-color-action-fill)",
  "--el-color-primary-dark-2": "var(--phy-color-action-fill-hover)",
  "--el-color-primary-light-3": "#295eaf",
  "--el-color-primary-light-5": "#244e8c",
  "--el-color-primary-light-7": "#1e3e69",
  "--el-color-primary-light-8": "#1b3458",
  "--el-color-primary-light-9": "#172a46",
  "--el-color-success": "#2b7a59",
  "--el-color-success-dark-2": "#347f61",
  "--el-color-success-light-3": "#245f46",
  "--el-color-success-light-5": "#204d3a",
  "--el-color-success-light-7": "#1c3b2e",
  "--el-color-success-light-8": "#193229",
  "--el-color-success-light-9": "#172922",
};

describe("semantic theme contract", () => {
  it("keeps the complete approved light palette and Element Plus bridges", () => {
    const block = modeBlock(":root,\\s*\\.theme-light");
    for (const [name, value] of Object.entries(lightTokens)) {
      expect(block).toContain(`${name}: ${value};`);
    }
    expect(block).toContain(
      "--phy-color-action: var(--phy-color-action-text);"
    );
    expect(block).toContain(
      "--phy-color-border: var(--phy-color-border-subtle);"
    );
  });

  it("keeps the complete approved dark palette and Element Plus bridges", () => {
    const block = modeBlock("\\.theme-dark");
    for (const [name, value] of Object.entries(darkTokens)) {
      expect(block).toContain(`${name}: ${value};`);
    }
    expect(block).toContain(
      "--phy-color-action: var(--phy-color-action-text);"
    );
    expect(block).toContain(
      "--phy-color-border: var(--phy-color-border-subtle);"
    );
  });

  it("leaves semantic root declarations out of the compatibility stylesheet", () => {
    expect(THEME_CSS).not.toMatch(/^\s+--(?:color|el)-[a-z-]+\s*:/m);
    expect(THEME_CSS).not.toContain("Global theme transition");
  });
});
