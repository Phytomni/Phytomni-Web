import { compression } from "vite-plugin-compression2";
import type { Plugin } from "vite";

type CompressionAlgorithm = "gzip" | "brotliCompress";

export function parseCompressionAlgorithms(
  value: string | undefined
): CompressionAlgorithm[] {
  const requested = new Set(
    (value ?? "")
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean)
  );
  const algorithms: CompressionAlgorithm[] = [];
  if (requested.has("gzip")) algorithms.push("gzip");
  if (requested.has("brotli")) algorithms.push("brotliCompress");
  return algorithms;
}

export default function createCompression(
  env: Record<string, string>
): Plugin[] {
  const algorithms = parseCompressionAlgorithms(env.VITE_BUILD_COMPRESS);
  return algorithms.length
    ? [
        compression({
          algorithms,
          deleteOriginalAssets: false,
        }),
      ]
    : [];
}
