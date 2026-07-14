import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import AuthBrand from "@/components/shell/PhyAuthBrand.vue";

describe("PhyAuthBrand", () => {
  it("renders the real Phytomni mark with an accessible brand label", () => {
    const wrapper = mount(AuthBrand, {
      props: { title: "Phytomni" },
    });

    expect(wrapper.find("img").attributes("src")).toBe("/logo.png");
    expect(wrapper.find("img").attributes("alt")).toBe("");
    expect(wrapper.text()).toContain("Phytomni");
  });
});
