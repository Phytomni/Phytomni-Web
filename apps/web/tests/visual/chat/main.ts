/**
 * Standalone Chat visual fixture entry.
 * Served by Vite at /tests/visual/chat/ and never registered by production routes.
 * Mirrors production styles, Pinia, i18n, Element Plus, and a memory-only fixture
 * router without importing src/main.ts, production guards, initTheme, or plugins.
 */
import { createApp, nextTick } from "vue";
import { createPinia } from "pinia";
import { createMemoryHistory, createRouter } from "vue-router";
import ElementPlus from "element-plus";
import i18n, { setLanguage } from "@/locales";
import { useThemeStore } from "@/stores";
import { CANONICAL_AGENT_ROUTES } from "@/constants/agents";
import ChatVisualFixtureApp from "./ChatVisualFixtureApp.vue";
import { resolveChatVisualFixture } from "./fixture-registry";

import "@fontsource/inter/400";
import "@fontsource/inter/600";
import "element-plus/dist/index.css";
import "@/styles/tokens.css";
import "@/styles/markdown.css";
import "@/assets/main.css";

const params = new URLSearchParams(window.location.search);
const resolved = resolveChatVisualFixture(
  params.get("state"),
  params.get("locale"),
  params.get("theme")
);

const EmptyFixtureRoute = { template: "<div />" };
const fixtureRouter = createRouter({
  history: createMemoryHistory(),
  routes: [
    { path: "/", component: EmptyFixtureRoute },
    ...Object.entries(CANONICAL_AGENT_ROUTES).map(([tool, path]) => ({
      path,
      name: `fixture-${tool}`,
      component: EmptyFixtureRoute,
    })),
  ],
});

async function boot() {
  const app = createApp(ChatVisualFixtureApp, {
    fixture: resolved.ok ? resolved.fixture : null,
    errorMessage: resolved.ok ? null : resolved.error,
  });

  const pinia = createPinia();
  app.use(pinia);
  app.use(i18n);
  app.use(fixtureRouter);
  app.use(ElementPlus, { size: "default" });

  await fixtureRouter.push("/");
  await fixtureRouter.isReady();

  if (resolved.ok) {
    // Deterministic theme only — do not call initTheme or start its interval.
    useThemeStore().setTheme(resolved.theme);
    await setLanguage(resolved.locale);
  }

  app.mount("#app");
  await nextTick();
  if (document.fonts) {
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
