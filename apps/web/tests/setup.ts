import { afterEach, vi } from "vitest";
import { createI18n } from "vue-i18n";
import { config } from "@vue/test-utils";
import ElementPlus from "element-plus";

// Global i18n stub — needed when mounting components like LangSwitch
const i18n = createI18n({
  legacy: false,
  locale: "zh-CN",
  fallbackLocale: "en-US",
  messages: {
    "zh-CN": {},
    "en-US": {},
  },
});

// Note: we do NOT register the pinia global plugin here — each test sets up its
// own active pinia by calling setActivePinia(createPinia()) in beforeEach, so when
// a component mounts useStore() falls back through the getActivePinia() path. Two
// pinia instances would make the test and the component read different stores
// (proven during L0 debugging).
config.global.plugins = [i18n, ElementPlus];

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
  document.cookie.split(";").forEach((c) => {
    document.cookie = c.replace(/^ +/, "").replace(/=.*/, "=;expires=" + new Date().toUTCString() + ";path=/");
  });
});
