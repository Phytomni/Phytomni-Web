import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const source = (relativePath: string): string =>
  readFileSync(resolve(__dirname, "../../../src", relativePath), "utf8");

const testSource = (relativePath: string): string =>
  readFileSync(resolve(__dirname, "../../..", relativePath), "utf8");

describe("no-misused-promises callback contracts", () => {
  it("keeps research evidence focus synchronous without a native async listener", () => {
    const panel = source("components/research/ResearchEvidencePanel.vue");

    expect(panel).toContain(
      "function focusReferences(indices: readonly number[]): boolean {"
    );
    expect(panel).toContain("defineExpose({ focusReferences });");
    expect(panel).not.toContain('addEventListener("click"');
    expect(panel).not.toContain("async function focusReferences");
  });

  it("keeps logout and password handlers synchronous at void-return boundaries", () => {
    const layout = source("layout/LayoutView.vue");
    const profile = source("views/profile/ProfileView.vue");
    const changePassword = source(
      "views/change-password/ChangePasswordView.vue"
    );

    expect(layout).toMatch(
      /UserStore\.FedLogOut\(\{ revoke: true \}\)[\s\S]*?\.catch\(\(\) => undefined\)\n\s*\.then\(\(\) => router\.replace\("\/login"\)\)\n\s*\.catch\(\(\) => undefined\);/
    );
    expect(profile).not.toContain("validate(async");
    expect(changePassword).not.toContain(".finally(() => {");
    expect(changePassword).toContain(
      'await router.replace("/login").catch(() => undefined);'
    );
  });

  it("declares the injected chat scroll contract as Promise<void> and handles every call", () => {
    for (const relativePath of [
      "views/chat/composables/useComposer.ts",
      "views/chat/composables/useLogView.ts",
      "views/chat/composables/useFileUpload.ts",
      "views/chat/composables/useReactions.ts",
    ]) {
      const chatComposable = source(relativePath);
      expect(chatComposable).toContain("scrollToBottom: () => Promise<void>;");
      expect(chatComposable).not.toMatch(/nextTick\(scrollToBottom\)/);
      expect(chatComposable).toContain(
        "scrollToBottom().catch(() => undefined);"
      );
    }
  });

  it("uses the FontFaceSet object for feature detection in visual fixtures", () => {
    const chatFixture = testSource("tests/visual/chat/main.ts");
    const researchFixture = testSource("tests/visual/research/main.ts");

    expect(chatFixture).toContain("if (document.fonts) {");
    expect(researchFixture).toContain("if (document.fonts) {");
    expect(chatFixture).not.toContain("if (document.fonts?.ready)");
    expect(researchFixture).not.toContain("if (document.fonts?.ready)");
  });
});
