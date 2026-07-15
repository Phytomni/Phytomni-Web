import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const CSS_PATHS = ["base.css", "main.css"] as const;
const CSS = Object.fromEntries(
  CSS_PATHS.map((filename) => [
    filename,
    readFileSync(resolve(__dirname, `../../../src/assets/${filename}`), "utf8"),
  ])
) as Record<typeof CSS_PATHS[number], string>;
const GLOBAL_CSS = Object.values(CSS).join("\n");
const TOKENS_CSS = readFileSync(
  resolve(__dirname, "../../../src/styles/tokens.css"),
  "utf8"
);

describe("global CSS contract", () => {
  it("removes Vue starter palette and system-color overrides", () => {
    expect(GLOBAL_CSS).not.toMatch(/--vt-[a-z0-9-]+\s*:/i);
    expect(CSS["base.css"]).not.toContain("prefers-color-scheme");
    expect(CSS["base.css"]).not.toContain("--color-background");
  });

  it("keeps the reset minimal and avoids global layout ownership", () => {
    const resetBlock = CSS["base.css"].match(
      /\*\s*,\s*\*::before\s*,\s*\*::after\s*\{([\s\S]*?)\n\}/
    )?.[1];
    expect(resetBlock).toBeDefined();
    expect(resetBlock).toContain("box-sizing: border-box;");
    expect(resetBlock).not.toMatch(/position\s*:/);
    expect(resetBlock).not.toMatch(/margin\s*:/);
    expect(resetBlock).not.toMatch(/padding\s*:/);
    expect(GLOBAL_CSS).not.toContain(".el-button + .el-button");
  });

  it("keeps universal selectors free of global layout and transition side effects", () => {
    const universalBlocks = [
      ...GLOBAL_CSS.matchAll(
        /(?:^|})\s*((?:\*(?:::[a-z-]+)?\s*,?\s*)+)\{([^{}]*)\}/gi
      ),
    ];
    for (const [, , declarations] of universalBlocks) {
      expect(declarations).not.toMatch(/\bposition\s*:\s*relative\b/i);
      expect(declarations).not.toMatch(/(?:-webkit-)?transition\s*:/i);
    }
  });

  it("keeps reduced-motion support in the semantic token owner", () => {
    expect(TOKENS_CSS).toContain("@media (prefers-reduced-motion: reduce)");
    expect(TOKENS_CSS).toContain("--phy-motion-fast: 0ms;");
    expect(TOKENS_CSS).toContain("--phy-motion-normal: 0ms;");
  });

  it("limits transitions to explicit interactive anchor behavior", () => {
    expect(CSS["base.css"]).not.toMatch(/\btransition\s*:/);
    expect(CSS["main.css"]).toMatch(
      /a\s*\{[\s\S]*transition:\s*color\s+var\(--phy-motion-fast\)\s+ease-out;/
    );
    expect(CSS["main.css"]).not.toMatch(/transition\s*:\s*all\b/);
  });

  it("provides an accessible anchor baseline", () => {
    expect(CSS["main.css"]).toMatch(
      /a\s*\{[\s\S]*color:\s*var\(--phy-color-action-text\);/
    );
    expect(CSS["main.css"]).toMatch(
      /a\s*\{[\s\S]*text-decoration:\s*underline;/
    );
    expect(CSS["main.css"]).toContain("a:focus-visible");
    expect(CSS["main.css"]).toContain("var(--phy-color-focus)");
  });

  it("provides one global focus-visible, forced-colors, and reduced-motion baseline", () => {
    expect(CSS["main.css"]).toMatch(/:focus-visible\s*\{[\s\S]*outline:/);
    expect(CSS["main.css"]).toContain("@media (forced-colors: active)");
    expect(CSS["main.css"]).toContain("outline-color: Highlight");
    expect(CSS["main.css"]).toContain(
      "@media (prefers-reduced-motion: reduce)"
    );
    expect(CSS["main.css"]).toContain("transition-duration: 0.01ms");
    expect(GLOBAL_CSS).not.toMatch(/transition:\s*all\b/);
    expect(GLOBAL_CSS).not.toMatch(/outline:\s*(?:none|0|unset)\b/);
  });

  it("keeps Element Plus inputs visible in forced-colors mode", () => {
    expect(CSS["main.css"]).toMatch(
      /\.el-input__wrapper\s*\{\s*border:\s*1px solid ButtonText;\s*\}/
    );
    expect(CSS["main.css"]).toMatch(
      /\.el-input__wrapper:focus-within\s*\{[\s\S]*outline:\s*2px solid Highlight;[\s\S]*outline-offset:\s*2px;/
    );
  });
});
