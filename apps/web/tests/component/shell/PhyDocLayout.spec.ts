import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import PhyDocLayout from "@/components/shell/PhyDocLayout.vue";

describe("PhyDocLayout", () => {
  it("wraps body with phy-reading and optional toc slot", () => {
    const wrapper = mount(PhyDocLayout, {
      slots: {
        header: '<div data-test="header">H</div>',
        toc: '<nav data-test="toc">TOC</nav>',
        default: '<article data-test="body">Body</article>',
      },
    });
    expect(wrapper.find(".phy-doc-layout").exists()).toBe(true);
    expect(wrapper.find(".phy-doc-body.phy-reading").exists()).toBe(true);
    expect(wrapper.find("[data-test=toc]").exists()).toBe(true);
    expect(wrapper.find("[data-test=body]").exists()).toBe(true);
  });

  it("keeps an optional footer in the document scroll flow", () => {
    const wrapper = mount(PhyDocLayout, {
      slots: {
        footer: '<div data-test="footer">Footer</div>',
      },
    });

    expect(wrapper.find(".phy-doc-layout__footer").exists()).toBe(true);
    expect(wrapper.find("[data-test=footer]").exists()).toBe(true);
  });
});
