import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import ChatModeSelector from "@/components/ChatModeSelector.vue";

const SOURCE = readFileSync(
  resolve(__dirname, "../../src/components/ChatModeSelector.vue"),
  "utf8"
);

describe("ChatModeSelector.vue", () => {
  it("renders instant + expert radios; disables expert when expertEnabled=false", () => {
    const wrapper = mount(ChatModeSelector, {
      props: { modelValue: "instant", expertEnabled: false },
    });
    const radios = wrapper.findAllComponents({ name: "ElRadioButton" });
    const instant = radios.find((r) => r.props("value") === "instant");
    const expert = radios.find((r) => r.props("value") === "expert");
    expect(instant).toBeTruthy();
    expect(expert?.props("disabled")).toBe(true);
  });

  it("enables expert when expertEnabled=true", () => {
    const wrapper = mount(ChatModeSelector, {
      props: { modelValue: "instant", expertEnabled: true },
    });
    const expert = wrapper
      .findAllComponents({ name: "ElRadioButton" })
      .find((r) => r.props("value") === "expert");
    expect(expert?.props("disabled")).toBeFalsy();
  });

  it("emits update:modelValue when the group changes", async () => {
    const wrapper = mount(ChatModeSelector, {
      props: { modelValue: "instant", expertEnabled: true },
    });
    await wrapper
      .findComponent({ name: "ElRadioGroup" })
      .vm.$emit("update:modelValue", "expert");
    expect(wrapper.emitted("update:modelValue")?.[0]).toEqual(["expert"]);
  });

  it("uses a compact tokenized segmented-control skin", () => {
    expect(SOURCE).toContain("var(--phy-control-height-compact)");
    expect(SOURCE).toContain("var(--phy-radius-pill)");
    expect(SOURCE).toContain("var(--phy-color-primary-soft)");
    expect(SOURCE).not.toMatch(/#[0-9a-f]{3,8}/i);
  });
});
