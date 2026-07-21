import Cookies from "js-cookie";

const TokenKey = "Admin-Token";

const ExpiresInKey = "Admin-Expires-In";

const POISONED_VALUES = new Set(["undefined", "null", ""]);

export function getToken(): string | undefined {
  const raw = Cookies.get(TokenKey);
  if (typeof raw !== "string" || POISONED_VALUES.has(raw)) return undefined;
  return raw;
}

export function setToken(token: string): string | undefined {
  if (typeof token !== "string" || POISONED_VALUES.has(token)) {
    console.warn("[auth] setToken refused poisoned value:", typeof token);
    return undefined;
  }
  return Cookies.set(TokenKey, token);
}

export function removeToken() {
  return Cookies.remove(TokenKey);
}

export function getExpiresIn() {
  return Cookies.get(ExpiresInKey) || -1;
}

export function setExpiresIn(time: number) {
  return Cookies.set(ExpiresInKey, String(time));
}

export function removeExpiresIn() {
  return Cookies.remove(ExpiresInKey);
}
