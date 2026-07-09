// Application entry point.
import { createApp } from "vue";
import { createPinia } from "pinia";
import { createActionObserverPlugin } from "@/stores/actionObserver";
import ElementPlus from "element-plus";
import enElementLocale from "element-plus/es/locale/lang/en";
import zhElementLocale from "element-plus/es/locale/lang/zh-cn";
import i18n, { setLanguage } from "./locales"; // import i18n config
import { useAppStore, useThemeStore } from "@/stores";

import App from "./App.vue";
import router from "./router";
import directive from "./directive";
// register directives
import plugins from "./plugins"; // plugins
import { download } from "@/utils/request";
import "element-plus/dist/index.css";
import "./assets/main.css"; // global styles
import "./assets/theme.css"; // theme styles
import "./permission"; // permission control

const app = createApp(App);

// init
const pinia = createPinia();
pinia.use(createActionObserverPlugin());
app.use(pinia);

// init stores
const appStore = useAppStore();
const themeStore = useThemeStore();

// Ensure the locale bundle is loaded before using i18n
const currentLang =
  appStore.language || localStorage.getItem("language") || "en-US";

// init i18n
app.use(i18n);

// init theme
themeStore.initTheme();

// Debug logging
console.log("Theme initialized:", {
  theme: themeStore.theme,
  currentTheme: themeStore.currentTheme,
  systemTheme: (themeStore as any).systemTheme,
});

// mount global methods
app.config.globalProperties.download = download;

app.use(router);
app.use(plugins);
app.use(directive);

// use Element Plus with a global component size
app.use(ElementPlus, {
  locale: currentLang === "zh-CN" ? zhElementLocale : enElementLocale,
  // supports large, default, small
  size: "default",
});

// Load the active locale pack before first paint, then mount.
setLanguage(currentLang).then(() => app.mount("#app"));

// Clean up the theme listener on page unload
window.addEventListener("beforeunload", () => {
  themeStore.cleanup();
});
