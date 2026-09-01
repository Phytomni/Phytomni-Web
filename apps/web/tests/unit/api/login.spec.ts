import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/utils/request", () => ({
  default: vi.fn(),
  createAbortableRequest: vi.fn(),
}));

import request from "@/utils/request";
import { logout } from "@/api/login";
import { decodeLoginResponse } from "@/api/types";

const mockRequest = vi.mocked(request);

describe("login response boundary", () => {
  it("keeps optional lock and warning fields typed", () => {
    const response = decodeLoginResponse({
      token: "session-token",
      user_name: "researcher@example.test",
      login_status: "0",
      password_warning: "Rotate your password soon",
      locked: false,
    });

    expect(response.password_warning).toBe("Rotate your password soon");
    expect(response.locked).toBe(false);
  });

  it("rejects malformed optional login fields safely", () => {
    expect(() =>
      decodeLoginResponse({
        token: "session-token",
        user_name: "researcher@example.test",
        login_status: "1",
        locked: "false",
      })
    ).toThrow("Invalid login response");
  });
});

describe("logout session", () => {
  beforeEach(() => {
    mockRequest.mockReset();
  });

  it("posts the current-token logout route without toast or session-expired handling", async () => {
    mockRequest.mockResolvedValueOnce({ code: 200, data: "logged out" });

    await expect(logout()).resolves.toEqual({
      code: 200,
      data: "logged out",
    });
    expect(mockRequest).toHaveBeenCalledWith({
      url: "/api/v1/auth/logout",
      method: "post",
      suppressErrorToast: true,
      skipSessionExpired: true,
    });
  });
});
