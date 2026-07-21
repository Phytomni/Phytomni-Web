import { beforeEach, describe, expect, it, vi } from "vitest";
import { config, mount } from "@vue/test-utils";
import { createI18n } from "vue-i18n";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import enUS from "@/locales/langs/en-US";
import zhCN from "@/locales/langs/zh-CN";

const mocks = vi.hoisted(() => ({
  push: vi.fn(() => Promise.resolve()),
  go: vi.fn(),
  route: { query: {} as Record<string, unknown> },
}));

vi.mock("vue-router", () => ({
  useRoute: () => mocks.route,
  useRouter: () => ({ push: mocks.push, go: mocks.go }),
}));

import Unauthorized from "@/views/error/401.vue";
import NotFound from "@/views/error/404.vue";

// Each mount installs a locale with the requested language. Remove the empty
// global i18n plugin from tests/setup.ts so this focused suite does not stack
// two vue-i18n instances on the same app.
config.global.plugins = [];

const APP_SOURCE = readFileSync(
  resolve(__dirname, "../../src/App.vue"),
  "utf8"
);

const routerLinkStub = {
  props: { to: { type: [String, Object], required: true } },
  template: "<a :href=\"typeof to === 'string' ? to : to.path\"><slot /></a>",
};

const makeI18n = (locale: "en-US" | "zh-CN") =>
  createI18n({
    legacy: false,
    locale,
    fallbackLocale: "en-US",
    messages: { "en-US": enUS, "zh-CN": zhCN },
  });

const mountUnauthorized = (locale: "en-US" | "zh-CN" = "en-US") =>
  mount(Unauthorized, {
    global: {
      plugins: [makeI18n(locale)],
      stubs: { RouterLink: routerLinkStub },
    },
  });

const mountNotFound = (locale: "en-US" | "zh-CN" = "en-US") =>
  mount(NotFound, {
    global: {
      plugins: [makeI18n(locale)],
      stubs: { RouterLink: routerLinkStub },
    },
  });

describe("standalone recovery pages", () => {
  beforeEach(() => {
    mocks.push.mockReset();
    mocks.push.mockResolvedValue(undefined);
    mocks.go.mockReset();
    mocks.route.query = {};
  });

  it("keeps 401 Back visible and sends noGoBack users to the root", async () => {
    mocks.route.query = { noGoBack: "1" };
    const wrapper = mountUnauthorized();

    const back = wrapper.get("button[data-action='back']");
    expect(back.isVisible()).toBe(true);
    await back.trigger("click");

    expect(mocks.push).toHaveBeenCalledWith("/");
    expect(mocks.go).not.toHaveBeenCalled();
  });

  it("absorbs a rejected 401 root navigation", async () => {
    mocks.route.query = { noGoBack: "1" };
    mocks.push.mockRejectedValueOnce(new Error("navigation unavailable"));
    const wrapper = mountUnauthorized();

    await wrapper.get("button[data-action='back']").trigger("click");
    await Promise.resolve();

    expect(mocks.push).toHaveBeenCalledWith("/");
  });

  it("uses browser history for 401 Back when noGoBack is absent", async () => {
    const wrapper = mountUnauthorized();

    await wrapper.get("button[data-action='back']").trigger("click");

    expect(mocks.go).toHaveBeenCalledWith(-1);
    expect(mocks.push).not.toHaveBeenCalled();
  });

  it("keeps a separate Home action after Back on 401", () => {
    const wrapper = mountUnauthorized();
    const actions = wrapper.findAll("button, a");

    expect(actions).toHaveLength(2);
    expect(actions[0].attributes("data-action")).toBe("back");
    expect(actions[1].attributes("href")).toBe("/");
    expect(wrapper.find(".standalone-footer").exists()).toBe(false);
  });

  it("routes the 404 primary recovery action to Chat, never /index", () => {
    const wrapper = mountNotFound();
    const primary = wrapper.get("a[data-action='primary']");

    expect(primary.attributes("href")).toBe("/chat");
    expect(wrapper.html()).not.toContain("/index");
  });

  it("keeps keyboard order and both locale copies available", () => {
    const enUnauthorized = mountUnauthorized("en-US");
    const zhUnauthorized = mountUnauthorized("zh-CN");
    const enNotFound = mountNotFound("en-US");
    const zhNotFound = mountNotFound("zh-CN");

    expect(
      enUnauthorized.findAll("button, a").map((node) => node.element.tagName)
    ).toEqual(["BUTTON", "A"]);
    expect(zhUnauthorized.text()).toContain(zhCN.errorPage.e401Title);
    expect(enNotFound.text()).toContain(enUS.errorPage.e404Title);
    expect(zhNotFound.text()).toContain(zhCN.errorPage.e404Title);
    expect(enNotFound.find("a[data-action='primary']").attributes("href")).toBe(
      "/chat"
    );
  });

  it("keeps recovery surfaces free of global fixed-footer ownership", () => {
    expect(APP_SOURCE).not.toContain("app-footer");
    expect(APP_SOURCE).not.toContain("showFooter");
    expect(
      readFileSync(resolve(__dirname, "../../src/views/error/401.vue"), "utf8")
    ).not.toMatch(/<img\b|401_images/);
    expect(
      readFileSync(resolve(__dirname, "../../src/views/error/404.vue"), "utf8")
    ).not.toMatch(/<img\b|404_images/);
  });
});
