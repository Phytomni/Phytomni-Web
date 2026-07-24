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
      props: {
        modelValue: "instant",
        instantEnabled: true,
        expertEnabled: false,
      },
    });
    expect(wrapper.get('[data-test="chat-mode-instant"]').exists()).toBe(true);
    expect(wrapper.get('[data-test="chat-mode-expert"]').exists()).toBe(true);
    const radios = wrapper.findAllComponents({ name: "ElRadioButton" });
    const instant = radios.find((r) => r.props("value") === "instant");
    const expert = radios.find((r) => r.props("value") === "expert");
    expect(instant).toBeTruthy();
    expect(expert?.props("disabled")).toBe(true);
  });

  it("enables expert when expertEnabled=true", () => {
    const wrapper = mount(ChatModeSelector, {
      props: {
        modelValue: "instant",
        instantEnabled: true,
        expertEnabled: true,
      },
    });
    const expert = wrapper
      .findAllComponents({ name: "ElRadioButton" })
      .find((r) => r.props("value") === "expert");
    expect(expert?.props("disabled")).toBeFalsy();
  });

  it("emits update:modelValue when the group changes", async () => {
    const wrapper = mount(ChatModeSelector, {
      props: {
        modelValue: "instant",
        instantEnabled: true,
        expertEnabled: true,
      },
    });
    await wrapper
      .findComponent({ name: "ElRadioGroup" })
      .vm.$emit("update:modelValue", "expert");
    expect(wrapper.emitted("update:modelValue")?.[0]).toEqual(["expert"]);
  });

  it("disables Instant and ignores disabled-mode updates", async () => {
    const wrapper = mount(ChatModeSelector, {
      props: {
        modelValue: "expert",
        instantEnabled: false,
        expertEnabled: true,
      },
    });
    const instant = wrapper
      .findAllComponents({ name: "ElRadioButton" })
      .find((r) => r.props("value") === "instant");
    expect(instant?.props("disabled")).toBe(true);

    await wrapper
      .findComponent({ name: "ElRadioGroup" })
      .vm.$emit("update:modelValue", "instant");
    expect(wrapper.emitted("update:modelValue")).toBeUndefined();
  });

  it("owns the final pale checked colors instead of Element primary", () => {
    expect(SOURCE).toContain("var(--phy-control-height-compact)");
    expect(SOURCE).toContain("var(--phy-radius-pill)");
    expect(SOURCE).toContain(
      "--el-radio-button-checked-bg-color: var(--phy-color-primary-soft)"
    );
    expect(SOURCE).toContain(
      "--el-radio-button-checked-text-color: var(--phy-color-action-text)"
    );
    expect(SOURCE).toContain(
      "--el-radio-button-checked-border-color: transparent"
    );
    expect(SOURCE).toMatch(
      /\.el-radio-button\.is-active \.el-radio-button__inner/
    );
    expect(SOURCE).not.toMatch(/#[0-9a-f]{3,8}/i);
  });
});
