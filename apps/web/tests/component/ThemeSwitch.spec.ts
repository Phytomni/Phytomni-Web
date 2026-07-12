import { beforeEach, describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import { createPinia, setActivePinia, type Pinia } from "pinia";
import { createI18n } from "vue-i18n";
import { nextTick } from "vue";
import ThemeSwitch from "@/components/ThemeSwitch.vue";
import { useThemeStore } from "@/stores";
import enUS from "@/locales/langs/en-US";
import zhCN from "@/locales/langs/zh-CN";

let pinia: Pinia;

const i18n = createI18n({
  legacy: false,
  locale: "en-US",
  messages: { "en-US": enUS, "zh-CN": zhCN },
});

const mountSwitch = () =>
  mount(ThemeSwitch, { global: { plugins: [pinia, i18n] } });

describe("ThemeSwitch", () => {
  beforeEach(() => {
    pinia = createPinia();
    setActivePinia(pinia);
  });

  it("localizes every active theme label", async () => {
    const store = useThemeStore();
    store.theme = "system";
    const wrapper = mountSwitch();

    expect(wrapper.get(".theme-label").text()).toBe(enUS.common.followSystem);

    store.theme = "light";
    await nextTick();
    expect(wrapper.get(".theme-label").text()).toBe(enUS.common.lightTheme);

    store.theme = "dark";
    await nextTick();
    expect(wrapper.get(".theme-label").text()).toBe(enUS.common.darkTheme);
  });

  it("uses a semantic compact trigger with an accessible name", () => {
    const wrapper = mountSwitch();
    const trigger = wrapper.get("button.theme-dropdown-link");

    expect(trigger.attributes("type")).toBe("button");
    expect(trigger.attributes("aria-label")).toBe(enUS.common.themeSelector);
    expect(wrapper.get(".theme-label").exists()).toBe(true);
  });
});
