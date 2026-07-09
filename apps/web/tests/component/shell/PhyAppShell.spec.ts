import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import PhyAppShell from "@/components/shell/PhyAppShell.vue";

describe("PhyAppShell", () => {
  it("renders left, main, and optional right slots", () => {
    const wrapper = mount(PhyAppShell, {
      slots: {
        left: '<aside data-test="left">L</aside>',
        default: '<main data-test="main">M</main>',
        right: '<aside data-test="right">R</aside>',
      },
    });
    expect(wrapper.find(".phy-app-shell").exists()).toBe(true);
    expect(wrapper.find("[data-test=left]").exists()).toBe(true);
    expect(wrapper.find("[data-test=main]").exists()).toBe(true);
    expect(wrapper.find("[data-test=right]").exists()).toBe(true);
  });
});
