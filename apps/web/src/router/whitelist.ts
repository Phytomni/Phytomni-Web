/**
 * Routing path classifications.
 *
 * - WHITELIST: paths unauthenticated users may visit (matches existing permission.ts behavior).
 *   NOTE `/home` and `/about` are historical drift — no actual routes match them, kept for parity.
 * - GUEST_ONLY_PATHS: subset that authenticated users should be redirected AWAY from.
 *
 * Both constants are co-located here as the SSOT for permission.ts and utils/auth-redirect.ts.
 */
export const WHITELIST = [
  "/",
  "/login",
  "/register",
  "/forgot-password",
  "/terms",
  "/privacy",
  "/home",
  "/about",
] as const;

export const GUEST_ONLY_PATHS: ReadonlySet<string> = new Set([
  "/login",
  "/register",
  "/forgot-password",
]);

/**
 * Routes a user with `login_status === '0'` (initial password not yet changed)
 * is allowed to visit. All other authenticated routes redirect to /change-password
 * via permission.ts beforeEach guard.
 *
 * Keyed by route NAME (not path) for vue-router normalization (immune to
 * trailing-slash / URL-encoding variants).
 *
 * INVARIANT: this Set must always include 'changePassword' itself, or the
 * guard recurses infinitely.
 */
export const FIRST_LOGIN_ALLOWED_ROUTE_NAMES: ReadonlySet<string> = new Set([
  "changePassword",
]);
