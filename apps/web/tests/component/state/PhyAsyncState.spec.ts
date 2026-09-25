import { describe, expect, it } from "vitest";
import { mountWithApp } from "../../helpers/test-app-context";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import PhyAsyncState from "@/components/state/PhyAsyncState.vue";

const ASYNC_SOURCE = readFileSync(
  resolve(__dirname, "../../../src/components/state/PhyAsyncState.vue"),
  "utf8"
);

describe("PhyAsyncState", () => {
  it("renders loading with a busy boundary and a polite status", () => {
    expect(ASYNC_SOURCE).toContain("aria-busy");
    const wrapper = mountWithApp(PhyAsyncState, {
      props: { state: "loading" },
      slots: { loading: '<div data-test="loading-content">Loading</div>' },
    });

    const boundary = wrapper.find(".phy-async-state");
    expect(boundary.attributes("aria-busy")).toBe("true");
    expect(wrapper.find('[role="status"]').attributes("aria-live")).toBe(
      "polite"
    );
    expect(wrapper.find('[data-test="loading-content"]').exists()).toBe(true);
  });

  it("renders empty content as a status without animation semantics", () => {
    const wrapper = mountWithApp(PhyAsyncState, {
      props: { state: "empty" },
      slots: { empty: '<p data-test="empty-content">Nothing here</p>' },
    });

    expect(wrapper.find(".phy-async-state").attributes("aria-busy")).toBe(
      "false"
    );
    expect(wrapper.find('[role="status"]').exists()).toBe(true);
    expect(wrapper.find('[role="status"]').attributes("aria-live")).toBe(
      "polite"
    );
    expect(wrapper.find('[data-test="empty-content"]').exists()).toBe(true);
  });

  it("renders error content as an alert", () => {
    const wrapper = mountWithApp(PhyAsyncState, {
      props: { state: "error" },
      slots: { error: '<p data-test="error-content">Could not load</p>' },
    });

    expect(wrapper.find(".phy-async-state").attributes("aria-busy")).toBe(
      "false"
    );
    expect(wrapper.find('[role="alert"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="error-content"]').exists()).toBe(true);
  });

  it("renders ready content and optional actions", () => {
    const wrapper = mountWithApp(PhyAsyncState, {
      props: { state: "ready" },
      slots: {
        ready: '<div data-test="ready-content">Loaded</div>',
        actions: '<button data-test="ready-action">Continue</button>',
      },
    });

    expect(wrapper.find(".phy-async-state").attributes("aria-busy")).toBe(
      "false"
    );
    expect(wrapper.find('[data-test="ready-content"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="ready-action"]').exists()).toBe(true);
    expect(wrapper.find('[role="status"]').exists()).toBe(false);
  });

  it("uses the default slot as ready content when no named slot is supplied", () => {
    const wrapper = mountWithApp(PhyAsyncState, {
      props: { state: "ready" },
      slots: { default: '<div data-test="default-content">Ready</div>' },
    });

    expect(wrapper.find('[data-test="default-content"]').exists()).toBe(true);
  });
});
