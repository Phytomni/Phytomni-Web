import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import PhyBrandMark from "@/components/brand/PhyBrandMark.vue";
import PhyAuthBrand from "@/components/shell/PhyAuthBrand.vue";

describe("PhyAuthBrand", () => {
  it("preserves the production bitmap fallback and accessible title", () => {
    const wrapper = mount(PhyAuthBrand, {
      props: { title: "Phytomni" },
    });

    expect(wrapper.find("img").attributes("src")).toBe("/logo.png");
    expect(wrapper.find("img").attributes("alt")).toBe("");
    expect(wrapper.find("img").attributes("aria-hidden")).toBe("true");
    expect(wrapper.text()).toContain("Phytomni");
  });
});

describe("PhyBrandMark", () => {
  it("renders a code-native accessible mark when labelled", () => {
    const wrapper = mount(PhyBrandMark, {
      props: { label: "Phytomni" },
    });

    const mark = wrapper.find("svg");
    expect(mark.attributes("role")).toBe("img");
    expect(mark.attributes("aria-label")).toBe("Phytomni");
    expect(mark.attributes("aria-hidden")).toBeUndefined();
    expect(mark.findAll("path").length).toBeGreaterThan(0);
    expect(wrapper.find("img").exists()).toBe(false);
  });

  it("can be used as a decorative mark without an accessible name", () => {
    const wrapper = mount(PhyBrandMark);
    expect(wrapper.find("svg").attributes("aria-hidden")).toBe("true");
    expect(wrapper.find("svg").attributes("aria-label")).toBeUndefined();
  });
});
