import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import enUS from "@/locales/langs/en-US";
import zhCN from "@/locales/langs/zh-CN";

const LAYOUT_SOURCE = readFileSync(
  resolve(__dirname, "../../src/layout/index.vue"),
  "utf8"
);
const THEME_SOURCE = readFileSync(
  resolve(__dirname, "../../src/components/ThemeSwitch.vue"),
  "utf8"
);
const LANG_SOURCE = readFileSync(
  resolve(__dirname, "../../src/components/LangSwitch.vue"),
  "utf8"
);

describe("Global application chrome", () => {
  it("removes the empty brand spacer and constrains both header groups", () => {
    expect(LAYOUT_SOURCE).not.toContain('class="logo-img"');
    expect(LAYOUT_SOURCE).toMatch(/\.logo\s*\{[\s\S]*min-width:\s*0/);
    expect(LAYOUT_SOURCE).toMatch(/\.header-right\s*\{[\s\S]*min-width:\s*0/);
    expect(LAYOUT_SOURCE).toMatch(/@media\s*\(max-width:\s*599px\)/);
    expect(LAYOUT_SOURCE).toMatch(/\.username\s*\{[\s\S]*display:\s*none/);
  });

  it("uses compact switch labels without fixed trigger minimum widths", () => {
    expect(THEME_SOURCE).toMatch(/@media\s*\(max-width:\s*599px\)/);
    expect(THEME_SOURCE).toMatch(
      /\.theme-label,\s*\.theme-dropdown-link \.el-icon--right\s*\{[\s\S]*display:\s*none/
    );
    expect(THEME_SOURCE).not.toMatch(/min-width:\s*80px/);
    expect(LANG_SOURCE).toMatch(/\.lang-label-compact/);
    expect(LANG_SOURCE).toMatch(/@media\s*\(max-width:\s*599px\)/);
  });

  it("keeps bilingual theme and control labels in parity", () => {
    expect(enUS.common.lightTheme).toBe("Light");
    expect(zhCN.common.lightTheme).toBe("浅色");
    expect(enUS.common.darkTheme).toBe("Dark");
    expect(zhCN.common.darkTheme).toBe("深色");
    expect(enUS.common.themeSelector).toBe("Choose theme");
    expect(zhCN.common.themeSelector).toBe("选择主题");
    expect(enUS.common.languageSelector).toBe("Choose language");
    expect(zhCN.common.languageSelector).toBe("选择语言");
  });
});
