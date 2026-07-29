/** Standalone, test-only UI remediation fixture entry. */
import { createApp, nextTick } from "vue";
import { createPinia } from "pinia";
import { createMemoryHistory, createRouter } from "vue-router";
import ElementPlus from "element-plus";
import i18n, { setLanguage } from "@/locales";
import { userStore } from "@/stores";
import UiRemediationVisualFixtureApp from "./UiRemediationVisualFixtureApp.vue";
import { resolveUiRemediationFixture } from "./fixture-registry";

import "@fontsource/inter/400";
import "@fontsource/inter/600";
import "element-plus/dist/index.css";
import "@/styles/tokens.css";
import "@/styles/markdown.css";
import "@/assets/main.css";

const params = new URLSearchParams(window.location.search);
const resolved = resolveUiRemediationFixture(
  params.get("state"),
  params.get("locale")
);
const fixtureRouter = createRouter({
  history: createMemoryHistory(),
  routes: [{ path: "/", component: { template: "<div />" } }],
});

async function boot() {
  const pinia = createPinia();
  const app = createApp(UiRemediationVisualFixtureApp, {
    fixture: resolved.ok
      ? { state: resolved.state, locale: resolved.locale }
      : null,
    errorMessage: resolved.ok ? null : resolved.error,
  });
  app.use(pinia);
  app.use(i18n);
  app.use(fixtureRouter);
  app.use(ElementPlus, { size: "default" });
  userStore(pinia).$patch({
    name: "researcher@example.test",
    login_status: "1",
  });
  await fixtureRouter.push("/");
  await fixtureRouter.isReady();
  if (resolved.ok) await setLanguage(resolved.locale);
  app.mount("#app");
  await nextTick();
  if (document.fonts) await document.fonts.ready;
  window.dispatchEvent(new Event("ui-remediation-fixture-ready"));
}

void boot();
