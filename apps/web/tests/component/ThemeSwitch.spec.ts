import { beforeEach, describe, expect, it } from "vitest";
import { nextTick } from "vue";
import ThemeSwitch from "@/components/ThemeSwitch.vue";
import { useThemeStore } from "@/stores";
import enUS from "@/locales/langs/en-US";
import { createTestAppContext } from "../helpers/test-app-context";

let context: ReturnType<typeof createTestAppContext>;

const mountSwitch = () => context.mount(ThemeSwitch);

describe("ThemeSwitch", () => {
  beforeEach(() => {
    context = createTestAppContext();
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
