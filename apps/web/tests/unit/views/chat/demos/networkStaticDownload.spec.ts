import { describe, expect, it } from "vitest";
import {
  NETWORK_SAMPLE_BASE_PATH,
  NETWORK_SAMPLE_FILE_PARTS,
} from "@/views/chat/demos/networkStaticDownload";

describe("networkStaticDownload", () => {
  it("exposes the five existing split zip names under the existing base path", () => {
    expect(NETWORK_SAMPLE_FILE_PARTS).toEqual([
      "network_results.zip.001",
      "network_results.zip.002",
      "network_results.zip.003",
      "network_results.zip.004",
      "network_results.zip.005",
    ]);
    expect(NETWORK_SAMPLE_BASE_PATH).toBe(
      "/static/downloads/5.Gene Netwrok Agent/3.NetwrokAgent/results/"
    );
  });
});
