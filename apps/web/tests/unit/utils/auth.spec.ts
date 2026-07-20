import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  type MockInstance,
} from "vitest";
import Cookies from "js-cookie";
import {
  getToken,
  setToken,
  removeToken,
  getExpiresIn,
  setExpiresIn,
  removeExpiresIn,
} from "@/utils/auth";
import { invalidInput } from "../../helpers/invalidInput";

type CookieGetByName = (name: string) => string | undefined;

function stubCookieGet(
  value: string | undefined
): MockInstance<CookieGetByName> {
  // js-cookie overloads get() and get(name); this test only exercises the
  // named-read contract used by auth.ts.
  const spy = vi.spyOn(
    Cookies,
    "get"
  ) as unknown as MockInstance<CookieGetByName>;
  return spy.mockReturnValue(value);
}

describe("getToken — POISONED_VALUES filter", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it.each(["undefined", "null", ""])(
    "returns undefined when cookie value is poisoned literal %s",
    (poisoned) => {
      stubCookieGet(poisoned);
      expect(getToken()).toBeUndefined();
    }
  );

  it("returns the raw token string when cookie holds a real value", () => {
    stubCookieGet("real-token-abc123");
    expect(getToken()).toBe("real-token-abc123");
  });

  it("returns undefined when cookie is absent (Cookies.get returns undefined)", () => {
    stubCookieGet(undefined);
    expect(getToken()).toBeUndefined();
  });
});

describe("setToken — input guard", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("warns + returns undefined on non-string input", () => {
    const warn = vi.spyOn(console, "warn").mockReturnValue(undefined);
    const setSpy = vi.spyOn(Cookies, "set");
    expect(setToken(invalidInput<string>(null))).toBeUndefined();
    expect(warn).toHaveBeenCalledOnce();
    expect(setSpy).not.toHaveBeenCalled();
  });

  it.each(["undefined", "null", ""])(
    "warns + returns undefined on poisoned literal %s",
    (poisoned) => {
      const warn = vi.spyOn(console, "warn").mockReturnValue(undefined);
      const setSpy = vi.spyOn(Cookies, "set");
      expect(setToken(poisoned)).toBeUndefined();
      expect(warn).toHaveBeenCalledOnce();
      expect(setSpy).not.toHaveBeenCalled();
    }
  );

  it("calls Cookies.set with Admin-Token for a valid non-poisoned string", () => {
    const setSpy = vi.spyOn(Cookies, "set").mockReturnValue("ok");
    const result = setToken("real-token");
    expect(setSpy).toHaveBeenCalledWith("Admin-Token", "real-token");
    expect(result).toBe("ok");
  });
});

describe("removeToken / getExpiresIn / setExpiresIn / removeExpiresIn — thin Cookies wrappers", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("removeToken delegates to Cookies.remove(Admin-Token)", () => {
    const removeSpy = vi.spyOn(Cookies, "remove").mockReturnValue(undefined);
    removeToken();
    expect(removeSpy).toHaveBeenCalledWith("Admin-Token");
  });

  it("getExpiresIn returns cookie value when present", () => {
    stubCookieGet("3600");
    expect(getExpiresIn()).toBe("3600");
  });

  it("getExpiresIn returns -1 sentinel when cookie absent", () => {
    stubCookieGet(undefined);
    expect(getExpiresIn()).toBe(-1);
  });

  it("setExpiresIn writes Admin-Expires-In with the given duration", () => {
    const setSpy = vi.spyOn(Cookies, "set").mockReturnValue("ok");
    setExpiresIn(7200);
    expect(setSpy).toHaveBeenCalledWith("Admin-Expires-In", 7200);
  });

  it("removeExpiresIn delegates to Cookies.remove(Admin-Expires-In)", () => {
    const removeSpy = vi.spyOn(Cookies, "remove").mockReturnValue(undefined);
    removeExpiresIn();
    expect(removeSpy).toHaveBeenCalledWith("Admin-Expires-In");
  });
});
