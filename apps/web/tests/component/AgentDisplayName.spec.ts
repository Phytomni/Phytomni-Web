import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import AgentDisplayName from "@/components/AgentDisplayName.vue";

describe("AgentDisplayName", () => {
  it("italicizes only In Silico and leaves Research Agent upright", () => {
    const wrapper = mount(AgentDisplayName, {
      props: { label: "In Silico Research Agent" },
    });
    expect(wrapper.text()).toBe("In Silico Research Agent");
    expect(wrapper.findAll("em")).toHaveLength(1);
    expect(wrapper.get("em").text()).toBe("In Silico");
    expect(wrapper.get("em").text()).not.toContain("Research Agent");
  });

  it("preserves casing and leaves a translated label unchanged", () => {
    const lower = mount(AgentDisplayName, {
      props: { label: "in silico workflow" },
    });
    expect(lower.get("em").text()).toBe("in silico");

    const chinese = mount(AgentDisplayName, {
      props: { label: "虚拟研究智能体" },
    });
    expect(chinese.find("em").exists()).toBe(false);
    expect(chinese.text()).toBe("虚拟研究智能体");

    const embedded = mount(AgentDisplayName, {
      props: { label: "Within Silico Research" },
    });
    expect(embedded.find("em").exists()).toBe(false);
  });

  it("renders markup-like input as text", () => {
    const wrapper = mount(AgentDisplayName, {
      props: {
        label: "<img src=x onerror=alert(1)> In Silico Research Agent",
      },
    });
    expect(wrapper.find("img").exists()).toBe(false);
    expect(wrapper.text()).toContain("<img src=x onerror=alert(1)>");
    expect(wrapper.get("em").text()).toBe("In Silico");
  });
});
