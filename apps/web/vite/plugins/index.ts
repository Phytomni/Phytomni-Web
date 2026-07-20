import vue from "@vitejs/plugin-vue";
import vueJsx from "@vitejs/plugin-vue-jsx";
import type { PluginOption } from "vite";
import createAutoImport from "./auto-import";
import createSvgIcon from "./svg-icon";
import createCompression from "./compression";
import createSetupExtend from "./setup-extend";

export default function createVitePlugins(
  viteEnv: Record<string, string>,
  isBuild = false
): PluginOption[] {
  const vitePlugins: PluginOption[] = [vue(), vueJsx()];
  vitePlugins.push(createAutoImport());
  vitePlugins.push(createSetupExtend());
  vitePlugins.push(createSvgIcon(isBuild));
  if (isBuild) vitePlugins.push(...createCompression(viteEnv));
  return vitePlugins;
}
