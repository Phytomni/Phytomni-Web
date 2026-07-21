import Cookies from "js-cookie";
const TokenKey = "Admin-Token";

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

// Object.entries exposes its values as `any[]`; preserve the runtime behavior
// for records and arrays while keeping nested query values explicitly unknown.
function entriesOf(value: object): Array<[string, unknown]> {
  return Object.keys(value).map((key): [string, unknown] => [
    key,
    (value as Record<string, unknown>)[key],
  ]);
}

/** Serialize an unknown params value into the query-string format used by the API. */
export function tansParams(params: unknown): string {
  let result = "";
  if (!params || typeof params !== "object") return result;

  const append = (key: string, value: unknown): void => {
    if (value === null || value === "" || typeof value === "undefined") {
      return;
    }
    result += `${encodeURIComponent(key)}=${encodeURIComponent(
      String(value)
    )}&`;
  };

  for (const [propName, value] of entriesOf(params)) {
    if (value && typeof value === "object") {
      for (const [key, nestedValue] of entriesOf(value)) {
        append(`${propName}[${key}]`, nestedValue);
      }
    } else {
      append(propName, value);
    }
  }
  return result;
}

// Validate whether the data is a blob
export async function blobValidate(data: Blob): Promise<boolean> {
  try {
    const text = await data.text();
    JSON.parse(text);
    return false;
  } catch (error) {
    return true;
  }
}
