/**
 * Standalone Chat visual fixture entry.
 * Served by Vite at /tests/visual/chat/ — never registered by production routes.
 * Mirrors production boot style/font/Pinia/i18n/Element Plus prerequisites without
 * importing src/main.ts (no router, permission, initTheme interval, or plugins).
 */
import { createApp, nextTick } from "vue";
import { createPinia } from "pinia";
import ElementPlus from "element-plus";
import i18n, { setLanguage } from "@/locales";
import { useThemeStore } from "@/stores";
import ChatVisualFixtureApp from "./ChatVisualFixtureApp.vue";
import { resolveChatVisualFixture } from "./fixture-registry";

import "@fontsource/inter/400";
import "@fontsource/inter/600";
import "element-plus/dist/index.css";
import "@/styles/tokens.css";
import "@/styles/markdown.css";
import "@/assets/main.css";
import "@/assets/theme.css";

const params = new URLSearchParams(window.location.search);
const resolved = resolveChatVisualFixture(
  params.get("state"),
  params.get("locale"),
  params.get("theme")
);

async function boot() {
  const app = createApp(ChatVisualFixtureApp, {
    fixture: resolved.ok ? resolved.fixture : null,
    errorMessage: resolved.ok ? null : resolved.error,
  });

  const pinia = createPinia();
  app.use(pinia);
  app.use(i18n);
  app.use(ElementPlus, { size: "default" });

  if (resolved.ok) {
    // Deterministic theme only — do not call initTheme or start its interval.
    useThemeStore().setTheme(resolved.theme);
    await setLanguage(resolved.locale);
  }

  app.mount("#app");
  await nextTick();
  if (document.fonts?.ready) {
    await document.fonts.ready;
  }

  if (resolved.ok) {
    const root = document.querySelector(
      '[data-testid="chat-visual-root"]'
    ) as HTMLElement | null;
    if (root) {
      root.setAttribute("data-fixture-ready", "true");
    }
  }
}

void boot();
