import type { LocationQuery, LocationQueryValue } from 'vue-router';
import { getToken } from '@/utils/auth';
import { GUEST_ONLY_PATHS } from '@/router/whitelist';

/**
 * Sanitize a query.redirect target so it never loops back to a guest route or escapes the app's origin.
 * Rejects (-> fallback): array beyond first / null / undefined / non-string / empty / non-relative path /
 * protocol-relative (// or /\) / CRLF or tab chars / scheme-like (javascript:, data:, http:, etc.) / guest-only paths.
 */
export function safeRedirect(
  target: LocationQueryValue | LocationQueryValue[] | undefined,
  fallback: string,
): string {
  const first = Array.isArray(target) ? target[0] : target;
  if (typeof first !== 'string' || first.length === 0) return fallback;
  // Open-redirect hardening: require same-origin relative path.
  if (!first.startsWith('/')) return fallback;
  if (first.startsWith('//') || first.startsWith('/\\')) return fallback;
  if (/[\r\n\t]/.test(first)) return fallback;
  if (/^[a-z][a-z0-9+.-]*:/i.test(first)) return fallback;
  const pathOnly = first.split('?')[0];
  return GUEST_ONLY_PATHS.has(pathOnly) ? fallback : first;
}

/**
 * onMounted reverse guard: if the user is authenticated, send them away from this guest view.
 * Returns true if redirected (caller can early-return), false otherwise.
 */
export function redirectIfAuthed(
  route: { query: LocationQuery },
  router: { replace: (to: string) => unknown },
  fallback = '/chat',
): boolean {
  if (!getToken()) return false;
  router.replace(safeRedirect(route.query.redirect, fallback));
  return true;
}
