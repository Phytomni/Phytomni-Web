export const NETWORK_SAMPLE_DOWNLOAD_SENTINEL =
  "phytomni-demo:network-sample-zip";
export const NETWORK_SAMPLE_FILE_PARTS = [
  "network_results.zip.001",
  "network_results.zip.002",
  "network_results.zip.003",
  "network_results.zip.004",
  "network_results.zip.005",
] as const;
export const NETWORK_SAMPLE_BASE_PATH =
  "/static/downloads/5.Gene Netwrok Agent/3.NetwrokAgent/results/";

export function startNetworkSampleDownloads(
  downloadOne: (href: string, fileName: string) => void,
  schedule: (fn: () => void, ms: number) => void = (fn, ms) => {
    window.setTimeout(fn, ms);
  }
): void {
  NETWORK_SAMPLE_FILE_PARTS.forEach((fileName, index) => {
    schedule(() => {
      downloadOne(NETWORK_SAMPLE_BASE_PATH + fileName, fileName);
    }, index * 1000);
  });
}
