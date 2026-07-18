import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import PhyAuthLayout from "@/components/shell/PhyAuthLayout.vue";

const SOURCE = readFileSync(
  resolve(__dirname, "../../../src/components/shell/PhyAuthLayout.vue"),
  "utf8",
);

describe("PhyAuthLayout", () => {
  it("renders brand and form slots inside a centered card", () => {
    const wrapper = mount(PhyAuthLayout, {
      slots: {
        brand: '<div data-test="brand">Brand</div>',
        title: '<h1 data-test="title">Title</h1>',
        description: '<p data-test="description">Description</p>',
        default: '<form data-test="form">Form</form>',
        contextual: '<div data-test="contextual">Context</div>',
        secondary: '<div data-test="secondary">Secondary</div>',
        controls: '<div data-test="controls">Controls</div>',
      },
    });
    expect(wrapper.find(".phy-auth-layout").exists()).toBe(true);
    expect(wrapper.find("[data-test=brand]").exists()).toBe(true);
    expect(wrapper.find("[data-test=title]").exists()).toBe(true);
    expect(wrapper.find("[data-test=description]").exists()).toBe(true);
    expect(wrapper.find("[data-test=form]").exists()).toBe(true);
    expect(wrapper.find("[data-test=contextual]").exists()).toBe(true);
    expect(wrapper.find("[data-test=secondary]").exists()).toBe(true);
    expect(wrapper.find("[data-test=controls]").exists()).toBe(true);
    expect(wrapper.find(".phy-auth-card").exists()).toBe(true);
    expect(wrapper.find(".phy-auth-footer").exists()).toBe(true);
    expect(wrapper.findAll(".phy-auth-footer")).toHaveLength(1);
  });

  it("uses a neutral background by default and opts into the horizon explicitly", () => {
    const neutral = mount(PhyAuthLayout);
    expect(neutral.find(".phy-auth-layout").classes()).not.toContain(
      "phy-auth-layout--horizon",
    );

    const horizon = mount(PhyAuthLayout, { props: { horizon: true } });
    expect(horizon.find(".phy-auth-layout").classes()).toContain(
      "phy-auth-layout--horizon",
    );
  });

  it("uses the production logo in the fallback brand", () => {
    const wrapper = mount(PhyAuthLayout);
    expect(wrapper.find('.phy-auth-brand img[src="/logo.png"]').exists()).toBe(true);
    expect(wrapper.find('.phy-auth-brand img').attributes("alt")).toBe("");
    expect(wrapper.find(".phy-auth-brand span").text()).toBe("Phytomni");
  });

  it("keeps the auth scroll, measure, and control contracts in the shell", () => {
    expect(SOURCE).toMatch(/height:\s*100vh;[\s\S]*height:\s*100dvh;/);
    expect(SOURCE).toMatch(/overflow-y:\s*auto/);
    expect(SOURCE).toMatch(/max-width:\s*432px/);
    expect(SOURCE).toMatch(
      /@media\s*\(min-width:\s*600px\)[\s\S]*?clamp\(432px,\s*calc\(35vw - 72px\),\s*672px\)[\s\S]*?max-width:\s*672px/,
    );
    expect(SOURCE).toMatch(/--phy-control-height-primary/);
    expect(SOURCE).toContain("phy-auth-content");
    expect(SOURCE).toContain("phy-auth-layout--horizon");
    expect(SOURCE).not.toMatch(/backdrop-filter|transition:\s*all|animation:/);
  });
});
