const ASSET_ID_PATTERN = /^file_[A-Za-z0-9_-]{1,123}$/;

export class UploadURLValidationError extends TypeError {
  readonly code = "invalid_upload_url";

  constructor(message = "Invalid upload URL") {
    super(message);
    this.name = "UploadURLValidationError";
  }
}

function reject(message?: string): never {
  throw new UploadURLValidationError(message);
}

function parseOrigin(raw: string): URL {
  if (typeof raw !== "string" || raw.length === 0 || raw.trim() !== raw) {
    reject("Invalid upload origin");
  }
  let origin: URL;
  try {
    origin = new URL(raw);
  } catch {
    reject("Invalid upload origin");
  }
  if (
    (origin.protocol !== "https:" && origin.protocol !== "http:") ||
    origin.origin === "null" ||
    origin.hostname.length === 0 ||
    origin.username !== "" ||
    origin.password !== "" ||
    origin.pathname !== "/" ||
    origin.search !== "" ||
    origin.hash !== ""
  ) {
    reject("Invalid upload origin");
  }
  return origin;
}

export function normalizeUploadOrigin(raw: string): string {
  return parseOrigin(raw).origin;
}

export function validateUploadURL(
  raw: string,
  expectedOrigin: string,
  assetId: string
): string {
  if (!ASSET_ID_PATTERN.test(assetId)) reject("Invalid upload asset id");
  const origin = parseOrigin(expectedOrigin);
  if (typeof raw !== "string" || raw.length === 0 || raw.trim() !== raw) {
    reject();
  }

  let uploadURL: URL;
  try {
    uploadURL = new URL(raw);
  } catch {
    reject();
  }
  const expectedPath = `/v1/files/${assetId}`;
  if (
    (uploadURL.protocol !== "https:" && uploadURL.protocol !== "http:") ||
    uploadURL.origin !== origin.origin ||
    uploadURL.username !== "" ||
    uploadURL.password !== "" ||
    uploadURL.pathname !== expectedPath ||
    uploadURL.search !== "" ||
    uploadURL.hash !== ""
  ) {
    reject("Upload URL is outside the configured asset origin");
  }

  // A path that happened to parse to the expected value must not contain an
  // encoded separator or traversal marker. The exact pathname check above
  // rejects normal variants; this explicit guard documents the boundary and
  // protects future URL-builder changes.
  const rawPath = raw.slice(raw.indexOf(uploadURL.pathname));
  if (/%(?:2f|2F|5c|5C|2e|2E)/.test(rawPath)) {
    reject("Encoded upload path separators are not allowed");
  }
  return uploadURL.toString();
}

export function uploadEndpoint(
  validatedBaseURL: string,
  suffix: "parts" | "complete" | "abort",
  partNumber?: number
): string {
  let base: URL;
  try {
    base = new URL(validatedBaseURL);
  } catch {
    reject();
  }
  if (
    (base.protocol !== "https:" && base.protocol !== "http:") ||
    base.username !== "" ||
    base.password !== "" ||
    base.search !== "" ||
    base.hash !== "" ||
    !ASSET_ID_PATTERN.test(base.pathname.slice("/v1/files/".length)) ||
    !base.pathname.startsWith("/v1/files/")
  ) {
    reject();
  }
  if (suffix === "parts") {
    if (
      typeof partNumber !== "number" ||
      !Number.isSafeInteger(partNumber) ||
      partNumber < 1
    ) {
      reject("Invalid upload part number");
    }
    base.pathname = `${base.pathname}/parts/${partNumber}`;
  } else if (suffix === "complete") {
    base.pathname = `${base.pathname}/complete`;
  } else {
    // DELETE uses the asset base URL itself.
    return base.toString();
  }
  return base.toString();
}
