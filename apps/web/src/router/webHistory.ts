import { createWebHistory, type RouterHistory } from "vue-router";

/**
 * vue-router 5.x checkpoints scroll via history.replaceState on
 * visibilitychange. Edge on Windows treats a non-null replaceState as
 * window activation, so minimizing the browser immediately restores it.
 * Skip only that listener; pagehide still saves scroll for back/forward.
 */
export function withoutDocumentVisibilityListener<T>(create: () => T): T {
  const original = document.addEventListener;
  document.addEventListener = function (
    this: Document,
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | AddEventListenerOptions
  ): void {
    if (type === "visibilitychange") return;
    original.call(this, type, listener, options);
  } as typeof document.addEventListener;
  try {
    return create();
  } finally {
    document.addEventListener = original;
  }
}

export function createAppWebHistory(base?: string): RouterHistory {
  return withoutDocumentVisibilityListener(() => createWebHistory(base));
}
