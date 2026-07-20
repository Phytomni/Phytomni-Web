import { createSvgIconsPlugin } from "vite-plugin-svg-icons";
import path from "node:path";
import type { Plugin } from "vite";

export default function createSvgIcon(isBuild: boolean): Plugin {
  return createSvgIconsPlugin({
    iconDirs: [path.resolve(process.cwd(), "src/assets/icons/svg")],
    symbolId: "icon-[dir]-[name]",
    svgoOptions: isBuild,
  });
}
