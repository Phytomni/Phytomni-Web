import compression from "vite-plugin-compression";
import type { Plugin } from "vite";

export default function createCompression(
  env: Record<string, string>
): Plugin[] {
  const { VITE_BUILD_COMPRESS } = env;
  const plugins: Plugin[] = [];
  if (VITE_BUILD_COMPRESS) {
    const compressList = VITE_BUILD_COMPRESS.split(",");
    if (compressList.includes("gzip")) {
      // See http://doc.ruoyi.vip/ruoyi-vue/other/faq.html (serving gzip-compressed static files)
      plugins.push(
        compression({
          ext: ".gz",
          deleteOriginFile: false,
        })
      );
    }
    if (compressList.includes("brotli")) {
      plugins.push(
        compression({
          ext: ".br",
          algorithm: "brotliCompress",
          deleteOriginFile: false,
        })
      );
    }
  }
  return plugins;
}
