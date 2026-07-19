import { describe, expect, it } from "vitest";

import { decodeLoginResponse } from "@/api/types";

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
