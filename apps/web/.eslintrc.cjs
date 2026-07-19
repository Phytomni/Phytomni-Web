/* eslint-env node */
require("@rushstack/eslint-patch/modern-module-resolution");

module.exports = {
  root: true,
  extends: [
    "plugin:vue/vue3-essential",
    "eslint:recommended",
    "@vue/eslint-config-typescript/recommended",
    "@vue/eslint-config-prettier",
  ],
  // The tracked minified 3Dmol vendor bundle can trigger catastrophic parser
  // backtracking; keep the rest of public/ lintable. dist/ is generated output
  // from the build pipeline, not first-party source.
  ignorePatterns: ["dist/", "public/static/js/3Dmol-min.js"],
  parserOptions: {
    ecmaVersion: "latest",
  },
  rules: {
    // Formatting is enforced by the standalone G2.1 Prettier check. Keep
    // eslint-config-prettier's conflict disabling without duplicating its
    // formatter diagnostics in the semantic lint inventory.
    "prettier/prettier": "off",
    // The Vue ecosystem (incl. Vue docs and `npm create vue@latest`)
    // routinely uses single-word names for layout/root components
    // (App, Layout, Sidebar, etc.). This codebase follows that
    // convention everywhere — enforcing multi-word names would force
    // 33 cosmetic renames across views/components without changing
    // runtime behavior. Disable globally to align the rule set with
    // project convention rather than fight it.
    "vue/multi-word-component-names": "off",
  },
  overrides: [
    {
      // vite/plugins/*.js are build-time plugin factories that run in
      // Node context (process.cwd, path, etc.). Without an env flag,
      // ESLint flags `process` as no-undef. Limiting the override to
      // this directory keeps the browser-side default env intact.
      files: ["vite/plugins/*.js"],
      env: {
        node: true,
      },
    },
    {
      // Auth paths must never log request/response/error objects — they carry
      // the bearer token (Authorization / satoken headers; res.data.token).
      // Scoped here because the rest of the app uses console legitimately.
      files: ["src/views/login/**", "src/permission.ts"],
      rules: {
        "no-console": "error",
      },
    },
  ],
};
