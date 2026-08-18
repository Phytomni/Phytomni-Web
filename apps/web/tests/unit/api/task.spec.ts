import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/utils/request", () => ({
  default: vi.fn(),
  createAbortableRequest: vi.fn(),
}));

import request, { createAbortableRequest } from "@/utils/request";
import { cancelTask, getTaskLifecycle } from "@/api/task";

const mockCreateAbortableRequest = vi.mocked(createAbortableRequest);
const mockRequest = vi.mocked(request);

describe("getTaskLifecycle — wire contract", () => {
  beforeEach(() => {
    mockCreateAbortableRequest.mockReset();
  });

  it("uses the caller request ID for a quiet abortable lifecycle read", async () => {
    const data = {
      id: 42,
      phase: "PREPARING",
      terminal: false,
      child_task_count: 0,
      child_work_accepted: false,
      report_revision: 0,
      artifact_summary: {
        image_count: 0,
        output_directory_count: 0,
        has_report: false,
      },
      reconciliation: "CACHED",
      tracking_degraded: false,
      error_code: null,
    };
    mockCreateAbortableRequest.mockResolvedValueOnce({ code: 200, data });

    await expect(getTaskLifecycle("42", "lifecycle-42")).resolves.toEqual({
      code: 200,
      data,
    });
    expect(mockCreateAbortableRequest).toHaveBeenCalledWith({
      url: "/api/v1/async-tasks/42/lifecycle",
      method: "get",
      requestId: "lifecycle-42",
      suppressErrorToast: true,
    });
  });

  it.each(["", "0", "-1", "1.5", "bot-run", "9007199254740992"])(
    "rejects invalid local task ID %s before Axios",
    (id) => {
      expect(() => getTaskLifecycle(id, "lifecycle-invalid")).toThrow(
        "Invalid task row ID"
      );
      expect(mockCreateAbortableRequest).not.toHaveBeenCalled();
    }
  );
});

describe("cancelTask — wire contract", () => {
  beforeEach(() => {
    mockRequest.mockReset();
  });

  it("posts only the owner-scoped Web row id", async () => {
    const data = {
      id: 42,
      phase: "CANCELLED",
      terminal: true,
      child_task_count: 0,
      child_work_accepted: false,
      report_revision: 1,
      artifact_summary: {
        image_count: 0,
        output_directory_count: 0,
        has_report: true,
      },
      reconciliation: "FRESH",
      tracking_degraded: false,
      error_code: null,
    };
    mockRequest.mockResolvedValueOnce({ code: 200, data });

    await expect(cancelTask("42")).resolves.toEqual({ code: 200, data });
    expect(mockRequest).toHaveBeenCalledWith({
      url: "/api/v1/async-tasks/42/cancel",
      method: "post",
      suppressErrorToast: true,
    });
  });

  it.each(["", "0", "-1", "bot-run"])(
    "rejects invalid local task ID %s before Axios",
    (id) => {
      expect(() => cancelTask(id)).toThrow("Invalid task row ID");
      expect(mockRequest).not.toHaveBeenCalled();
    }
  );
});
