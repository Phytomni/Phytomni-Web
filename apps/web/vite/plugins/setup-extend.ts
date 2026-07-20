import setupExtend from "vite-plugin-vue-setup-extend";
import type { Plugin } from "vite";

export default function createSetupExtend(): Plugin {
  return setupExtend();
}
