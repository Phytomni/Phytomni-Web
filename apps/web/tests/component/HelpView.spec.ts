import { beforeEach, describe, expect, it, vi } from "vitest";
import { createTestAppContext } from "../helpers/test-app-context";

vi.mock("vue-router", () => ({
  useRouter: () => ({
    back: vi.fn(),
    push: vi.fn(),
    replace: vi.fn(),
  }),
}));

vi.mock("@/utils/auth", () => ({
  getToken: () => "synthetic-token",
}));

vi.mock("vue-element-plus-x", () => ({
  Typewriter: { name: "Typewriter", template: "<div />" },
}));

import HelpView from "@/views/help/HelpView.vue";

let context: ReturnType<typeof createTestAppContext>;

describe("HelpView", () => {
  beforeEach(() => {
    context = createTestAppContext();
  });

  it("renders real section anchors instead of leaking HTML wrappers into markdown", () => {
    const wrapper = context.mount(HelpView, {
      global: { stubs: { Typewriter: true } },
    });

    const sections = wrapper.findAll(".help-article > section");
    expect(sections).toHaveLength(5);
    expect(sections.map((section) => section.attributes("id"))).toEqual([
      "what-is-phytomni",
      "getting-started",
      "how-it-works",
      "resources",
      "limitations",
    ]);
    expect(wrapper.find(".help-article").text()).not.toContain("<div id=");
    expect(wrapper.findAll(".help-article > section > h1")).toHaveLength(5);
    expect(wrapper.find(".phy-doc-layout__footer").exists()).toBe(true);
  });
});
