/// <reference types="vue/jsx" />

declare module "file-saver";

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
