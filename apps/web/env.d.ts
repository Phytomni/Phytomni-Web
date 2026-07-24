/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_ATTACHMENTS_BASE_URL?: string;
}

declare module "*.vue" {
  import type { DefineComponent } from "vue";
  // `object` is the standard vue-tsc / official Vue SFC shim type for
  // Props / RawBindings; replacing `{}` (which lint flags as "any
  // non-nullish value") with `object` keeps the shim compatible with
  // any consuming component while satisfying ban-types.
  const component: DefineComponent<object, object, object>;
  export default component;
}

// file-saver ships JS without bundled types. Keep the small API surface used by
// the Web app explicit instead of importing an opaque `any` module.
declare module "file-saver" {
  interface SaveAsOptions {
    autoBom?: boolean;
  }

  export function saveAs(
    data: Blob | string,
    filename?: string,
    options?: SaveAsOptions
  ): void;
}

declare module "@fontsource/inter/400";
declare module "@fontsource/inter/600";
