import { createRequire } from "node:module";

const require = createRequire(
  `${process.env.PHYTOMNI_WEB_ROOT}/package.json`
);
const pluginVue = require("eslint-plugin-vue");
const tseslint = require("typescript-eslint");

export default [
  {
    files: ["**/*.ts"],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {
        ecmaVersion: "latest",
        sourceType: "module",
      },
    },
    rules: {
      "no-unused-vars": "error",
      "no-console": "warn",
    },
  },
  ...pluginVue.configs["flat/essential"],
  {
    files: ["**/*.vue"],
    rules: {
      "no-unused-vars": "error",
      "no-console": "warn",
    },
  },
];
