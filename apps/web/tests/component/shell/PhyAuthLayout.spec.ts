import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import PhyAuthLayout from "@/components/shell/PhyAuthLayout.vue";

describe("PhyAuthLayout", () => {
  it("renders brand and default slots inside a centered card", () => {
    const wrapper = mount(PhyAuthLayout, {
      slots: {
        brand: '<div data-test="brand">Brand</div>',
        default: '<form data-test="form">Form</form>',
      },
    });
    expect(wrapper.find(".phy-auth-layout").exists()).toBe(true);
    expect(wrapper.find("[data-test=brand]").exists()).toBe(true);
    expect(wrapper.find("[data-test=form]").exists()).toBe(true);
    expect(wrapper.find(".phy-auth-card").exists()).toBe(true);
    expect(wrapper.find(".phy-auth-footer").exists()).toBe(true);
  });
});
