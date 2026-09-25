import { describe, expect, it } from "vitest";

import {
  isRecord,
  isSuccessfulDataEnvelope,
  optionalString,
  type Decoder,
  type GatewayEnvelope,
  type JsonValue,
} from "@/api/contracts";

describe("API contract primitives", () => {
  it("recognizes records without treating arrays or null as objects", () => {
    expect(isRecord({})).toBe(true);
    expect(isRecord(Object.create(null))).toBe(true);
    expect(isRecord([])).toBe(false);
    expect(isRecord(null)).toBe(false);
    expect(isRecord("payload")).toBe(false);
  });

  it("reads only own optional string fields", () => {
    const inherited = Object.create({ message: "do-not-inherit" }) as Record<
      string,
      unknown
    >;
    const record = Object.assign(inherited, { own: "safe" });

    expect(optionalString(record, "message")).toBeUndefined();
    expect(optionalString(record, "own")).toBe("safe");
    expect(optionalString({ message: 403 }, "message")).toBeUndefined();
    expect(optionalString({ message: null }, "message")).toBeUndefined();
  });

  it("accepts only success or absent-code data envelopes", () => {
    const data = { answer: "ok" };

    expect(isSuccessfulDataEnvelope({ code: 200, data })).toBe(true);
    expect(isSuccessfulDataEnvelope({ data })).toBe(true);
    expect(isSuccessfulDataEnvelope({ code: 500, data })).toBe(false);
    expect(isSuccessfulDataEnvelope({ code: undefined, data })).toBe(false);
    expect(isSuccessfulDataEnvelope({ code: 200 })).toBe(false);
  });

  it("keeps nested JSON values and gateway envelopes type-bounded", () => {
    const result: JsonValue = ["ok", null, { count: 1 }];
    const envelope: GatewayEnvelope<JsonValue> = {
      code: 200,
      result,
      detail: { message: "ready" },
    };

    expect(envelope.result).toEqual(result);
    expect(envelope.detail).toEqual({ message: "ready" });
  });

  it("rejects malformed payloads without echoing their raw value", () => {
    const decodeMessage: Decoder<string> = (value) => {
      if (!isRecord(value)) throw new Error("Invalid gateway payload");
      const message = optionalString(value, "message");
      if (message === undefined) throw new Error("Invalid gateway message");
      return message;
    };
    const secretPayload = { message: { token: "Bearer secret-token" } };

    expect(() => decodeMessage(secretPayload)).toThrow(
      "Invalid gateway message"
    );
    try {
      decodeMessage(secretPayload);
    } catch (error) {
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).not.toContain("secret-token");
    }
  });
});
