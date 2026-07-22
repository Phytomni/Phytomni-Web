import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount, config } from "@vue/test-utils";
import { createI18n } from "vue-i18n";
import ElementPlus from "element-plus";
import enUS from "@/locales/langs/en-US";
import zhCN from "@/locales/langs/zh-CN";

const { push, redirectIfAuthed } = vi.hoisted(() => ({
  push: vi.fn(),
  redirectIfAuthed: vi.fn(),
}));
vi.mock("vue-router", () => ({
  useRouter: () => ({ push }),
  useRoute: () => ({ query: {} }),
}));
vi.mock("@/utils/auth-redirect", () => ({ redirectIfAuthed }));
vi.mock("@/api/auth", () => ({ register: vi.fn() }));

import Register from "@/views/register/RegisterView.vue";
import { register } from "@/api/auth";

const i18n = createI18n({
  legacy: false,
  locale: "en-US",
  fallbackLocale: "en-US",
  messages: { "en-US": enUS, "zh-CN": zhCN },
});
config.global.plugins = [i18n, ElementPlus];

function mountView() {
  return mount(Register, { global: { stubs: { LangSwitch: true } } });
}

describe("Register consent", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("points agreement links at /terms and /privacy", () => {
    const wrapper = mountView();
    const hrefs = wrapper
      .findAll(".register-agreement a")
      .map((a) => a.attributes("href"));
    expect(hrefs).toContain("/terms");
    expect(hrefs).toContain("/privacy");
    expect(hrefs.every((h) => h !== "#")).toBe(true);
  });

  it("disables submit until the consent checkbox is checked", async () => {
    const wrapper = mountView();
    const button = wrapper.find(".register-button");
    expect(button.attributes("disabled")).toBeDefined();
    await wrapper.find('input[type="checkbox"]').setValue(true);
    expect(button.attributes("disabled")).toBeUndefined();
  });

  it("does not call register() when checkbox is unchecked", async () => {
    const wrapper = mountView();
    await wrapper.find(".register-button").trigger("click");
    expect(register).not.toHaveBeenCalled();
  });
});
