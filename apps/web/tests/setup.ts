import { afterEach, vi } from "vitest";
import { createI18n } from "vue-i18n";
import { config } from "@vue/test-utils";
import ElementPlus from "element-plus";
import { Storage } from "happy-dom";

// Node 26 exposes file-backed Web Storage accessors on globalThis. Without a
// configured storage file they resolve to undefined and shadow happy-dom's
// window storage objects, so bridge the browser-owned instances explicitly.
function installTestStorage() {
  Object.defineProperties(globalThis, {
    localStorage: {
      configurable: true,
      value: new Storage(),
    },
    sessionStorage: {
      configurable: true,
      value: new Storage(),
    },
  });
}

installTestStorage();

// happy-dom 20 no longer exposes the browser print entry point. Define the
// minimal test-only surface so print callers can continue to spy on it.
if (typeof window.print !== "function") {
  Object.defineProperty(window, "print", {
    configurable: true,
    value: () => undefined,
  });
}

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
  // Vitest 4 + happy-dom 20 can retain an instance-level Storage spy even
  // after restoreAllMocks(). Replace the browser-owned instances so a test
  // that intentionally makes a storage method throw cannot poison cleanup or
  // the next test.
  installTestStorage();
  document.cookie.split(";").forEach((c) => {
    document.cookie = c
      .replace(/^ +/, "")
      .replace(/=.*/, "=;expires=" + new Date().toUTCString() + ";path=/");
  });
});
