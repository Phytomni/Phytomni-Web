import vue from "@vitejs/plugin-vue";
import vueJsx from "@vitejs/plugin-vue-jsx";
import type { PluginOption } from "vite";
import createAutoImport from "./auto-import";
import createCompression from "./compression";

export default function createVitePlugins(
  viteEnv: Record<string, string>,
  isBuild = false
): PluginOption[] {
  const vitePlugins: PluginOption[] = [vue(), vueJsx(), createAutoImport()];
  if (isBuild) vitePlugins.push(...createCompression(viteEnv));
  return vitePlugins;
}
