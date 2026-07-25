import { describe, it, expect, vi, beforeEach } from "vitest";
import { createTestAppContext } from "../helpers/test-app-context";

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

let context: ReturnType<typeof createTestAppContext>;

function mountView() {
  return context.mount(Register, { global: { stubs: { LangSwitch: true } } });
}

describe("Register consent", () => {
  beforeEach(() => {
    context = createTestAppContext();
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
