/// <reference types="vite/client" />

declare module '*.vue' {
  import type { DefineComponent } from 'vue';
  // `object` is the standard vue-tsc / official Vue SFC shim type for
  // Props / RawBindings; replacing `{}` (which lint flags as "any
  // non-nullish value") with `object` keeps the shim compatible with
  // any consuming component while satisfying ban-types.
  const component: DefineComponent<object, object, any>;
  export default component;
}

// file-saver ships JS without bundled types and we only consume the well-
// known saveAs(blob, filename) call inside utils/request.ts. Declaring the
// module as opaque keeps vue-tsc clean without adding an @types/file-saver
// dev dep for a single call site.
declare module 'file-saver';
