import { describe, it, expect, beforeEach } from "vitest";
import { mount } from "@vue/test-utils";
import { createPinia, setActivePinia, type Pinia } from "pinia";
import PiiWatermark from "@/components/PiiWatermark.vue";
import userStore from "@/stores/user";

let pinia: Pinia;

describe("PiiWatermark.vue", () => {
  beforeEach(() => {
    pinia = createPinia();
    setActivePinia(pinia);
  });

  it("renders an el-watermark carrying the username when logged in", () => {
    const user = userStore();
    user.name = "alice";
    const wrapper = mount(PiiWatermark, {
      global: { plugins: [pinia] },
      slots: { default: "<div class='payload'>content</div>" },
    });
    const wm = wrapper.findComponent({ name: "ElWatermark" });
    expect(wm.exists()).toBe(true);
    const content = wm.props("content") as string[];
    expect(content).toContain("alice");
    expect(wrapper.find(".payload").exists()).toBe(true);
  });

  it("renders the slot without a watermark when username is empty", () => {
    const user = userStore();
    user.name = "";
    const wrapper = mount(PiiWatermark, {
      global: { plugins: [pinia] },
      slots: { default: "<div class='payload'>content</div>" },
    });
    expect(wrapper.findComponent({ name: "ElWatermark" }).exists()).toBe(false);
    expect(wrapper.find(".payload").exists()).toBe(true);
  });
});
