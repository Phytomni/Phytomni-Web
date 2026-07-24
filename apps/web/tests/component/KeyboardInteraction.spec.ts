import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const source = (relativePath: string) =>
  readFileSync(resolve(__dirname, "../../src", relativePath), "utf8");

const MAIN_CSS = source("assets/main.css");
const LAYOUT = source("layout/LayoutView.vue");
const SIDEBAR = source("views/chat/ChatSidebar.vue");
const NAV = source("views/chat/components/ChatSidebarNav.vue");
const PICKER = source("views/chat/components/ChatAgentPicker.vue");
const ARTIFACT = source("components/research/ResearchArtifactShell.vue");
const EVIDENCE = source("components/research/ResearchEvidencePanel.vue");
const FOLLOW_UP = source("views/chat/FollowUpQuestions.vue");
const ADAPTIVE_SIDEBAR = source("components/shell/PhyAdaptiveSidebar.vue");
const AGENT_PREVIEW = source("components/agent/AgentCapabilityPopover.vue");
const THEME_SWITCH = source("components/ThemeSwitch.vue");
const LANG_SWITCH = source("components/LangSwitch.vue");

describe("Keyboard interaction contract", () => {
  it("keeps custom navigation and disclosure controls semantic", () => {
    expect(LAYOUT).toContain('class="collapse-btn"');
    expect(LAYOUT).toMatch(/class="collapse-btn"[\s\S]*aria-label/);
    expect(LAYOUT).toMatch(/class="collapse-btn"[\s\S]*type="button"/);
    expect(NAV).toContain("<button");
    expect(FOLLOW_UP).toMatch(
      /<button[\s\S]*data-testid="follow-up-suggestion"/
    );
    expect(PICKER).toContain('role="combobox"');
    expect(ARTIFACT).toContain('role="tab"');
    expect(EVIDENCE).toContain('tabindex="-1"');
  });

  it("keeps focus visible and preserves drawer focus affordances", () => {
    expect(MAIN_CSS).toContain(":focus-visible");
    expect(MAIN_CSS).toContain("var(--phy-color-focus)");
    expect(SIDEBAR).toContain("<PhyAdaptiveSidebar");
    expect(SIDEBAR).toContain('@close="handleDrawerClose"');
    expect(SIDEBAR).toMatch(
      /const handleDrawerClose = \(\) => \{[\s\S]*?closeAgentDisclosure\(\);[\s\S]*?closeDrawer\(\);/
    );
    expect(SIDEBAR).not.toMatch(/outline:\s*(?:none|0|unset)\b/);
    expect(PICKER).toContain(".picker-combobox:focus-visible");
    expect(PICKER).not.toMatch(/outline:\s*(?:none|0|unset)\b/);
    expect(THEME_SWITCH).toContain(":focus-visible");
    expect(LANG_SWITCH).toContain(":focus-visible");
    expect(AGENT_PREVIEW).toContain(
      ".agent-capability-popover__close:focus-visible"
    );
  });

  it("keeps motion and high-contrast behavior explicit", () => {
    expect(MAIN_CSS).toContain("@media (forced-colors: active)");
    expect(MAIN_CSS).toContain("@media (prefers-reduced-motion: reduce)");
    expect(MAIN_CSS).toMatch(/outline-color:\s*Highlight/);
    expect(MAIN_CSS).toMatch(/border-color:\s*ButtonText/);
    expect(MAIN_CSS).toMatch(/transition-duration:\s*0\.01ms\s*!important/);
    expect(ADAPTIVE_SIDEBAR).toMatch(
      /@media \(prefers-reduced-motion: reduce\)[\s\S]*?transition:\s*none/
    );
    expect(LAYOUT).not.toMatch(/transition:\s*all\b/);
    expect(FOLLOW_UP).not.toMatch(/transition:\s*all\b/);
  });
});
