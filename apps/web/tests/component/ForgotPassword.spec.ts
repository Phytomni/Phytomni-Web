import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount, config } from "@vue/test-utils";
import { createI18n } from "vue-i18n";
import ElementPlus from "element-plus";
import zhCN from "@/locales/langs/zh-CN";
import enUS from "@/locales/langs/en-US";

// vi.hoisted runs before the hoisted vi.mock factories, so these spies are
// initialized by the time the factories dereference them (a plain top-level
// const would be in the TDZ when the hoisted factory runs).
const { push, redirectIfAuthed } = vi.hoisted(() => ({
  push: vi.fn(),
  redirectIfAuthed: vi.fn(),
}));
vi.mock("vue-router", () => ({
  useRouter: () => ({ push }),
  useRoute: () => ({ query: {} }),
}));
vi.mock("@/utils/auth-redirect", () => ({ redirectIfAuthed }));

import ForgotPassword from "@/views/forgot-password/index.vue";

// Install the REAL locale messages (not a $t-echoes-the-key stub): the view's
// forgotPassword.* keys ship in src/locales/langs, so the test now exercises
// actual key resolution — it fails if a key is missing or renamed — and the
// assertions below check the real rendered copy. Locale pinned to zh-CN so the
// expected strings are deterministic regardless of the test env's navigator.
const i18n = createI18n({
  legacy: false,
  locale: "zh-CN",
  fallbackLocale: "en-US",
  messages: { "zh-CN": zhCN, "en-US": enUS },
});

// Replace the global empty-message i18n that tests/setup.ts installs with this
// real-message one (vitest isolates per file, so this is local to this spec).
// Installing vue-i18n exactly once avoids the duplicate-registration warnings a
// second plugin would emit.
config.global.plugins = [i18n, ElementPlus];

function mountView() {
  return mount(ForgotPassword, {
    global: {
      stubs: { LangSwitch: true },
    },
  });
}

describe("ForgotPassword view", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders the unavailable notice with no form inputs", () => {
    const wrapper = mountView();
    expect(wrapper.find(".notice-container").exists()).toBe(true);
    expect(wrapper.findAll("input").length).toBe(0);
    // Real zh-CN copy for forgotPassword.unavailableTitle — proves the key
    // resolves, not just that some key string was echoed.
    expect(wrapper.text()).toContain("密码重置功能暂未开放");
  });

  it("invokes redirectIfAuthed on mount", () => {
    mountView();
    expect(redirectIfAuthed).toHaveBeenCalledTimes(1);
  });

  it("routes to /login when Back-to-Login is clicked", async () => {
    const wrapper = mountView();
    await wrapper.find(".submit-button").trigger("click");
    expect(push).toHaveBeenCalledWith("/login");
  });
});
