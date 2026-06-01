import { afterEach, vi } from "vitest";
import { createI18n } from "vue-i18n";
import { config } from "@vue/test-utils";
import ElementPlus from "element-plus";

// 全局 i18n stub — LangSwitch 等组件 mount 时需要
const i18n = createI18n({
  legacy: false,
  locale: "zh-CN",
  fallbackLocale: "en-US",
  messages: {
    "zh-CN": {},
    "en-US": {},
  },
});

// 注意:这里不注册 pinia 全局插件 —— 每个测试通过 beforeEach 调用
// setActivePinia(createPinia()) 自行建立 active pinia,组件 mount 时
// useStore() 走 getActivePinia() 回退路径。两份 pinia 实例会导致测试和
// 组件内部读到不同 store(L0 调试已证)。
config.global.plugins = [i18n, ElementPlus];

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
  document.cookie.split(";").forEach((c) => {
    document.cookie = c.replace(/^ +/, "").replace(/=.*/, "=;expires=" + new Date().toUTCString() + ";path=/");
  });
});
