import { beforeEach, describe, expect, it, vi } from "vitest";
import Cookies from "js-cookie";
import { createPinia, setActivePinia } from "pinia";
import { useThemeStore } from "@/stores/theme";

type MediaQueryHarness = {
  matches: boolean;
  addEventListener: ReturnType<typeof vi.fn>;
  removeEventListener: ReturnType<typeof vi.fn>;
};

let mediaQuery: MediaQueryHarness;

beforeEach(() => {
  mediaQuery = {
    matches: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  };
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: vi.fn(() => mediaQuery),
  });
  document.documentElement.className = "";
  document.documentElement.removeAttribute("data-theme");
  setActivePinia(createPinia());
});

describe("useThemeStore CSS-owned theme application", () => {
  it("applies only the resolved class and data-theme attribute", () => {
    const store = useThemeStore();
    const setProperty = vi.spyOn(document.documentElement.style, "setProperty");

    store.theme = "dark";
    store.applyTheme();

    expect(document.documentElement.classList.contains("theme-dark")).toBe(
      true
    );
    expect(document.documentElement.classList.contains("theme-light")).toBe(
      false
    );
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(setProperty).not.toHaveBeenCalled();
  });

  it("keeps cookie persistence and explicit theme selection", () => {
    const store = useThemeStore();
    const setCookie = vi.spyOn(Cookies, "set");

    store.setTheme("light");

    expect(store.theme).toBe("light");
    expect(store.currentTheme).toBe("light");
    expect(setCookie).toHaveBeenCalledWith("theme", "light");
    expect(document.documentElement.dataset.theme).toBe("light");
  });

  it("keeps system media listener updates and cleanup", () => {
    const store = useThemeStore();
    store.setupSystemThemeListener();

    expect(mediaQuery.addEventListener).toHaveBeenCalledWith(
      "change",
      expect.any(Function)
    );

    mediaQuery.matches = true;
    const listener = mediaQuery.addEventListener.mock.calls[0][1] as () => void;
    listener();

    expect(store.currentTheme).toBe("dark");
    expect(document.documentElement.dataset.theme).toBe("dark");

    store.cleanup();
    expect(mediaQuery.removeEventListener).toHaveBeenCalledWith(
      "change",
      listener
    );
  });
});
