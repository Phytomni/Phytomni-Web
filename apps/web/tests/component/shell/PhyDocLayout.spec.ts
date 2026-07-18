import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import PhyDocLayout from "@/components/shell/PhyDocLayout.vue";

const SOURCE = readFileSync(
  resolve(__dirname, "../../../src/components/shell/PhyDocLayout.vue"),
  "utf8"
);

describe("PhyDocLayout", () => {
  it("wraps body with phy-reading and optional toc slot", () => {
    const wrapper = mount(PhyDocLayout, {
      slots: {
        header: '<div data-test="header">H</div>',
        toc: '<nav data-test="toc">TOC</nav>',
        metadata: '<p data-test="metadata">Meta</p>',
        default: '<article data-test="body">Body</article>',
      },
    });
    expect(wrapper.find(".phy-doc-layout").exists()).toBe(true);
    expect(wrapper.find(".phy-doc-body.phy-reading").exists()).toBe(true);
    expect(wrapper.find("[data-test=toc]").exists()).toBe(true);
    expect(wrapper.find("[data-test=metadata]").exists()).toBe(true);
    expect(wrapper.find("[data-test=body]").exists()).toBe(true);
  });

  it("owns a fixed narrative measure without becoming a scroll container", () => {
    expect(SOURCE).toMatch(/\.phy-doc-body\s*\{[\s\S]*max-width:\s*760px/);
    expect(SOURCE).not.toMatch(/\b(?:min-)?height\s*:/);
    expect(SOURCE).not.toMatch(/\boverflow(?:-x|-y)?\s*:/);
  });

  it("keeps an optional footer in the document scroll flow", () => {
    const wrapper = mount(PhyDocLayout, {
      slots: {
        footer: '<div data-test="footer">Footer</div>',
      },
    });

    expect(wrapper.find(".phy-doc-layout__footer").exists()).toBe(true);
    expect(wrapper.find("[data-test=footer]").exists()).toBe(true);
    expect(SOURCE).toMatch(
      /\.phy-doc-layout__footer\s*\{[\s\S]*padding:[^;]*24px/
    );
    expect(SOURCE).toContain("@media (max-width: 899px)");
  });
});
