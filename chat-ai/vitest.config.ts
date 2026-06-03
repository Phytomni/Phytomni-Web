/// <reference types="vitest" />
import { defineConfig } from "vitest/config";
import vue from "@vitejs/plugin-vue";
import vueJsx from "@vitejs/plugin-vue-jsx";
import { fileURLToPath } from "node:url";

// Standalone vitest config — does NOT mergeConfig() vite.config.ts because
// the project's vite.config exports a callback (defineConfig(({mode, command})
// => ...)), which mergeConfig() refuses. We replay the bits tests actually
// need: the vue + vue-jsx plugins (for .vue SFC parsing) and the @/ alias.
// Build-only plugins (auto-import, svg-icon, compression) are intentionally
// omitted — tests should not depend on them.
export default defineConfig({
  plugins: [vue(), vueJsx()],
  test: {
    globals: true,
    environment: "happy-dom",
    setupFiles: ["./tests/setup.ts"],
    include: [
      "tests/unit/**/*.{test,spec}.ts",
      "tests/component/**/*.{test,spec}.ts",
    ],
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html"],
      // Coverage gate enforces the 80%/75% threshold on FULLY-tested files only.
      // `src/api/chat.ts` is intentionally OUT of include (its spec exists and
      // runs, but only `getReactionType` is tested — the file has ~35 thin
      // axios wrappers and gating against the full surface would force ~30
      // identical assertion templates). When reaction-related tests grow
      // (TW-D10 / TW-D8 territory), include can expand to cover chat.ts.
      include: [
        "src/utils/authRedirect.ts",
        "src/utils/auth.ts",
        "src/utils/pendingChat.ts",
        "src/utils/networkError.ts",
        "src/components/LangSwitch.vue",
      ],
      thresholds: {
        lines: 80,
        functions: 80,
        statements: 80,
        branches: 75,
      },
      thresholdAutoUpdate: false,
    },
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
});
