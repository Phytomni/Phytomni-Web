// AxiosResponse module augmentation — the response interceptor in
// src/utils/request.js unwraps AxiosResponse<T> to its .data payload
// at runtime (line `return res.data`), but since request.js is plain
// JavaScript, TypeScript has no way to express this transformation in
// the inferred return type. Callers across src/views/ and src/api/
// access `.code` / `.msg` / `.message` / `.detail` directly on the
// promise result, which TypeScript sees as AxiosResponse<any, any>
// (where only `.data` / `.status` / `.headers` / `.config` exist).
//
// Rather than convert request.js to TypeScript (a larger rewrite that
// risks touching live request logic), augment AxiosResponse with the
// fields the interceptor's payload surfaces. This is a documented lie:
// the real runtime value is the .data payload, not an AxiosResponse,
// but the type system accepts every access site without per-callsite
// casts. The `data: any` member from the generic AxiosResponse<T> is
// preserved (not redeclared here) so existing `res.data.foo` patterns
// keep working via the `any` escape hatch.

import 'axios';

declare module 'axios' {
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
