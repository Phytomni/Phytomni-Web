import { flushPromises } from "@vue/test-utils";
import { defineComponent, h } from "vue";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockGetAuthCapabilities = vi.hoisted(() => vi.fn());

vi.mock("@/api/auth", () => ({
  getAuthCapabilities: mockGetAuthCapabilities,
}));

import { useRegistrationAvailability } from "@/composables/useRegistrationAvailability";
import { createTestAppContext } from "../../helpers/test-app-context";

const AvailabilityHost = defineComponent({
  setup() {
    const { registrationEnabled, loading } = useRegistrationAvailability();

    return () =>
      h(
        "div",
        {
          "data-registration-enabled": String(registrationEnabled.value),
          "data-loading": String(loading.value),
        },
        String(registrationEnabled.value)
      );
  },
});

describe("useRegistrationAvailability", () => {
  beforeEach(() => {
    mockGetAuthCapabilities.mockReset();
  });

  it("uses the server false value", async () => {
    mockGetAuthCapabilities.mockResolvedValue({
      code: 200,
      data: { registration_enabled: false },
    });
    const wrapper = createTestAppContext({ elementPlus: false }).mount(
      AvailabilityHost
    );
    await flushPromises();

    expect(wrapper.get("[data-registration-enabled]").text()).toBe("false");
    wrapper.unmount();
  });

  it("keeps registration enabled when the capability request fails", async () => {
    mockGetAuthCapabilities.mockRejectedValue(new Error("network unavailable"));
    const wrapper = createTestAppContext({ elementPlus: false }).mount(
      AvailabilityHost
    );
    await flushPromises();

    expect(wrapper.get("[data-registration-enabled]").text()).toBe("true");
    wrapper.unmount();
  });
});
