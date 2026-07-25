import { describe, expect, it, vi } from "vitest";
import { defineComponent, h, inject } from "vue";
import { createMemoryHistory, createRouter } from "vue-router";
import ElementPlus from "element-plus";
import { useAppStore } from "@/stores";
import {
  createTestAppContext,
  createTestI18n,
  mountWithApp,
} from "../../helpers/test-app-context";
import { getActivePinia, type Pinia } from "pinia";

const TranslationProbe = defineComponent({
  template: `<span data-test="translation">{{ $t("login.loginButton") }}</span>`,
});

describe("test application context", () => {
  it("creates isolated Pinia and complete bilingual i18n instances", () => {
    const first = createTestAppContext({ locale: "en-US" });
    const second = createTestAppContext({ locale: "zh-CN" });

    expect(first.pinia).not.toBe(second.pinia);
    expect(first.i18n).not.toBe(second.i18n);
    expect(first.i18n.global.t("chat.appTitle")).toBe("Phytomni");
    expect(first.i18n.global.t("legal.termsTitle")).toBe("Terms of Service");
    expect(second.i18n.global.t("legal.termsTitle")).toBe("服务条款");
    expect(first.i18n.global.missingWarn).toBe(true);
    expect(first.i18n.global.fallbackWarn).toBe(true);
    expect(
      createTestI18n("en-US").global.t("el.pagination.total", { total: 3 })
    ).toBe("Total 3");
  });

  it("shares the context Pinia with mounted stores", () => {
    const context = createTestAppContext({ elementPlus: false });
    const mounted = context.mount(
      defineComponent({
        setup() {
          const store = useAppStore();
          return { language: store.language };
        },
        template: `<span data-test="language">{{ language }}</span>`,
      })
    );

    expect(mounted.get('[data-test="language"]').text()).toBe("en-US");
  });

  it("installs Element Plus and a memory router once per context", () => {
    const elementInstall = vi.spyOn(ElementPlus, "install");
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [{ path: "/", component: { template: "<div />" } }],
    });
    const routerInstall = vi.spyOn(router, "install");
    const context = createTestAppContext({ router });

    context.mount(
      defineComponent({
        template: `<el-button><router-link to="/">Go</router-link></el-button>`,
      })
    );

    expect(elementInstall).toHaveBeenCalledTimes(1);
    expect(routerInstall).toHaveBeenCalledTimes(1);
    elementInstall.mockRestore();
    routerInstall.mockRestore();
  });

  it("rejects caller-owned global plugins", () => {
    const context = createTestAppContext({ elementPlus: false });

    expect(() =>
      context.mount(TranslationProbe, { global: { plugins: [] } })
    ).toThrow(/owns global\.plugins/);
  });

  it("preserves caller stubs, provides, and slots", () => {
    const context = createTestAppContext({ elementPlus: false });
    const wrapper = context.mount(
      defineComponent({
        setup() {
          return { provided: inject("test-value") };
        },
        components: {
          CustomStub: defineComponent({
            render: () => h("strong", { "data-test": "stub" }, "stubbed"),
          }),
        },
        template: `<div><CustomStub /><span>{{ provided }}</span><slot /></div>`,
      }),
      {
        global: { provide: { "test-value": "provided" } },
        slots: { default: "slotted" },
      }
    );

    expect(wrapper.get('[data-test="stub"]').text()).toBe("stubbed");
    expect(wrapper.text()).toContain("provided");
    expect(wrapper.text()).toContain("slotted");
  });

  it("uses the context-owned translation pack", () => {
    const wrapper = createTestAppContext({ elementPlus: false }).mount(
      TranslationProbe
    );

    expect(wrapper.get('[data-test="translation"]').text()).toBe("Login");
  });

  it("creates a fresh context for every convenience mount", () => {
    const piniaInstances: Pinia[] = [];
    const Probe = defineComponent({
      setup() {
        piniaInstances.push(getActivePinia() as Pinia);
        useAppStore();
        return () => h("span", "probe");
      },
    });

    mountWithApp(Probe);
    mountWithApp(Probe);

    expect(piniaInstances).toHaveLength(2);
    expect(piniaInstances[0]).not.toBe(piniaInstances[1]);
  });
});
