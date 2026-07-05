import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import enUS from "@/locales/langs/en-US";
import zhCN from "@/locales/langs/zh-CN";

// Recursively collect the leaf key paths (dot-joined) of a message tree.
// Only string leaves count as keys — intermediate objects are namespaces.
const leafKeys = (node: unknown, prefix = ""): string[] => {
  if (node && typeof node === "object") {
    return Object.entries(node as Record<string, unknown>).flatMap(([k, v]) =>
      leafKeys(v, prefix ? `${prefix}.${k}` : k),
    );
  }
  return [prefix];
};

// Does a dot path resolve to a string leaf in the tree?
const hasKey = (node: unknown, path: string): boolean => {
  const parts = path.split(".");
  let cur: unknown = node;
  for (const p of parts) {
    if (cur && typeof cur === "object" && p in (cur as Record<string, unknown>)) {
      cur = (cur as Record<string, unknown>)[p];
    } else {
      return false;
    }
  }
  return typeof cur === "string";
};

// Zero-dependency recursive walk (no fast-glob / node:fs globSync — the
// former is only a transitive dep, the latter is unstable under vitest).
const walkSrc = (dir: string): string[] => {
  const out: string[] = [];
  for (const ent of readdirSync(dir, { withFileTypes: true })) {
    const full = `${dir}/${ent.name}`;
    if (ent.isDirectory()) {
      out.push(...walkSrc(full));
    } else if (/\.(ts|vue)$/.test(ent.name) && !/\.(spec|test)\.ts$/.test(ent.name)) {
      out.push(full);
    }
  }
  return out;
};

describe("i18n key parity", () => {
  it("zh-CN and en-US have identical key sets", () => {
    const zh = new Set(leafKeys(zhCN));
    const en = new Set(leafKeys(enUS));
    const onlyZh = [...zh].filter((k) => !en.has(k)).sort();
    const onlyEn = [...en].filter((k) => !zh.has(k)).sort();
    expect(onlyZh, "keys only in zh-CN").toEqual([]);
    expect(onlyEn, "keys only in en-US").toEqual([]);
  });

  it("detects drift (negative control)", () => {
    const mockZh = { a: { b: "x" } };
    const mockEn = { a: { b: "y" }, c: "z" };
    const onlyEn = leafKeys(mockEn).filter((k) => !new Set(leafKeys(mockZh)).has(k));
    expect(onlyEn).toEqual(["c"]);
  });
});

describe("i18n reference resolvability", () => {
  // Statically scan source for t("literal") / $t("literal") /
  // i18n.global.t("literal") and assert each resolves in BOTH bundles.
  // Dynamic keys (t(variable)) are skipped by design — the regex requires a
  // string-literal argument starting with a letter.
  const srcRoot = resolve(__dirname, "../../../src");
  const files = walkSrc(srcRoot);
  const re = /(?:\$t|[^\w.]t|global\.t)\(\s*["']([a-zA-Z][\w.]*)["']/g;
  const refs = new Map<string, string>();
  for (const f of files) {
    const s = readFileSync(f, "utf8");
    let m: RegExpExecArray | null;
    while ((m = re.exec(s))) {
      if (!refs.has(m[1])) refs.set(m[1], f);
    }
  }
  for (const [key, file] of refs) {
    it(`"${key}" resolves in both bundles`, () => {
      expect(hasKey(zhCN, key), `${key} missing in zh-CN (used in ${file})`).toBe(true);
      expect(hasKey(enUS, key), `${key} missing in en-US (used in ${file})`).toBe(true);
    });
  }
});
