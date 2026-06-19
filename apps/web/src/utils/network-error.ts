/**
 * Predicate: is this an axios/network-level error worth retrying-via-verify?
 *
 * Matches the same 4 conditions the production fork checks inline in
 * sendMessage's catch block. The "verify" path then re-queries chat history
 * before showing a send-failure toast, because network errors during /query
 * can leave the server-side message landed-but-not-acknowledged on the wire.
 *
 * Detection rule (matches ANY — byte-parity with frontend inline):
 *   (a) error.message === "Network Error"             (axios v0 / fetch)
 *   (b) error.message includes "timeout" (substring)  (axios timeout substring)
 *   (c) error.code === "ECONNABORTED"                  (axios timeout code)
 *   (d) !error.response && error.message length > 0    (catchall: no HTTP
 *                                                        response but threw)
 *
 * Returns false on:
 *   - null / undefined (defensive)
 *   - non-object inputs (string / number / boolean — defensive)
 *   - errors with .response (server-level errors — server replied with
 *     a non-2xx, not a network failure)
 *
 * Helper never throws.
 */
export function isNetworkError(error: unknown): boolean {
  if (error == null || typeof error !== "object") return false;
  const e = error as {
    message?: string;
    code?: string;
    response?: unknown;
  };
  if (e.message === "Network Error") return true;
  if (typeof e.message === "string" && e.message.includes("timeout")) return true;
  if (e.code === "ECONNABORTED") return true;
  if (!e.response && typeof e.message === "string" && e.message.length > 0) return true;
  return false;
}
