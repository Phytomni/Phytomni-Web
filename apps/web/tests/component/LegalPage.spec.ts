import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { flushPromises } from "@vue/test-utils";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import zhCN from "@/locales/langs/zh-CN";
import { createTestAppContext } from "../helpers/test-app-context";

const state = vi.hoisted(() => ({
  route: { meta: { doc: "terms", productLayout: "document" } },
  renderError: false,
}));

vi.mock("vue-router", () => ({
  useRoute: () => state.route,
  useRouter: () => ({ push: vi.fn() }),
}));
vi.mock("@/legal/renderLegalMarkdown", async () => {
  const actual = await vi.importActual<
    typeof import("@/legal/renderLegalMarkdown")
  >("@/legal/renderLegalMarkdown");
  return {
    ...actual,
    renderLegalMarkdown: (markdown: string) => {
      if (state.renderError) throw new Error("render failed");
      return actual.renderLegalMarkdown(markdown);
    },
  };
});

import LegalPage from "@/views/legal/LegalView.vue";

const SOURCE = readFileSync(
  resolve(__dirname, "../../src/views/legal/LegalView.vue"),
  "utf8"
);

let context: ReturnType<typeof createTestAppContext>;

describe("LegalPage", () => {
  beforeEach(() => {
    context = createTestAppContext({ locale: "en-US" });
    state.route.meta.doc = "terms";
    state.renderError = false;
  });

  afterEach(() => {
    state.renderError = false;
  });

  it("renders versioned terms with a single legal scroll root and flowing footer", async () => {
    const wrapper = context.mount(LegalPage, {
      global: { stubs: { LangSwitch: true } },
    });
    await flushPromises();
    expect(wrapper.text()).toMatch(/0\.1\.0/);
    expect(wrapper.find(".legal-body").html().length).toBeGreaterThan(20);
    expect(wrapper.text()).toMatch(/draft|review/i);
    expect(wrapper.find('[data-scroll-root="legal"]').exists()).toBe(true);
    expect(wrapper.findAll('[data-scroll-root="legal"]')).toHaveLength(1);
    expect(wrapper.findAll(".footer-container")).toHaveLength(1);
    expect(wrapper.find(".legal-page").find(".footer-container").exists()).toBe(
      true
    );
    expect(wrapper.findAll("[role=progressbar]")).toHaveLength(0);
  });

  it("renders privacy in Chinese without changing metadata or footer ownership", async () => {
    state.route.meta.doc = "privacy";
    context.i18n.global.locale.value = "zh-CN";
    const wrapper = context.mount(LegalPage, {
      global: { stubs: { LangSwitch: true } },
    });
    await flushPromises();

    expect(wrapper.find("h1").text()).toBe(zhCN.legal.privacyTitle);
    expect(wrapper.find(".legal-body").exists()).toBe(true);
    expect(wrapper.text()).toContain(zhCN.legal.versionLabel);
    expect(wrapper.text()).toContain(zhCN.legal.effectiveLabel);
    expect(wrapper.findAll(".footer-container")).toHaveLength(1);
  });

  it("shows the synchronous renderer error state without a loading surface", async () => {
    state.renderError = true;
    const wrapper = context.mount(LegalPage, {
      global: { stubs: { LangSwitch: true } },
    });
    await flushPromises();

    expect(wrapper.find(".legal-error").exists()).toBe(true);
    expect(wrapper.find(".legal-body").exists()).toBe(false);
    expect(wrapper.text()).not.toMatch(/loading|加载中/i);
    expect(wrapper.findAll(".footer-container")).toHaveLength(1);
  });

  it("keeps the legal scroll and sans-serif ownership explicit in the view", () => {
    expect(SOURCE).toMatch(
      /\.legal-page\s*\{[\s\S]*height:\s*100%;[\s\S]*min-height:\s*100dvh;[\s\S]*overflow-y:\s*auto;[\s\S]*padding-bottom:\s*calc\(var\(--phy-space-64\)\s*\+\s*var\(--phy-space-24\)\);/
    );
    expect(SOURCE).toContain('data-scroll-root="legal"');
    expect(SOURCE).toContain("font-family: var(--phy-font-shell)");
    expect(SOURCE).not.toContain("phy-reading");
    expect(SOURCE).not.toContain("var(--phy-font-reading)");
    expect(SOURCE).not.toMatch(/position:\s*(?:fixed|sticky)/);
  });
});
