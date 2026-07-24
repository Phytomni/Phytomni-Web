import { describe, expect, it } from "vitest";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const WEB_ROOT = resolve(__dirname, "../../..");
const SOURCE_ROOT = resolve(WEB_ROOT, "src");
const SHELL_EXPORTS = resolve(SOURCE_ROOT, "components/shell/index.ts");
const MAIN_SOURCE = readFileSync(resolve(SOURCE_ROOT, "main.ts"), "utf8");
const VITEST_SOURCE = readFileSync(
  resolve(WEB_ROOT, "vitest.config.mts"),
  "utf8"
);

const DELETED_FILES = [
  "components/shell/PhyAppShell.vue",
  "components/shell/PhySidebarFrame.vue",
  "components/shell/PhyComposerFrame.vue",
  "views/chat/composables/useAgentsPanel.ts",
  "views/chat/composables/useSidebarAgents.ts",
  "assets/theme.css",
];

const LEGACY_MARKERS = [
  "PhyAppShell",
  "PhySidebarFrame",
  "PhyComposerFrame",
  "useAgentsPanel",
  "useSidebarAgents",
  "message-fotter",
  "log-view-left",
  "log-view-right",
  "input-container-warpper",
  "input-container-bottom",
  "app-footer",
  "assets/theme.css",
];

function sourceFiles(root: string): string[] {
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(root, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.(vue|ts|css)$/.test(entry.name) ? [path] : [];
  });
}

describe("superseded visual infrastructure", () => {
  it("removes each approved legacy file", () => {
    for (const relativePath of DELETED_FILES) {
      expect(existsSync(resolve(SOURCE_ROOT, relativePath)), relativePath).toBe(
        false
      );
    }
  });

  it("keeps deleted shells and bridges out of active source", () => {
    const activeSource = sourceFiles(SOURCE_ROOT)
      .map((path) => readFileSync(path, "utf8"))
      .join("\n");

    for (const marker of LEGACY_MARKERS) {
      expect(activeSource, marker).not.toContain(marker);
    }
  });

  it("keeps shell exports, the production entrypoint, and coverage manifest current", () => {
    expect(readFileSync(SHELL_EXPORTS, "utf8")).not.toMatch(
      /Phy(?:AppShell|SidebarFrame|ComposerFrame)/
    );
    expect(MAIN_SOURCE).not.toContain("theme.css");
    expect(VITEST_SOURCE).not.toContain("useAgentsPanel.ts");
    expect(VITEST_SOURCE).not.toContain("useSidebarAgents.ts");
  });

  it("mounts even when the initial locale promise rejects", () => {
    expect(MAIN_SOURCE).toMatch(
      /setLanguage\(currentLang\)\.then\([\s\S]*?Failed to initialize the application locale:[\s\S]*?app\.mount\("#app"\)/
    );
  });
});
