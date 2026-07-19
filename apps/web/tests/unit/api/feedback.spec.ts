import { describe, expect, it } from "vitest";

import { decodeFeedbackResponse } from "@/api/types";

describe("feedback response decoder", () => {
  it("accepts the user_id object emitted by the Go endpoint", () => {
    expect(decodeFeedbackResponse({ user_id: 17 })).toEqual({ user_id: 17 });
  });

  it("rejects malformed payloads without echoing the payload", () => {
    expect(() => decodeFeedbackResponse({ user_id: "secret-user-id" })).toThrow(
      "Invalid feedback response"
    );
  });
});
