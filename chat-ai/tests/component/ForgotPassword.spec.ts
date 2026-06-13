import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount } from "@vue/test-utils";

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
vi.mock("@/utils/authRedirect", () => ({ redirectIfAuthed }));

import ForgotPassword from "@/views/forgot-password/index.vue";

function mountView() {
  return mount(ForgotPassword, {
    global: {
      stubs: { LangSwitch: true },
      // The view renders i18n keys via $t. The global test i18n stub
      // (tests/setup.ts) deliberately omits forgotPassword.* messages — the
      // real keys ship in src/locales/langs — which makes intlify emit
      // "not found / fall back" stderr noise on every mount. Resolve $t to the
      // key here so the key-based assertions below stay valid while the lookup
      // (and its warnings) is bypassed.
      mocks: { $t: (key: string) => key },
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
    expect(wrapper.text()).toContain("forgotPassword.unavailableTitle");
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
