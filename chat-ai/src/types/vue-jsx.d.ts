// Vue JSX intrinsics shim — vue-tsc 0.39.5 with `"jsx": "preserve"`
// does not automatically pull Vue's JSX namespace into scope, so every
// component that emits JSX (render functions, Icon*.vue templates)
// triggers TS7026: "JSX element implicitly has type 'any' because no
// interface 'JSX.IntrinsicElements' exists."
//
// Referencing vue/jsx.d.ts brings the JSX namespace (IntrinsicElements
// + ElementProperties) into the ambient type environment. This is a
// read-only declaration pull — no Vue internals are redefined.

/// <reference types="vue/jsx" />
