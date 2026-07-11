/**
 * Path-only auth assertion for authenticated Chat captures.
 * Reads only location.pathname; throws unless it is exactly "/chat".
 * Returns only { path_ok: true }. Never reads/prints full URL, query, hash, or IDs.
 */
(() => {
  const path = location.pathname;
  if (path !== "/chat") {
    throw new Error(`assert-chat-path: expected pathname /chat; got ${path}`);
  }
  return { path_ok: true };
})();
