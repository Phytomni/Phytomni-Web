import { describe, it, expect, beforeEach } from "vitest";
import { mount } from "@vue/test-utils";
import { createPinia, setActivePinia, type Pinia } from "pinia";
import { createRouter, createMemoryHistory } from "vue-router";
import App from "@/App.vue";
import { useAppStore } from "@/stores";
import en from "element-plus/es/locale/lang/en";
import zhCn from "element-plus/es/locale/lang/zh-cn";

let pinia: Pinia;

function mountApp() {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: "/", component: { template: "<div />" } }],
  });
  return mount(App, {
    global: {
      plugins: [pinia, router],
      stubs: { Footer: true },
    },
  });
}

describe("App.vue Element Plus locale provider", () => {
  beforeEach(() => {
    pinia = createPinia();
    setActivePinia(pinia);
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
});
