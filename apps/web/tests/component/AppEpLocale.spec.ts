import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createRouter, createMemoryHistory } from "vue-router";
import App from "@/App.vue";
import { useAppStore } from "@/stores";
import en from "element-plus/es/locale/lang/en";
import zhCn from "element-plus/es/locale/lang/zh-cn";
import {
  createTestAppContext,
  type TestAppContext,
} from "../helpers/test-app-context";

const APP_SOURCE = readFileSync(
  resolve(__dirname, "../../src/App.vue"),
  "utf8"
);
const DESIGN_SYSTEM_SOURCE = readFileSync(
  resolve(__dirname, "../../../../docs/frontend-design-system.md"),
  "utf8"
);

let context: TestAppContext;

function mountApp() {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: "/", component: { template: "<div />" } }],
  });
  context = createTestAppContext({ pinia: context.pinia, router });
  return context.mount(App, {
    global: { stubs: { Footer: true } },
  });
}

describe("App.vue Element Plus locale provider", () => {
  beforeEach(() => {
    context = createTestAppContext({ elementPlus: true });
  });

  it("binds zh-cn locale when store language is zh-CN", async () => {
    useAppStore().language = "zh-CN";
    const wrapper = mountApp();
    await wrapper.vm.$nextTick();
    const provider = wrapper.findComponent({ name: "ElConfigProvider" });
    expect(provider.exists()).toBe(true);
    expect(provider.props("locale")).toEqual(zhCn);
  });

  it("binds en locale when store language is en-US", async () => {
    useAppStore().language = "en-US";
    const wrapper = mountApp();
    await wrapper.vm.$nextTick();
    const provider = wrapper.findComponent({ name: "ElConfigProvider" });
    expect(provider.props("locale")).toEqual(en);
  });

  it("updates provider locale when store language changes", async () => {
    const store = useAppStore();
    store.language = "en-US";
    const wrapper = mountApp();
    store.language = "zh-CN";
    await wrapper.vm.$nextTick();
    const provider = wrapper.findComponent({ name: "ElConfigProvider" });
    expect(provider.props("locale")).toEqual(zhCn);
  });

  it("keeps locale switching at the root provider and leaves install-time locale unset", () => {
    expect(APP_SOURCE).toContain("const epLocale = computed");
    expect(APP_SOURCE).toContain('appStore.language === "zh-CN"');
    expect(APP_SOURCE).not.toContain("app.use(ElementPlus, { locale");
    expect(APP_SOURCE).toContain("<TransferProgressList />");
    expect(DESIGN_SYSTEM_SOURCE).toContain(
      "Element Plus locale is reactive at the App root"
    );
    expect(DESIGN_SYSTEM_SOURCE).toMatch(
      /transfer progress is the only root-level visual\s+overlay/
    );
  });
});
