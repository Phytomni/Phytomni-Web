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
    expect(UI_REMEDIATION_FIXTURE_KEYS).toEqual([
      "change-password",
      "markdown",
      "review",
      "brief-gene",
      "cases",
      "review-preview",
      "brief-gene-preview",
    ]);
    expect(UI_REMEDIATION_LOCALES).toEqual(["en-US", "zh-CN"]);
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
    const entry = read("tests/visual/ui-remediation/main.ts");
    expect(entry).toContain('path: "/:pathMatch(.*)*"');
    const contracts = read("tests/visual/ui-remediation/assert-contracts.js");
    expect(contracts).toContain("control.disabled");
    expect(contracts).toContain('control.value === "researcher@example.test"');
    expect(contracts).not.toContain("document.body.textContent.includes");
    expect(contracts).toContain('"Os01g0177400"');
    const capture = read("tests/visual/ui-remediation/capture-matrix.sh");
    expect(capture.match(/"[^"\n]+\|\d+\|\d+\|(en-US|zh-CN)"/g)).toEqual([
      '"change-password|1190|903|en-US"',
      '"change-password|1190|903|zh-CN"',
      '"change-password|390|844|en-US"',
      '"change-password|390|844|zh-CN"',
      '"markdown|1190|903|zh-CN"',
      '"review|1190|903|en-US"',
      '"review|390|844|en-US"',
      '"brief-gene|1190|903|en-US"',
      '"brief-gene|390|844|en-US"',
      '"cases|1440|900|en-US"',
      '"cases|768|1024|en-US"',
      '"cases|390|844|en-US"',
      '"review-preview|1440|900|en-US"',
      '"review-preview|390|844|en-US"',
      '"brief-gene-preview|1440|900|en-US"',
      '"brief-gene-preview|390|844|en-US"',
    ]);
    expect(capture).toContain("set -euo pipefail");
    const productionImports = sourceFiles(resolve(webRoot, "src"))
      .map((path) => readFileSync(path, "utf8"))
      .join("\n");
    expect(productionImports).not.toContain("tests/visual/ui-remediation");
  });
});
