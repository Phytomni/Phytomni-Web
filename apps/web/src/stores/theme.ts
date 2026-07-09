// Theme management store.
import { defineStore } from "pinia";
import Cookies from "js-cookie";
import { PHY_TOKENS } from "@/styles/tokens";

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

      // remove the previous theme class
      root.classList.remove("theme-light", "theme-dark");

      // add the current theme class
      root.classList.add(`theme-${actualTheme}`);

      // set CSS variables
      this.setCSSVariables(actualTheme);
    },

    // set CSS variables
    setCSSVariables(theme: "light" | "dark") {
      const root = document.documentElement;

      if (theme === "dark") {
        // dark theme variables
        root.style.setProperty("--color-background", "#1a1a1a");
        root.style.setProperty("--color-background-soft", "#1a1a1a");
        root.style.setProperty("--color-background-mute", "#1a1a1a");
        root.style.setProperty("--color-border", "rgba(84, 84, 84, 0.48)");
        root.style.setProperty(
          "--color-border-hover",
          "rgba(84, 84, 84, 0.65)"
        );
        root.style.setProperty("--color-heading", "#ffffff");
        root.style.setProperty("--color-text", "rgba(235, 235, 235, 0.64)");
        root.style.setProperty(
          "--phy-color-text",
          "rgba(235, 235, 235, 0.64)"
        );
        root.style.setProperty("--el-bg-color", "#1a1a1a");
        root.style.setProperty("--el-bg-color-page", "#1a1a1a");
        root.style.setProperty("--el-text-color-primary", "#ffffff");
        root.style.setProperty(
          "--el-text-color-regular",
          "rgba(235, 235, 235, 0.64)"
        );
        root.style.setProperty("--el-border-color", "rgba(84, 84, 84, 0.48)");
        root.style.setProperty(
          "--el-border-color-light",
          "rgba(84, 84, 84, 0.32)"
        );
        root.style.setProperty("--el-fill-color-light", "#2a2a2a");
        root.style.setProperty("--el-fill-color", "#2a2a2a");
        root.style.setProperty("--el-fill-color-lighter", "#333333");

        // dark theme button variables
        root.style.setProperty("--sidebar-btn-bg", "#2a2a2a");
        root.style.setProperty("--sidebar-btn-bg-hover", "#3a3a3a");
        root.style.setProperty("--sidebar-btn-color", "#ffffff");
        root.style.setProperty(
          "--sidebar-btn-border",
          "rgba(84, 84, 84, 0.48)"
        );
        root.style.setProperty("--sidebar-btn-active-bg", PHY_TOKENS.primary);
        root.style.setProperty("--sidebar-btn-active-color", "#ffffff");
        root.style.setProperty(
          "--sidebar-btn-shadow",
          "0 2px 8px rgba(0, 0, 0, 0.3)"
        );
        root.style.setProperty(
          "--sidebar-btn-shadow-hover",
          "0 4px 12px rgba(0, 0, 0, 0.4)"
        );

        // dark theme page variables
        root.style.setProperty("--page-card-bg", "#2a2a2a");
        root.style.setProperty("--page-card-border", "rgba(84, 84, 84, 0.48)");
        root.style.setProperty(
          "--page-card-shadow",
          "0 2px 8px rgba(0, 0, 0, 0.3)"
        );
        root.style.setProperty(
          "--page-text-secondary",
          "rgba(235, 235, 235, 0.6)"
        );
      } else {
        // light theme variables
        root.style.setProperty("--color-background", "#ffffff");
        root.style.setProperty("--color-background-soft", PHY_TOKENS.bgPage);
        root.style.setProperty("--color-background-mute", "#f2f2f2");
        root.style.setProperty("--color-border", "rgba(60, 60, 60, 0.12)");
        root.style.setProperty(
          "--color-border-hover",
          "rgba(60, 60, 60, 0.29)"
        );
        root.style.setProperty("--color-heading", PHY_TOKENS.text);
        root.style.setProperty("--color-text", PHY_TOKENS.text);
        root.style.setProperty("--phy-color-text", PHY_TOKENS.text);
        root.style.setProperty("--el-bg-color", "#ffffff");
        root.style.setProperty("--el-bg-color-page", "#ffffff");
        root.style.setProperty("--el-text-color-primary", "#2c3e50");
        root.style.setProperty("--el-text-color-regular", "#2c3e50");
        root.style.setProperty("--el-border-color", "rgba(60, 60, 60, 0.12)");
        root.style.setProperty(
          "--el-border-color-light",
          "rgba(60, 60, 60, 0.08)"
        );
        root.style.setProperty("--el-fill-color-light", "#f5f7fa");
        root.style.setProperty("--el-fill-color", "#f0f2f5");
        root.style.setProperty("--el-fill-color-lighter", "#fafafa");

        // light theme button variables
        root.style.setProperty("--sidebar-btn-bg", "#f0f5ff");
        root.style.setProperty("--sidebar-btn-bg-hover", "#e5effe");
        root.style.setProperty("--sidebar-btn-color", PHY_TOKENS.primary);
        root.style.setProperty(
          "--sidebar-btn-border",
          "rgba(60, 60, 60, 0.12)"
        );
        root.style.setProperty("--sidebar-btn-active-bg", PHY_TOKENS.primary);
        root.style.setProperty("--sidebar-btn-active-color", "#ffffff");
        root.style.setProperty(
          "--sidebar-btn-shadow",
          "0 2px 8px rgba(0, 0, 0, 0.1)"
        );
        root.style.setProperty(
          "--sidebar-btn-shadow-hover",
          "0 4px 12px rgba(0, 0, 0, 0.15)"
        );

        // light theme page variables
        root.style.setProperty("--page-card-bg", "#ffffff");
        root.style.setProperty("--page-card-border", "rgba(60, 60, 60, 0.12)");
        root.style.setProperty(
          "--page-card-shadow",
          "0 2px 8px rgba(0, 0, 0, 0.1)"
        );
        root.style.setProperty("--page-text-secondary", "#666666");
      }
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
