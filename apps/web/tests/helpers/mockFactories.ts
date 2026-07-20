import type {
  NavigationGuard,
  RouteLocationNormalized,
  RouteRecordNormalized,
} from "vue-router";

export function mustGet<T>(value: T | null | undefined, label: string): T {
  if (value === null || value === undefined) {
    throw new Error(`Missing test value: ${label}`);
  }
  return value;
}

export function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason?: unknown) => void;
} {
  let resolve: (value: T) => void = () => undefined;
  let reject: (reason?: unknown) => void = () => undefined;
  const promise = new Promise<T>((settle, fail) => {
    resolve = settle;
    reject = fail;
  });
  return { promise, resolve, reject };
}

function buildMatchedRecord(): RouteRecordNormalized {
  return {
    path: "/",
    redirect: undefined,
    name: undefined,
    components: null,
    children: [],
    meta: {},
    props: {},
    beforeEnter: undefined,
    leaveGuards: new Set<NavigationGuard>(),
    updateGuards: new Set<NavigationGuard>(),
    enterCallbacks: {},
    instances: {},
    aliasOf: undefined,
  };
}

export function buildRouteLocation(
  overrides: Partial<RouteLocationNormalized> = {}
): RouteLocationNormalized {
  return {
    name: undefined,
    path: "/",
    params: {},
    meta: {},
    fullPath: "/",
    query: {},
    hash: "",
    redirectedFrom: undefined,
    matched: [buildMatchedRecord()],
    ...overrides,
  };
}
