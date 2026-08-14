/// <reference types="vue/jsx" />

declare module "file-saver";
declare module "*.cif?url" {
  const source: string;
  export default source;
}

import "vue-i18n";

declare module "@vue/runtime-core" {
  interface ComponentCustomProperties {
    $t: (key: string, ...args: unknown[]) => string;
    $i18n: unknown;
  }
}

declare module "vue" {
  interface ComponentCustomProperties {
    $t: (key: string, ...args: unknown[]) => string;
    $i18n: unknown;
  }
}
