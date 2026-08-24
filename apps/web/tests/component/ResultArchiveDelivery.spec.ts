import { describe, expect, it } from "vitest";
import ResultArchiveDelivery from "@/components/research/ResultArchiveDelivery.vue";
import { createTestAppContext } from "../helpers/test-app-context";

const pending = {
  schema_version: 1 as const,
  required: true as const,
  status: "pending" as const,
  revision: 1,
  name: null,
  size_bytes: null,
  error_code: null,
  retryable: false,
};

const ready = {
  schema_version: 1 as const,
  required: true as const,
  status: "ready" as const,
  revision: 1,
  name: "research-results.zip",
  size_bytes: 2048,
  error_code: null,
  retryable: false,
};

const retryableFailure = {
  schema_version: 1 as const,
  required: true as const,
  status: "failed" as const,
  revision: 1,
  name: null,
  size_bytes: null,
  error_code: "archive_generation_failed" as const,
  retryable: true,
};

const nonretryableFailure = {
  ...retryableFailure,
  error_code: "no_user_deliverables" as const,
  retryable: false,
};

const manifestInvalidFailure = {
  schema_version: 1 as const,
  required: true as const,
  status: "failed" as const,
  revision: 1,
  name: null,
  size_bytes: null,
  error_code: "artifact_manifest_invalid" as const,
  retryable: false,
};

function mount(props: Record<string, unknown> = {}, slots = {}) {
  return createTestAppContext().mount(ResultArchiveDelivery, {
    props: { activeV1: true, ...props },
    slots,
  });
}

describe("ResultArchiveDelivery", () => {
  it("keeps the historical download slot for a no-v1 result", () => {
    const wrapper = mount(
      { activeV1: false },
      { legacy: '<p data-test="legacy-download">Historical file</p>' }
    );

    expect(wrapper.get('[data-test="legacy-download"]').text()).toContain(
      "Historical file"
    );
    expect(wrapper.find('[data-test="result-archive-download"]').exists()).toBe(
      false
    );
  });

  it("renders preparing without a download or retry action", () => {
    const wrapper = mount({ delivery: pending });

    expect(
      wrapper.get('[data-test="result-archive-delivery"]').text()
    ).toContain("Preparing");
    expect(wrapper.find('[data-test="result-archive-download"]').exists()).toBe(
      false
    );
    expect(wrapper.find('[data-test="result-archive-retry"]').exists()).toBe(
      false
    );
  });

  it("renders exactly one opaque archive download and emits that link", async () => {
    const archive = {
      id: "archive-42",
      name: "research-results.zip",
      kind: "archive" as const,
    };
    const wrapper = mount({ delivery: ready, artifacts: [archive] });

    const button = wrapper.get('[data-test="result-archive-download"]');
    expect(button.attributes("data-artifact-id")).toBe(archive.id);
    expect(button.attributes("aria-label")).toContain("Download");
    await button.trigger("click");

    expect(wrapper.emitted("download")).toEqual([[archive]]);
  });

  it("fails closed for zero, multiple, or non-archive ready links", () => {
    for (const artifacts of [
      [],
      [
        { id: "archive-1", name: "research-results.zip", kind: "archive" },
        { id: "archive-2", name: "research-results.zip", kind: "archive" },
      ],
      [{ id: "report-1", name: "research-results.zip", kind: "report" }],
    ]) {
      const wrapper = mount({ delivery: ready, artifacts });
      expect(
        wrapper.find('[data-test="result-archive-download"]').exists()
      ).toBe(false);
      wrapper.unmount();
    }
  });

  it("uses an accessible retry icon only for retryable failure", async () => {
    const wrapper = mount({ delivery: retryableFailure });
    const button = wrapper.get('[data-test="result-archive-retry"]');

    expect(button.attributes("aria-label")).toContain("Retry");
    await button.trigger("click");
    expect(wrapper.emitted("retry")).toHaveLength(1);

    const blocked = mount({ delivery: nonretryableFailure });
    expect(blocked.find('[data-test="result-archive-retry"]').exists()).toBe(
      false
    );
  });

  it("shows succeeded without attachments for an empty result", () => {
    const wrapper = mount({ delivery: nonretryableFailure });

    expect(wrapper.get('[data-test="result-archive-none"]').text()).toContain(
      "no downloadable attachments"
    );
    expect(wrapper.find('[data-test="result-archive-retry"]').exists()).toBe(
      false
    );
    expect(wrapper.find('[data-test="result-archive-download"]').exists()).toBe(
      false
    );
  });

  it("shows incomplete packaging copy for an invalid producer manifest", () => {
    const wrapper = mount({ delivery: manifestInvalidFailure });

    expect(
      wrapper.get('[data-test="result-archive-manifest-invalid"]').text()
    ).toContain("packaging is incomplete");
    expect(wrapper.find('[data-test="result-archive-retry"]').exists()).toBe(
      false
    );
  });
});
