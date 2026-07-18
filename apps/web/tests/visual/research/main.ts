/** Standalone Deep Genome Artifact visual fixture; never registered by production routes. */
import { createApp, nextTick } from "vue";
import { createPinia } from "pinia";
import ElementPlus from "element-plus";
import i18n, { setLanguage } from "@/locales";
import { useThemeStore } from "@/stores";
import DeepGenomeArtifactVisualFixtureApp from "./DeepGenomeArtifactVisualFixtureApp.vue";

import "@fontsource/inter/400";
import "@fontsource/inter/600";
import "element-plus/dist/index.css";
import "@/styles/tokens.css";
import "@/styles/markdown.css";
import "@/assets/main.css";

const params = new URLSearchParams(window.location.search);
const locale = params.get("locale") === "zh-CN" ? "zh-CN" : "en-US";
const theme = params.get("theme") === "dark" ? "dark" : "light";

async function boot() {
  const app = createApp(DeepGenomeArtifactVisualFixtureApp);
  const pinia = createPinia();

  app.use(pinia);
  app.use(i18n);
  app.use(ElementPlus, { size: "default" });

  useThemeStore().setTheme(theme);
  await setLanguage(locale);

  app.mount("#app");
  await nextTick();
  if (document.fonts?.ready) {
    await document.fonts.ready;
  }

  document
    .querySelector<HTMLElement>("[data-testid=deep-genome-visual-root]")
    ?.setAttribute("data-fixture-ready", "true");
}

void boot();
