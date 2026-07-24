import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { mount } from "@vue/test-utils";
import PhyTableFrame from "@/components/shell/PhyTableFrame.vue";

const SOURCE = readFileSync(
  resolve(__dirname, "../../../src/components/shell/PhyTableFrame.vue"),
  "utf8"
);

describe("PhyTableFrame", () => {
  it("renders the table slot inside its horizontal overflow container", () => {
    const wrapper = mount(PhyTableFrame, {
      slots: { default: '<table data-test="table"><tbody /></table>' },
    });

    expect(wrapper.find(".phy-table-frame").exists()).toBe(true);
    expect(
      wrapper.find(".phy-table-frame__overflow [data-test=table]").exists()
    ).toBe(true);
    expect(wrapper.find(".phy-table-frame__overflow").classes()).toContain(
      "phy-table-frame__scroll"
    );
  });

  it("renders an optional pagination slot below the table surface", () => {
    const wrapper = mount(PhyTableFrame, {
      slots: {
        default: '<div data-test="table">Rows</div>',
        pagination: '<nav data-test="pagination">Pages</nav>',
      },
    });

    expect(wrapper.find("[data-test=pagination]").exists()).toBe(true);
    expect(wrapper.find(".phy-table-frame__pagination").exists()).toBe(true);
  });

  it("does not define data or column props", () => {
    const props = PhyTableFrame.props ?? {};

    expect("data" in props).toBe(false);
    expect("columns" in props).toBe(false);
  });

  it("keeps horizontal overflow scoped to the table frame", () => {
    expect(SOURCE).toMatch(
      /\.phy-table-frame__scroll\s*\{[\s\S]*overflow-x:\s*auto;[\s\S]*overflow-y:\s*hidden/
    );
    expect(SOURCE).not.toMatch(/position:\s*fixed/);
    expect(SOURCE).toMatch(/min-width:\s*0/);
    expect(SOURCE).toMatch(
      /\.phy-table-frame__scroll\s*\{[\s\S]*max-width:\s*100%[\s\S]*overflow-x:\s*auto/
    );
    expect(SOURCE).not.toContain("width: 1200px");
  });
});
