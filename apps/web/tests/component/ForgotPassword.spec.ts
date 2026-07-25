import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createTestAppContext } from "../helpers/test-app-context";

// vi.hoisted runs before the hoisted vi.mock factories, so these spies are
// initialized by the time the factories dereference them (a plain top-level
// const would be in the TDZ when the hoisted factory runs).
const { push, redirectIfAuthed, route, router } = vi.hoisted(() => {
  const push = vi.fn(() => Promise.resolve());
  const route = { query: {} };
  const router = { push };
  return {
    push,
    redirectIfAuthed: vi.fn(),
    route,
    router,
  };
});
vi.mock("vue-router", () => ({
  useRouter: () => router,
  useRoute: () => route,
}));
vi.mock("@/utils/auth-redirect", () => ({ redirectIfAuthed }));

import ForgotPassword from "@/views/forgot-password/ForgotPasswordView.vue";

const SOURCE = readFileSync(
  resolve(__dirname, "../../src/views/forgot-password/ForgotPasswordView.vue"),
  "utf8"
);

function mountView() {
  return createTestAppContext({ locale: "zh-CN" }).mount(ForgotPassword, {
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

  it("uses the production logo and semantic warning token", () => {
    const wrapper = mountView();
    expect(wrapper.find('.phy-auth-brand img[src="/logo.png"]').exists()).toBe(
      true
    );
    expect(SOURCE).toContain("PhyAuthBrand");
    expect(SOURCE.match(/<PhyAuthBrand/g)).toHaveLength(1);
    expect(SOURCE.match(/<h1/g)).toHaveLength(1);
    expect(wrapper.findAll('.phy-auth-brand img[src="/logo.png"]')).toHaveLength(
      1
    );
    expect(wrapper.findAll("h1")).toHaveLength(1);
    expect(wrapper.get(".forgot-password-title").text()).toBe("忘记密码");
    expect(SOURCE).toContain("var(--el-color-warning)");
    expect(SOURCE).not.toContain("#e6a23c");
  });

  it("exposes only the unavailable navigation action", () => {
    const wrapper = mountView();
    expect(wrapper.findAll("button")).toHaveLength(1);
    expect(
      wrapper.findAll("input, textarea, select, form, progress")
    ).toHaveLength(0);
    expect(wrapper.findAll('[role="progressbar"]')).toHaveLength(0);
    expect(SOURCE).not.toMatch(
      /@\/api|axios|fetch\(|XMLHttpRequest|setInterval|setTimeout/
    );
  });

  it("invokes redirectIfAuthed on mount", () => {
    mountView();
    expect(redirectIfAuthed).toHaveBeenCalledWith(route, router);
  });

  it("routes to /login when Back-to-Login is clicked", async () => {
    const wrapper = mountView();
    await wrapper.find(".submit-button").trigger("click");
    expect(push).toHaveBeenCalledWith("/login");
  });

  it("absorbs a rejected Back-to-Login navigation", async () => {
    push.mockRejectedValueOnce(new Error("navigation unavailable"));
    const wrapper = mountView();

    await wrapper.find(".submit-button").trigger("click");
    await Promise.resolve();

    expect(push).toHaveBeenCalledWith("/login");
  });
});
