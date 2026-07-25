import { mount } from "@vue/test-utils";
import type { Plugin } from "vue";
import { createI18n } from "vue-i18n";
import { createPinia, setActivePinia } from "pinia";
import ElementPlus from "element-plus";
import elementEnLocale from "element-plus/es/locale/lang/en";
import elementZhLocale from "element-plus/es/locale/lang/zh-cn";
import type { Router } from "vue-router";
import enUS from "@/locales/langs/en-US";
import zhCN from "@/locales/langs/zh-CN";
import { datetimeFormats } from "@/locales/datetime-formats";

export type TestLocale = "en-US" | "zh-CN";

export interface TestAppContextOptions {
  locale?: TestLocale;
  pinia?: ReturnType<typeof createPinia>;
  router?: Router;
  elementPlus?: boolean;
  additionalPlugins?: Plugin[];
}

export interface TestAppContext {
  pinia: ReturnType<typeof createPinia>;
  i18n: ReturnType<typeof createI18n>;
  router?: Router;
  mount: typeof mount;
}

export function createTestI18n(
  locale: TestLocale = "en-US"
): ReturnType<typeof createI18n> {
  return createI18n({
    legacy: false,
    locale,
    fallbackLocale: "en-US",
    messages: {
      "en-US": { ...enUS, ...elementEnLocale },
      "zh-CN": { ...zhCN, ...elementZhLocale },
    },
    datetimeFormats,
    missingWarn: true,
    fallbackWarn: true,
  });
}

function uniquePlugins(plugins: Plugin[]): Plugin[] {
  return [...new Set(plugins)];
}

export function createTestAppContext(
  options: TestAppContextOptions = {}
): TestAppContext {
  const pinia = options.pinia ?? createPinia();
  const i18n = createTestI18n(options.locale);
  setActivePinia(pinia);
  const plugins: Plugin[] = [pinia, i18n];

  if (options.elementPlus !== false) plugins.push(ElementPlus);
  if (options.router) plugins.push(options.router);
  plugins.push(...(options.additionalPlugins ?? []));

  const contextMount: typeof mount = ((component, mountOptions) => {
    const globalOptions = mountOptions?.global;
    if (
      globalOptions &&
      Object.prototype.hasOwnProperty.call(globalOptions, "plugins")
    ) {
      throw new Error(
        "createTestAppContext owns global.plugins; pass plugins through context options"
      );
    }

    setActivePinia(pinia);

    return mount(component, {
      ...mountOptions,
      global: {
        ...globalOptions,
        plugins: uniquePlugins(plugins),
      },
    });
  }) as typeof mount;

  return { pinia, i18n, router: options.router, mount: contextMount };
}

export const mountWithApp: typeof mount = ((component, mountOptions) =>
  createTestAppContext().mount(component, mountOptions)) as typeof mount;
