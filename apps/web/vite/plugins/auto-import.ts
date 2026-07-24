import autoImport from "unplugin-auto-import/vite";
import type { PluginOption } from "vite";

export default function createAutoImport(): PluginOption {
  return autoImport({
    imports: ["vue", "vue-router", "pinia"],
    dts: false,
  });
}
