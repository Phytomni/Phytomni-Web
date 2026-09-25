import { describe, expect, it } from "vitest";

import {
  decodeApiEnvelope,
  decodeAuthCapabilities,
  decodeLoginResponse,
  decodeUserListResponse,
  decodeUserProfileResponse,
  decodeString,
} from "@/api/types";

describe("auth API decoders", () => {
  it("accepts the boolean registration capability", () => {
    expect(decodeAuthCapabilities({ registration_enabled: false })).toEqual({
      registration_enabled: false,
    });
  });

  it("rejects a non-boolean registration capability", () => {
    expect(() =>
      decodeAuthCapabilities({ registration_enabled: "false" })
    ).toThrow("Invalid auth capabilities response");
  });

  it("accepts a login token only when the wire type is a string", () => {
    expect(
      decodeLoginResponse({
        token: "session-token",
        user_name: "researcher@example.test",
        login_status: "1",
      })
    ).toMatchObject({ token: "session-token", login_status: "1" });

    expect(() =>
      decodeLoginResponse({
        token: { value: "secret" },
        user_name: "researcher@example.test",
        login_status: "1",
      })
    ).toThrow("Invalid login response");
  });

  it("rejects malformed user arrays and missing user IDs", () => {
    const valid = {
      total: 1,
      total_pages: 1,
      user_list: [
        {
          id: 42,
          email: "researcher@example.test",
          code: "user",
        },
      ],
    };

    expect(decodeUserListResponse(valid).user_list[0].id).toBe(42);
    expect(() =>
      decodeUserListResponse({ ...valid, user_list: [{ email: "missing-id" }] })
    ).toThrow("Invalid user list response");
    expect(() =>
      decodeUserListResponse({ ...valid, user_list: { id: 42 } })
    ).toThrow("Invalid user list response");
  });

  it("accepts a null detail without treating it as a record", () => {
    const envelope = decodeApiEnvelope(
      { code: 200, detail: null, data: "created" },
      decodeString
    );

    expect(envelope).toMatchObject({
      code: 200,
      detail: null,
      data: "created",
    });
  });

  it("rejects profile payloads without an ID without echoing the payload", () => {
    const secret = { email: "researcher@example.test", token: "secret-token" };

    expect(() => decodeUserProfileResponse(secret)).toThrow(
      "Invalid user profile response"
    );
    try {
      decodeUserProfileResponse(secret);
    } catch (error) {
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).not.toContain("secret-token");
    }
  });
});
