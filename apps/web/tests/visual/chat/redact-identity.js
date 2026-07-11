/**
 * DOM-only identity redaction for authenticated Chat captures.
 * Finds exactly one [data-testid="chat-account-identity"], replaces textContent
 * with "Synthetic user" without reading the old text into a variable/log/return,
 * asserts the replacement, and returns only { count: 1, pass: true }.
 * Idempotent. Never logs identity.
 */
(() => {
  const nodes = document.querySelectorAll(
    '[data-testid="chat-account-identity"]'
  );
  if (nodes.length !== 1) {
    throw new Error(
      `redact-identity: expected exactly one chat-account-identity; found ${nodes.length}`
    );
  }
  nodes[0].textContent = "Synthetic user";
  if (nodes[0].textContent !== "Synthetic user") {
    throw new Error("redact-identity: replacement failed");
  }
  return { count: 1, pass: true };
})();
