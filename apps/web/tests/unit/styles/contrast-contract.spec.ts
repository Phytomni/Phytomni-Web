import { describe, expect, it } from "vitest";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const TOKENS_CSS = readFileSync(
  resolve(__dirname, "../../../src/styles/tokens.css"),
  "utf8"
);
const SOURCE_ROOT = resolve(__dirname, "../../../src");

type Rgb = readonly [number, number, number];

function modeBlock(selector: string): string {
  const block = TOKENS_CSS.match(
    new RegExp(`${selector}\\s*\\{([\\s\\S]*?)\\n\\}`)
  )?.[1];
  expect(block, `${selector} token block`).toBeDefined();
  return block ?? "";
}

function declarations(block: string): Map<string, string> {
  return new Map(
    [...block.matchAll(/^\s*(--[\w-]+):\s*([^;]+);/gm)].map(
      ([, name, value]) => [name, value.trim()]
    )
  );
}

function resolveColor(
  name: string,
  values: Map<string, string>,
  seen = new Set<string>()
): Rgb {
  const value = values.get(name) ?? name;
  const reference = value.match(/^var\((--[\w-]+)\)$/)?.[1];
  if (reference) {
    if (seen.has(reference)) {
      throw new Error(`cyclic color token reference: ${reference}`);
    }
    seen.add(reference);
    return resolveColor(reference, values, seen);
  }

  const hex = value.match(/^#([0-9a-f]{6})$/i)?.[1];
  if (!hex) {
    throw new Error(`unsupported color token: ${name} = ${value}`);
  }
  return [
    Number.parseInt(hex.slice(0, 2), 16),
    Number.parseInt(hex.slice(2, 4), 16),
    Number.parseInt(hex.slice(4, 6), 16),
  ];
}

function relativeLuminance([red, green, blue]: Rgb): number {
  const channel = (value: number) => {
    const normalized = value / 255;
    return normalized <= 0.03928
      ? normalized / 12.92
      : ((normalized + 0.055) / 1.055) ** 2.4;
  };
  return (
    0.2126 * channel(red) + 0.7152 * channel(green) + 0.0722 * channel(blue)
  );
}

function contrastRatio(foreground: Rgb, background: Rgb): number {
  const foregroundLuminance = relativeLuminance(foreground);
  const backgroundLuminance = relativeLuminance(background);
  const lighter = Math.max(foregroundLuminance, backgroundLuminance);
  const darker = Math.min(foregroundLuminance, backgroundLuminance);
  return (lighter + 0.05) / (darker + 0.05);
}

function vueFiles(root: string): string[] {
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(root, entry.name);
    if (entry.isDirectory()) return vueFiles(path);
    return entry.name.endsWith(".vue") ? [path] : [];
  });
}

const requiredTextPairs = [
  ["--phy-color-text", "--phy-color-bg-page"],
  ["--phy-color-text-secondary", "--phy-color-bg-page"],
  ["--phy-color-text-muted", "--phy-color-bg-page"],
  ["--phy-color-text-placeholder", "--phy-color-bg-page"],
  ["--phy-color-text", "--phy-color-bg-elevated"],
  ["--phy-color-text-secondary", "--phy-color-bg-elevated"],
  ["--phy-color-text-placeholder", "--phy-color-bg-elevated"],
  ["--phy-color-on-action", "--phy-color-action-fill"],
  ["--phy-color-on-action", "--phy-color-accent"],
  ["--phy-color-action-text", "--phy-color-bg-page"],
  ["--phy-color-action-text-hover", "--phy-color-bg-page"],
  ["--phy-color-accent-text", "--phy-color-bg-page"],
  ["--phy-color-text", "--phy-color-bubble-user"],
  ["--phy-color-text", "--phy-color-bubble-assistant"],
] as const;

const requiredBoundaryPairs = [
  ["--phy-color-border-control", "--phy-color-bg-page"],
  ["--phy-color-focus", "--phy-color-bg-page"],
  ["--phy-color-action-fill", "--phy-color-bg-page"],
  ["--phy-color-accent", "--phy-color-bg-page"],
  ["--phy-color-accent-hover", "--phy-color-bg-page"],
] as const;

describe("semantic color contrast contract", () => {
  it("keeps the exact semantic key set symmetric across light and dark modes", () => {
    const light = declarations(modeBlock(":root,\\s*\\.theme-light"));
    const dark = declarations(modeBlock("\\.theme-dark"));
    expect([...light.keys()].sort()).toEqual([...dark.keys()].sort());
  });

  it("meets AA text contrast and 3:1 non-text boundary contrast in both modes", () => {
    for (const [selector, pairs, minimum] of [
      ["light", requiredTextPairs, 4.5],
      ["dark", requiredTextPairs, 4.5],
    ] as const) {
      const values = declarations(
        modeBlock(
          selector === "light" ? ":root,\\s*\\.theme-light" : "\\.theme-dark"
        )
      );
      for (const [foreground, background] of pairs) {
        expect(
          contrastRatio(
            resolveColor(foreground, values),
            resolveColor(background, values)
          ),
          `${selector}: ${foreground} on ${background}`
        ).toBeGreaterThanOrEqual(minimum);
      }
    }

    for (const selector of [":root,\\s*\\.theme-light", "\\.theme-dark"]) {
      const values = declarations(modeBlock(selector));
      for (const [foreground, background] of requiredBoundaryPairs) {
        expect(
          contrastRatio(
            resolveColor(foreground, values),
            resolveColor(background, values)
          ),
          `${selector}: ${foreground} against ${background}`
        ).toBeGreaterThanOrEqual(3);
      }
    }
  });

  it("keeps Element Plus success fills and text roles separate", () => {
    for (const selector of [":root,\\s*\\.theme-light", "\\.theme-dark"]) {
      const block = modeBlock(selector);
      expect(block).toContain("--el-color-success: var(--phy-color-accent);");
      expect(block).toContain(
        "--el-color-success-dark-2: var(--phy-color-accent-hover);"
      );
      expect(block).toContain(
        "--el-color-success-text: var(--phy-color-accent-text);"
      );
      expect(block).toContain(
        "--el-color-success-rgb: var(--phy-color-accent-rgb);"
      );
    }
    expect(TOKENS_CSS).toMatch(
      /\.el-(?:link|button|tag)[^{}]*--success[^{}]*\{[\s\S]*?var\(--phy-color-accent-text\)/
    );
  });

  it("keeps bubbles opaque and removes the compatibility stylesheet", () => {
    for (const selector of [".phy-bubble-user", ".phy-bubble-assistant"]) {
      const rule = TOKENS_CSS.match(
        new RegExp(`${selector}\\s*\\{([\\s\\S]*?)\\n\\}`)
      )?.[1];
      expect(rule, `${selector} rule`).toBeDefined();
      expect(rule).not.toMatch(/transparent|color-mix|backdrop-filter/);
    }

    expect(
      existsSync(resolve(__dirname, "../../../src/assets/theme.css"))
    ).toBe(false);
  });

  it("rejects scoped page-local dark-mode visual overrides", () => {
    const violations = vueFiles(SOURCE_ROOT).filter((path) =>
      /\.theme-dark|:global\(\.theme-dark\)/.test(readFileSync(path, "utf8"))
    );
    expect(violations).toEqual([]);
  });
});
