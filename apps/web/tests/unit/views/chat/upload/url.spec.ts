import { describe, expect, it } from "vitest";

import {
  normalizeUploadOrigin,
  uploadEndpoint,
  UploadURLValidationError,
  validateUploadURL,
} from "@/views/chat/upload/url";

const origin = "https://upload.example";
const assetId = "file_abc123";
const validURL = `${origin}/v1/files/${assetId}`;

describe("upload URL boundary", () => {
  it("normalizes only an origin and accepts the exact asset base", () => {
    expect(normalizeUploadOrigin(`${origin}/`)).toBe(origin);
    expect(validateUploadURL(validURL, origin, assetId)).toBe(`${validURL}`);
  });

  it.each([
    ["alternate host", "https://evil.example/v1/files/file_abc123", origin],
    [
      "subdomain confusion",
      "https://upload.example.evil/v1/files/file_abc123",
      origin,
    ],
    ["scheme downgrade", "http://upload.example/v1/files/file_abc123", origin],
    [
      "credentials",
      "https://user:pass@upload.example/v1/files/file_abc123",
      origin,
    ],
    [
      "alternate port",
      "https://upload.example:8443/v1/files/file_abc123",
      origin,
    ],
    ["query", `${validURL}?token=secret`, origin],
    ["fragment", `${validURL}#part`, origin],
    ["path mismatch", `${origin}/v1/files/file_other`, origin],
    ["encoded slash", `${origin}/v1/files/file_abc%2F123`, origin],
    ["encoded traversal", `${origin}/v1/files/file_abc%2e%2e`, origin],
  ])("rejects %s before a data-plane request", (_name, raw, expected) => {
    expect(() => validateUploadURL(raw, expected, assetId)).toThrow(
      UploadURLValidationError
    );
  });

  it.each([
    ["origin path", "https://upload.example/path"],
    ["origin query", "https://upload.example/?token=secret"],
    ["origin credentials", "https://user@upload.example"],
    ["origin fragment", "https://upload.example/#fragment"],
  ])("rejects an unsafe expected origin (%s)", (_name, expected) => {
    expect(() => validateUploadURL(validURL, expected, assetId)).toThrow();
  });

  it("builds only the documented part and completion paths", () => {
    expect(uploadEndpoint(validURL, "parts", 3)).toBe(`${validURL}/parts/3`);
    expect(uploadEndpoint(validURL, "complete")).toBe(`${validURL}/complete`);
    expect(uploadEndpoint(validURL, "abort")).toBe(validURL);
  });

  it("rejects invalid part numbers", () => {
    expect(() => uploadEndpoint(validURL, "parts", 0)).toThrow();
    expect(() => uploadEndpoint(validURL, "parts", 1.5)).toThrow();
  });
});
