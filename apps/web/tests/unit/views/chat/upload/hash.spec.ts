import { describe, expect, it, vi } from "vitest";

import {
  accountScopeForUsername,
  createSerializedBlobHasher,
  UploadHashError,
} from "@/views/chat/upload/hash";

describe("serialized upload hashing", () => {
  it("serializes four simultaneous part digests", async () => {
    let active = 0;
    let maximum = 0;
    const digest = vi.fn(async () => {
      active += 1;
      maximum = Math.max(maximum, active);
      await Promise.resolve();
      active -= 1;
      return new Uint8Array(32).buffer;
    });
    const hash = createSerializedBlobHasher(digest);

    const values = await Promise.all(
      Array.from({ length: 4 }, () => hash(new Blob(["part"])))
    );

    expect(digest).toHaveBeenCalledTimes(4);
    expect(maximum).toBe(1);
    expect(values).toEqual([
      "00".repeat(32),
      "00".repeat(32),
      "00".repeat(32),
      "00".repeat(32),
    ]);
  });

  it("returns stable lowercase hexadecimal output", async () => {
    const bytes = new Uint8Array(32);
    bytes[0] = 0x0f;
    bytes[1] = 0xab;
    bytes[31] = 0xff;
    const hash = createSerializedBlobHasher(async () => bytes.buffer);

    await expect(hash(new Blob(["part"]))).resolves.toBe(
      "0fab" + "00".repeat(29) + "ff"
    );
  });

  it("maps digest failures to a stable non-secret error", async () => {
    const hash = createSerializedBlobHasher(async () => {
      throw new Error("private digest detail");
    });

    await expect(hash(new Blob(["part"]))).rejects.toMatchObject({
      name: "UploadHashError",
      code: "upload_hash_failed",
    });
    await expect(hash(new Blob(["part"]))).rejects.not.toThrow(
      "private digest detail"
    );
  });

  it("partitions account scope by normalized identity without exposing it", async () => {
    vi.stubGlobal("crypto", {
      subtle: {
        digest: vi.fn(async () => new Uint8Array(32).buffer),
      },
    });

    await expect(accountScopeForUsername("  User@Example.COM ")).resolves.toBe(
      "00".repeat(32)
    );
    await expect(accountScopeForUsername("user@example.com")).resolves.toBe(
      "00".repeat(32)
    );
    await expect(accountScopeForUsername("   ")).rejects.toBeInstanceOf(
      UploadHashError
    );
    vi.unstubAllGlobals();
  });
});
