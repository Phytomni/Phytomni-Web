import { flushPromises } from "@vue/test-utils";
import { defineComponent, h, nextTick } from "vue";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockGetAuthCapabilities = vi.hoisted(() => vi.fn());

vi.mock("@/api/auth", () => ({
  getAuthCapabilities: mockGetAuthCapabilities,
}));

import { useRegistrationAvailability } from "@/composables/useRegistrationAvailability";
import { createTestAppContext } from "../../helpers/test-app-context";

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason?: unknown) => void;
};

function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

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
    const deferred = createDeferred<{
      code: number;
      data: { registration_enabled: boolean };
    }>();
    mockGetAuthCapabilities.mockReturnValue(deferred.promise);
    const wrapper = createTestAppContext({ elementPlus: false }).mount(
      AvailabilityHost
    );
    await nextTick();

    expect(wrapper.get("[data-loading]").attributes("data-loading")).toBe(
      "true"
    );

    deferred.resolve({
      code: 200,
      data: { registration_enabled: false },
    });
    await flushPromises();

    expect(wrapper.get("[data-registration-enabled]").text()).toBe("false");
    expect(wrapper.get("[data-loading]").attributes("data-loading")).toBe(
      "false"
    );
    wrapper.unmount();
  });

  it("keeps registration enabled when the capability request fails", async () => {
    const deferred = createDeferred<never>();
    mockGetAuthCapabilities.mockReturnValue(deferred.promise);
    const wrapper = createTestAppContext({ elementPlus: false }).mount(
      AvailabilityHost
    );
    await nextTick();

    expect(wrapper.get("[data-loading]").attributes("data-loading")).toBe(
      "true"
    );

    deferred.reject(new Error("network unavailable"));
    await flushPromises();

    expect(wrapper.get("[data-registration-enabled]").text()).toBe("true");
    expect(wrapper.get("[data-loading]").attributes("data-loading")).toBe(
      "false"
    );
    wrapper.unmount();
  });
});
