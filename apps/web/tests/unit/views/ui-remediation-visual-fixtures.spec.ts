import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  UI_REMEDIATION_FIXTURE_KEYS,
  UI_REMEDIATION_LOCALES,
  resolveUiRemediationFixture,
} from "../../visual/ui-remediation/fixture-registry";

const webRoot = resolve(__dirname, "../../..");
const read = (path: string) => readFileSync(resolve(webRoot, path), "utf8");
const sourceFiles = (directory: string): string[] =>
  readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(directory, entry.name);
    return entry.isDirectory()
      ? sourceFiles(path)
      : /\.(ts|vue)$/.test(entry.name)
        ? [path]
        : [];
  });

describe("UI remediation visual fixtures", () => {
  it("resolves only the closed state and locale registry", () => {
    expect(UI_REMEDIATION_FIXTURE_KEYS).toHaveLength(7);
    expect(UI_REMEDIATION_LOCALES).toHaveLength(2);
    expect(resolveUiRemediationFixture("cases", "en-US")).toEqual({
      ok: true,
      state: "cases",
      locale: "en-US",
    });
    expect(resolveUiRemediationFixture(null, "en-US")).toMatchObject({
      ok: false,
    });
    expect(resolveUiRemediationFixture("cases", null)).toMatchObject({
      ok: false,
    });
  });

  it("keeps production ownership and the exact capture matrix", () => {
    const app = read(
      "tests/visual/ui-remediation/UiRemediationVisualFixtureApp.vue"
    );
    expect(app).toContain("ChangePasswordView");
    expect(app).toContain("MarkdownViewer");
    expect(app).toContain("ReviewAgentView");
    expect(app).toContain("BriefGeneAgentView");
    expect(app).toContain("ChatCases");
    expect(app).toContain("AgentCapabilityPopover");
    const capture = read("tests/visual/ui-remediation/capture-matrix.sh");
    expect(
      capture.match(/"[^"\n]+\|\d+\|\d+\|(en-US|zh-CN)"/g) ?? []
    ).toHaveLength(16);
    expect(capture).toContain("set -euo pipefail");
    const productionImports = sourceFiles(resolve(webRoot, "src"))
      .map((path) => readFileSync(path, "utf8"))
      .join("\n");
    expect(productionImports).not.toContain("tests/visual/ui-remediation");
  });
});
