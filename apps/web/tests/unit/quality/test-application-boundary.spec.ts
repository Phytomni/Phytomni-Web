import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const APP_ROOT = resolve(__dirname, "../../..");
const BOUNDARY_SPEC = "tests/unit/quality/test-application-boundary.spec.ts";
const CONTEXT_HELPER = "tests/helpers/test-app-context.ts";
const CONTEXT_HELPER_SPEC = "tests/unit/helpers/test-app-context.spec.ts";

type TestSource = { path: string; source: string };

function trackedTestSources(): TestSource[] {
  // Vitest sandboxes child-process spawning, so inspect the checked-out test
  // tree directly. The repository keeps component/unit specs under this tree;
  // visual fixtures are deliberately a separate application boundary.
  const paths: string[] = [];
  const visit = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const absolutePath = resolve(directory, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== "visual") visit(absolutePath);
        continue;
      }
      if (
        (entry.name.endsWith(".spec.ts") || entry.name.endsWith(".test.ts")) &&
        !absolutePath.includes("/visual/")
      ) {
        paths.push(absolutePath.slice(APP_ROOT.length + 1));
      }
    }
  };
  visit(resolve(APP_ROOT, "tests"));

  return paths.map((path) => ({
    path,
    source: readFileSync(resolve(APP_ROOT, path), "utf8"),
  }));
}

function hasVueTestUtilsMount(source: string): boolean {
  // Method calls such as context.mount() and app.mount() are already owned by
  // an explicit application or visual fixture and are not raw VTU mounts.
  return /(?<![.\w])mount\s*\(/.test(source);
}

function findApplicationBoundaryViolations(files: TestSource[]): string[] {
  const violations: string[] = [];

  for (const { path, source } of files) {
    if (path === BOUNDARY_SPEC) continue;

    if (/config\s*\.\s*global\s*\.\s*plugins/.test(source)) {
      violations.push(`${path}: config.global.plugins is forbidden`);
    }

    const directPluginOption =
      /global\s*:\s*\{[\s\S]{0,500}?\bplugins\s*:/.test(source);
    if (
      directPluginOption &&
      path !== CONTEXT_HELPER &&
      path !== CONTEXT_HELPER_SPEC
    ) {
      violations.push(`${path}: mount global.plugins must be context-owned`);
    }

    if (!hasVueTestUtilsMount(source)) continue;

    if (!/mountWithApp|createTestAppContext/.test(source)) {
      violations.push(
        `${path}: raw VTU mounts require mountWithApp or createTestAppContext`
      );
    }

    if (
      /^(?:export\s+)?(?:const|let|var)\s+\w+\s*=\s*create(?:I18n|Pinia)\s*\(/m.test(
        source
      )
    ) {
      violations.push(
        `${path}: mounted specs cannot share module-scope i18n or Pinia singletons`
      );
    }
  }

  return violations;
}

describe("test application boundary", () => {
  it("keeps every tracked component mount on an explicit app context", () => {
    expect(findApplicationBoundaryViolations(trackedTestSources())).toEqual([]);
  });

  it("detects the forbidden global plugin bridge and unowned mounts", () => {
    const violations = findApplicationBoundaryViolations([
      {
        path: "tests/component/legacy.spec.ts",
        source:
          'import { mount } from "@vue/test-utils";\n' +
          "const i18n = createI18n({});\n" +
          "config.global.plugins = [i18n];\n" +
          "mount(Component, { global: { plugins: [i18n] } });\n",
      },
    ]);

    expect(violations).toEqual([
      "tests/component/legacy.spec.ts: config.global.plugins is forbidden",
      "tests/component/legacy.spec.ts: mount global.plugins must be context-owned",
      "tests/component/legacy.spec.ts: raw VTU mounts require mountWithApp or createTestAppContext",
      "tests/component/legacy.spec.ts: mounted specs cannot share module-scope i18n or Pinia singletons",
    ]);
  });

  it("allows local i18n construction in non-mounting locale units", () => {
    expect(
      findApplicationBoundaryViolations([
        {
          path: "tests/unit/locales/example.spec.ts",
          source: `
            const i18n = createI18n({});
            it("formats a locale", () => expect(i18n.global.locale.value).toBe("en-US"));
          `,
        },
      ])
    ).toEqual([]);
  });
});
