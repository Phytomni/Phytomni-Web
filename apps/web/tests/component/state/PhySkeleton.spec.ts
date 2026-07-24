import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import PhySkeleton from "@/components/state/PhySkeleton.vue";

const SKELETON_SOURCE = readFileSync(
  resolve(__dirname, "../../../src/components/state/PhySkeleton.vue"),
  "utf8"
);

describe("PhySkeleton", () => {
  it.each([
    ["line", ".phy-skeleton__line"],
    ["card", ".phy-skeleton__card"],
    ["table-row", ".phy-skeleton__table-row"],
  ] as const)("renders the %s shape", (shape, selector) => {
    expect(SKELETON_SOURCE).toContain("minmax(0, 1fr)");
    const wrapper = mount(PhySkeleton, { props: { shape } });

    expect(wrapper.find(".phy-skeleton").attributes("aria-hidden")).toBe(
      "true"
    );
    expect(wrapper.attributes("data-shape")).toBe(shape);
    expect(wrapper.find(selector).exists()).toBe(true);
  });

  it("renders the requested number of repeated items", () => {
    const wrapper = mount(PhySkeleton, {
      props: { shape: "line", count: 3 },
    });

    expect(wrapper.findAll(".phy-skeleton__line")).toHaveLength(3);
  });

  it("exposes a reduced-motion state without making the decoration accessible", () => {
    const wrapper = mount(PhySkeleton, {
      props: { shape: "card", reducedMotion: true },
    });

    expect(wrapper.classes()).toContain("phy-skeleton--reduced-motion");
    expect(wrapper.attributes("data-reduced-motion")).toBe("true");
    expect(wrapper.attributes("role")).toBe("presentation");
  });
});
