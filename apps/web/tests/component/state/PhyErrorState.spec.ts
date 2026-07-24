import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import PhyErrorState from "@/components/state/PhyErrorState.vue";

const ERROR_SOURCE = readFileSync(
  resolve(__dirname, "../../../src/components/state/PhyErrorState.vue"),
  "utf8"
);

describe("PhyErrorState", () => {
  it("renders the supplied copy as an actionable alert", () => {
    expect(ERROR_SOURCE).toContain("overflow-wrap: anywhere;");
    const wrapper = mount(PhyErrorState, {
      props: {
        title: "Could not load",
        description: "Please try again.",
        retryLabel: "Retry",
      },
    });

    expect(wrapper.attributes("role")).toBe("alert");
    expect(wrapper.get("h2").text()).toBe("Could not load");
    expect(wrapper.get("p").text()).toBe("Please try again.");
    expect(wrapper.get("button").text()).toBe("Retry");
    expect(wrapper.get("button").attributes("type")).toBe("button");
  });

  it("emits retry from the native keyboard-accessible button", async () => {
    const wrapper = mount(PhyErrorState, {
      props: { retryLabel: "Try again" },
    });
    const button = wrapper.get("button");

    await button.trigger("click");

    expect(wrapper.emitted("retry")).toHaveLength(1);
  });

  it("does not render an action when no retry copy or slot is supplied", () => {
    const wrapper = mount(PhyErrorState, {
      props: { title: "Unavailable" },
    });

    expect(wrapper.find("button").exists()).toBe(false);
  });

  it("supports a slotted retry control while keeping the component action boundary", async () => {
    const wrapper = mount(PhyErrorState, {
      slots: { retry: '<span data-test="retry-copy">Retry now</span>' },
    });
    const button = wrapper.get("button");

    expect(wrapper.find('[data-test="retry-copy"]').exists()).toBe(true);
    await button.trigger("click");
    expect(wrapper.emitted("retry")).toHaveLength(1);
  });
});
