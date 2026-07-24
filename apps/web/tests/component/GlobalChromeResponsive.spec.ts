import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import enUS from "@/locales/langs/en-US";
import zhCN from "@/locales/langs/zh-CN";
import {
  RESPONSIVE_VIEWPORTS,
  SEMANTIC_BOUNDARIES,
} from "../helpers/responsiveMatrix";

const LAYOUT_SOURCE = readFileSync(
  resolve(__dirname, "../../src/layout/LayoutView.vue"),
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
const USER_LIST_SOURCE = readFileSync(
  resolve(__dirname, "../../src/views/user-list/UserListView.vue"),
  "utf8"
);
const TABLE_FRAME_SOURCE = readFileSync(
  resolve(__dirname, "../../src/components/shell/PhyTableFrame.vue"),
  "utf8"
);
const APP_SOURCE = readFileSync(
  resolve(__dirname, "../../src/App.vue"),
  "utf8"
);
const AUTH_LAYOUT_SOURCE = readFileSync(
  resolve(__dirname, "../../src/components/shell/PhyAuthLayout.vue"),
  "utf8"
);
const HELP_SOURCE = readFileSync(
  resolve(__dirname, "../../src/views/help/HelpView.vue"),
  "utf8"
);
const LEGAL_SOURCE = readFileSync(
  resolve(__dirname, "../../src/views/legal/LegalView.vue"),
  "utf8"
);
const CHAT_ROW_SOURCE = readFileSync(
  resolve(__dirname, "../../src/views/chat/components/ChatMessageRow.vue"),
  "utf8"
);
const ADAPTIVE_SHELL_SOURCE = readFileSync(
  resolve(__dirname, "../../src/components/shell/PhyAdaptiveShell.vue"),
  "utf8"
);
const CHAT_FIXTURE_SOURCE = readFileSync(
  resolve(__dirname, "../../tests/visual/chat/ChatVisualFixtureApp.vue"),
  "utf8"
);
const DESIGN_SYSTEM_SOURCE = readFileSync(
  resolve(__dirname, "../../../../docs/frontend-design-system.md"),
  "utf8"
);

describe("responsive matrix", () => {
  it("contains the agreed widths and boundaries", () => {
    expect(RESPONSIVE_VIEWPORTS.map(({ width }) => width)).toEqual([
      320, 390, 480, 768, 899, 900, 1024, 1199, 1279, 1280, 1366, 1920, 2560,
    ]);
    expect(SEMANTIC_BOUNDARIES).toEqual({
      small: 600,
      medium: 900,
      large: 1280,
    });
  });

  it("records continuous responsive geometry in the design-system contract", () => {
    expect(DESIGN_SYSTEM_SOURCE).toContain("continuous geometry");
    expect(DESIGN_SYSTEM_SOURCE).toContain("container queries");
    expect(DESIGN_SYSTEM_SOURCE).toContain("2560x1440");
  });
});

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

  it("turns the legacy layout sidebar into a mobile drawer", () => {
    expect(LAYOUT_SOURCE).toContain("isMobileViewport");
    expect(LAYOUT_SOURCE).toContain("mobileSidebarOpen");
    expect(LAYOUT_SOURCE).toContain('class="mobile-sidebar-toggle"');
    expect(LAYOUT_SOURCE).toContain('class="mobile-sidebar-backdrop"');
    expect(LAYOUT_SOURCE).toMatch(/@media\s*\(max-width:\s*899px\)/);
  });

  it("keeps the user table scrollable and its pager compact on phones", () => {
    expect(TABLE_FRAME_SOURCE).toContain('data-horizontal-scroll="table"');
    expect(USER_LIST_SOURCE).toMatch(
      /el-pagination__jump[\s\S]*display:\s*none/
    );
    expect(USER_LIST_SOURCE).toContain("PhyWorkspaceShell");
    expect(USER_LIST_SOURCE).toContain("PhyTableFrame");
    expect(USER_LIST_SOURCE).toContain("min-width");
  });

  it("moves auth and document footers into their own scroll roots", () => {
    expect(APP_SOURCE).not.toContain("Footer");
    expect(APP_SOURCE).not.toContain("/help");
    expect(APP_SOURCE).not.toContain("/terms");
    expect(APP_SOURCE).not.toContain("/privacy");
    expect(AUTH_LAYOUT_SOURCE).toContain("phy-auth-footer");
    expect(HELP_SOURCE).toContain('data-scroll-root="help"');
    expect(HELP_SOURCE).toContain("help-footer");
    expect(LEGAL_SOURCE).toContain('data-scroll-root="legal"');
    expect(LEGAL_SOURCE).toContain("legal-footer");
  });

  it("uses the product mark for assistant message identity", () => {
    expect(CHAT_ROW_SOURCE).toContain("@/assets/images/chat/logo.png");
    expect(CHAT_ROW_SOURCE).not.toContain("/avatars/bot.svg");
  });

  it("removes readable content behind an open mobile drawer", () => {
    expect(ADAPTIVE_SHELL_SOURCE).toMatch(
      /\.phy-adaptive-shell__main\[aria-hidden="true"\][\s\S]*visibility:\s*hidden/
    );
    expect(CHAT_FIXTURE_SOURCE).toContain(".empty-chat");
    expect(CHAT_FIXTURE_SOURCE).toContain("flex: 1;");
  });
});
