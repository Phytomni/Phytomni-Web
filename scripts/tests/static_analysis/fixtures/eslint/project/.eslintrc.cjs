const webRoot = process.env.PHYTOMNI_WEB_ROOT;

module.exports = {
  root: true,
  parser: require.resolve("vue-eslint-parser", { paths: [webRoot] }),
  parserOptions: {
    parser: require.resolve("@typescript-eslint/parser", { paths: [webRoot] }),
    ecmaVersion: "latest",
    sourceType: "module",
  },
  extends: ["plugin:vue/vue3-essential"],
  rules: {
    "no-unused-vars": "error",
    "no-console": "warn",
  },
};
