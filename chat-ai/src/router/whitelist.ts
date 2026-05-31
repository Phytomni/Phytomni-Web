/**
 * Routing path classifications.
 *
 * - WHITELIST: paths unauthenticated users may visit (matches existing permission.ts behavior).
 *   NOTE `/home` and `/about` are historical drift — no actual routes match them, kept for parity.
 * - GUEST_ONLY_PATHS: subset that authenticated users should be redirected AWAY from.
 *
 * Both constants are co-located here as the SSOT for permission.ts and utils/authRedirect.ts.
 */
export const WHITELIST = [
  '/', '/login', '/register', '/forgot-password', '/home', '/about',
] as const;

export const GUEST_ONLY_PATHS: ReadonlySet<string> = new Set([
  '/login', '/register', '/forgot-password',
]);
