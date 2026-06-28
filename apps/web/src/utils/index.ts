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

/**
 * Serialize params into a query string.
 * @param {*} params  the params object
 */
export function tansParams(params: { [x: string]: any }) {
  let result = "";
  for (const propName of Object.keys(params)) {
    const value = params[propName];
    const part = encodeURIComponent(propName) + "=";
    if (value !== null && value !== "" && typeof value !== "undefined") {
      if (typeof value === "object") {
        for (const key of Object.keys(value)) {
          if (
            value[key] !== null &&
            value !== "" &&
            typeof value[key] !== "undefined"
          ) {
            const params = propName + "[" + key + "]";
            const subPart = encodeURIComponent(params) + "=";
            result += subPart + encodeURIComponent(value[key]) + "&";
          }
        }
      } else {
        result += part + encodeURIComponent(value) + "&";
      }
    }
  }
  return result;
}

// Validate whether the data is a blob
export async function blobValidate(data: { text: () => any }) {
  try {
    const text = await data.text();
    JSON.parse(text);
    return false;
  } catch (error) {
    return true;
  }
}
