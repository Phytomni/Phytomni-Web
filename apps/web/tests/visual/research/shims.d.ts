/// <reference types="vue/jsx" />

declare module "js-cookie";
declare module "nprogress";
declare module "file-saver";

import "axios";
import "vue-i18n";

declare module "axios" {
  export interface AxiosResponse<T = any, D = any> {
    code: number;
    msg: string;
    message: string;
    detail: any;
    download_path: string;
    file_name: string;
    result: any;
  }
}

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
