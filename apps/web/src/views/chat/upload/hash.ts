export type Sha256Digest = (
  algorithm: "SHA-256",
  data: ArrayBuffer
) => Promise<ArrayBuffer>;

export class UploadHashError extends Error {
  readonly code = "upload_hash_failed";

  constructor(message = "Unable to calculate upload checksum") {
    super(message);
    this.name = "UploadHashError";
  }
}

function toLowerHex(bytes: ArrayBuffer): string {
  const values = new Uint8Array(bytes);
  if (values.length !== 32) {
    throw new UploadHashError("Invalid SHA-256 digest");
  }
  return Array.from(values, (value) =>
    value.toString(16).padStart(2, "0")
  ).join("");
}

function defaultDigest(
  algorithm: "SHA-256",
  data: ArrayBuffer
): Promise<ArrayBuffer> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle)
    return Promise.reject(new UploadHashError("Web Crypto unavailable"));
  return subtle.digest(algorithm, data);
}

/**
 * Create a process-local FIFO hasher. The entire arrayBuffer -> digest
 * operation is serialized so multiple part uploads cannot copy several large
 * slices into JavaScript memory at once.
 */
export function createSerializedBlobHasher(
  digest: Sha256Digest = defaultDigest
): (blob: Blob) => Promise<string> {
  let tail = Promise.resolve();

  return (blob: Blob): Promise<string> => {
    if (!(blob instanceof Blob)) {
      return Promise.reject(new UploadHashError("Invalid upload part"));
    }
    const run = tail.then(async () => {
      let buffer: ArrayBuffer | undefined;
      try {
        buffer = await blob.arrayBuffer();
        const result = await digest("SHA-256", buffer);
        return toLowerHex(result);
      } catch (error) {
        if (error instanceof UploadHashError) throw error;
        throw new UploadHashError();
      } finally {
        // Drop the only local reference before the next FIFO item begins.
        buffer = undefined;
      }
    });
    tail = run.then(
      () => undefined,
      () => undefined
    );
    return run;
  };
}

export const hashBlobSlice = createSerializedBlobHasher();

export async function accountScopeForUsername(
  username: string
): Promise<string> {
  const normalized = username
    .normalize("NFC")
    .trim()
    .toLocaleLowerCase("en-US");
  if (normalized.length === 0 || normalized.length > 320) {
    throw new UploadHashError("Invalid account identity");
  }
  return hashString(normalized);
}

export async function hashString(value: string): Promise<string> {
  const normalized = value.normalize("NFC");
  const encoder = new TextEncoder();
  const bytes = encoder.encode(normalized);
  const result = await defaultDigest("SHA-256", bytes.buffer);
  return toLowerHex(result);
}
