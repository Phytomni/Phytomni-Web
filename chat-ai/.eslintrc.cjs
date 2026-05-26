/*
 * 组件注释
 * @Author: wuq-l
 * @Date: 2022-08-18 21:07:25
 * @LastEditors: wuq-l
 * @LastEditTime: 2022-08-18 21:39:28
 * @Description:
 * 人生无常！大肠包小肠......
 */
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
  // public/ holds large vendor bundles (e.g. 3Dmol-min.js, 612 KB minified)
  // that crash eslint into catastrophic backtracking; dist/ is build output
  // that ships from the build pipeline, not source. .gitignore covers dist/
  // for git, but eslint's --ignore-path is only honored for paths that match
  // a single .gitignore line and public/ is intentionally git-tracked, so
  // these patterns must live in the lint config itself.
  ignorePatterns: ["public/", "dist/"],
  parserOptions: {
    ecmaVersion: "latest",
  },
  rules: {
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
  ],
};
