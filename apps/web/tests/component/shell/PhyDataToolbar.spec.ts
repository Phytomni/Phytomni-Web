import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { mount } from "@vue/test-utils";
import PhyDataToolbar from "@/components/shell/PhyDataToolbar.vue";

const SOURCE = readFileSync(
  resolve(__dirname, "../../../src/components/shell/PhyDataToolbar.vue"),
  "utf8"
);

describe("PhyDataToolbar", () => {
  it("keeps filters and actions in separate groups", () => {
    const wrapper = mount(PhyDataToolbar, {
      slots: {
        filters: '<label data-test="filter">Search</label>',
        actions: '<button data-test="action">Add</button>',
      },
    });

    expect(
      wrapper.find(".phy-data-toolbar__filters [data-test=filter]").exists()
    ).toBe(true);
    expect(
      wrapper.find(".phy-data-toolbar__actions [data-test=action]").exists()
    ).toBe(true);
  });

  it("uses the default slot as the filter group", () => {
    const wrapper = mount(PhyDataToolbar, {
      slots: { default: '<input data-test="filter" />' },
    });

    expect(
      wrapper.find(".phy-data-toolbar__filters [data-test=filter]").exists()
    ).toBe(true);
    expect(wrapper.find(".phy-data-toolbar__actions").exists()).toBe(false);
  });

  it("marks the toolbar as wrappable for narrow layouts", () => {
    const wrapper = mount(PhyDataToolbar);

    expect(wrapper.classes()).toContain("is-wrappable");
    expect(wrapper.classes()).toContain("phy-data-toolbar--wrap");
  });

  it("stacks filter and action groups without a hard minimum width", () => {
    expect(SOURCE).toMatch(/flex-wrap:\s*wrap/);
    expect(SOURCE).toMatch(
      /@media\s*\(max-width:\s*599px\)[\s\S]*?width:\s*100%/
    );
    expect(SOURCE).toMatch(/@media\s*\(max-width:\s*899px\)/);
    expect(SOURCE).toMatch(/min-width:\s*0/);
    expect(SOURCE).not.toMatch(/min-width:\s*(?:2|3|4)\d{2}px/);
  });
});
