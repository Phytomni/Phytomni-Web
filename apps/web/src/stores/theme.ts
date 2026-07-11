// Theme management store.
import { defineStore } from "pinia";
import Cookies from "js-cookie";

export type ThemeType = "light" | "dark" | "system";

export const useThemeStore = defineStore("theme", {
  state: () => ({
    theme: (Cookies.get("theme") as ThemeType) || "system",
    mediaQuery: null as MediaQueryList | null,
    mediaQueryListener: null as ((e: MediaQueryListEvent) => void) | null,
    // internal state tracking the actual system theme
    systemTheme: (window.matchMedia("(prefers-color-scheme: dark)").matches
      ? "dark"
      : "light") as "light" | "dark",
  }),

  getters: {
    // the theme currently applied
    currentTheme: (state): "light" | "dark" => {
      if (state.theme === "system") {
        // use the internal state to ensure reactive updates
        return state.systemTheme;
      }
      return state.theme;
    },

    // get the theme label
    themeLabel: (state): string => {
      switch (state.theme) {
        case "light":
          return "Light";
        case "dark":
          return "Dark";
        case "system":
          return "Follow system";
        default:
          return "Follow system";
      }
    },
  },

  actions: {
    // set the theme
    setTheme(theme: ThemeType) {
      this.theme = theme;
      Cookies.set("theme", theme);

      // when switching to "follow system" mode, re-set the system theme listener
      if (theme === "system") {
        this.setupSystemThemeListener();
      }

      this.applyTheme();
    },

    // apply the theme to the DOM
    applyTheme() {
      const actualTheme = this.currentTheme;
      const root = document.documentElement;

      root.classList.remove("theme-light", "theme-dark");
      root.classList.add(`theme-${actualTheme}`);
      root.dataset.theme = actualTheme;
    },

    // initialize the theme
    initTheme() {
      // set up the system theme change listener
      this.setupSystemThemeListener();

      // sync the system theme state
      this.syncSystemTheme();

      // apply the initial theme
      this.applyTheme();

      // start the periodic sync timer (as a fallback)
      this.startSyncTimer();
    },

    // set up the system theme change listener
    setupSystemThemeListener() {
      // remove the old listener (if any)
      if (this.mediaQuery && this.mediaQueryListener) {
        this.mediaQuery.removeEventListener("change", this.mediaQueryListener);
      }

      // create a new media query object
      this.mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");

      // create the listener function
      this.mediaQueryListener = () => {
        if (this.theme === "system") {
          // update the internal system theme state
          this.systemTheme = this.mediaQuery?.matches ? "dark" : "light";
          // apply the theme
          this.applyTheme();
        }
      };

      // add the listener
      this.mediaQuery.addEventListener("change", this.mediaQueryListener);
    },

    // clean up the listener
    cleanup() {
      if (this.mediaQuery && this.mediaQueryListener) {
        this.mediaQuery.removeEventListener("change", this.mediaQueryListener);
      }
    },

    // sync the system theme state
    syncSystemTheme() {
      if (this.theme === "system") {
        const newSystemTheme = window.matchMedia("(prefers-color-scheme: dark)")
          .matches
          ? "dark"
          : "light";
        if (this.systemTheme !== newSystemTheme) {
          this.systemTheme = newSystemTheme;
          this.applyTheme();
        }
      }
    },

    // start the periodic sync timer
    startSyncTimer() {
      // check the system theme state every 2 seconds
      setInterval(() => {
        this.syncSystemTheme();
      }, 2000);
    },
  },
});
