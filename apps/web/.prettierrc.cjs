// Preserve the established Prettier 2 trailing-comma baseline on Prettier 3.
// The explicit scope and exclusions live in package.json/.prettierignore.
/** @type {import("prettier").Config} */
module.exports = {
  trailingComma: "es5",
};
