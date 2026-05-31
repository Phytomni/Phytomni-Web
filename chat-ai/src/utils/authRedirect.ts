import type { LocationQuery, LocationQueryValue } from 'vue-router';
import { getToken } from '@/utils/auth';
import { GUEST_ONLY_PATHS } from '@/router/whitelist';

/**
 * Sanitize a query.redirect target so it never loops back to a guest route.
 * Handles array (takes first), null / undefined / non-string / empty (-> fallback), guest-path (-> fallback).
 */
export function safeRedirect(
  target: LocationQueryValue | LocationQueryValue[] | undefined,
  fallback: string,
): string {
  const first = Array.isArray(target) ? target[0] : target;
  if (typeof first !== 'string' || first.length === 0) return fallback;
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
