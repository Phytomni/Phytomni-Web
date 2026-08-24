import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createWebHistory } from "vue-router";
import {
  createAppWebHistory,
  withoutDocumentVisibilityListener,
} from "@/router/webHistory";

function setDocumentHidden(hidden: boolean): void {
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: () => (hidden ? "hidden" : "visible"),
  });
  Object.defineProperty(document, "hidden", {
    configurable: true,
    get: () => hidden,
  });
}

afterEach(() => {
  setDocumentHidden(false);
});

describe("withoutDocumentVisibilityListener", () => {
  it("does not attach visibilitychange listeners registered during the factory", () => {
    const onVisibility = vi.fn();
    const onPageHide = vi.fn();
    withoutDocumentVisibilityListener(() => {
      document.addEventListener("visibilitychange", onVisibility);
      document.addEventListener("pagehide", onPageHide);
    });

    document.dispatchEvent(new Event("visibilitychange"));
    document.dispatchEvent(new Event("pagehide"));

    expect(onVisibility).not.toHaveBeenCalled();
    expect(onPageHide).toHaveBeenCalledTimes(1);
  });

  it("restores document.addEventListener after the factory returns", () => {
    const onVisibility = vi.fn();
    withoutDocumentVisibilityListener(() => undefined);
    document.addEventListener("visibilitychange", onVisibility);
    document.dispatchEvent(new Event("visibilitychange"));
    expect(onVisibility).toHaveBeenCalledTimes(1);
    document.removeEventListener("visibilitychange", onVisibility);
  });

  it("restores document.addEventListener when the factory throws", () => {
    expect(() =>
      withoutDocumentVisibilityListener(() => {
        throw new Error("history factory failed");
      })
    ).toThrow("history factory failed");

    const onVisibility = vi.fn();
    document.addEventListener("visibilitychange", onVisibility);
    document.dispatchEvent(new Event("visibilitychange"));
    expect(onVisibility).toHaveBeenCalledTimes(1);
    document.removeEventListener("visibilitychange", onVisibility);
  });
});

describe("createAppWebHistory", () => {
  it("does not checkpoint history when the document becomes hidden", () => {
    const history = createAppWebHistory();
    try {
      expect(window.history.state).toBeTruthy();
      const replaceState = vi.spyOn(window.history, "replaceState");
      setDocumentHidden(true);
      document.dispatchEvent(new Event("visibilitychange"));
      expect(replaceState).not.toHaveBeenCalled();
    } finally {
      history.destroy();
    }
  });

  it("still checkpoints scroll on pagehide while hidden", () => {
    const history = createAppWebHistory();
    try {
      expect(window.history.state).toBeTruthy();
      const replaceState = vi.spyOn(window.history, "replaceState");
      setDocumentHidden(true);
      window.dispatchEvent(new Event("pagehide"));
      expect(replaceState).toHaveBeenCalled();
      const state = replaceState.mock.calls[0]?.[0] as {
        scroll?: { left?: number; top?: number };
      };
      expect(state.scroll).toEqual(
        expect.objectContaining({
          left: expect.any(Number),
          top: expect.any(Number),
        })
      );
    } finally {
      history.destroy();
    }
  });
});

describe("vue-router hidden visibility checkpoint", () => {
  it("is the Edge restore trigger that createAppWebHistory removes", () => {
    const history = createWebHistory();
    try {
      expect(window.history.state).toBeTruthy();
      const replaceState = vi.spyOn(window.history, "replaceState");
      setDocumentHidden(true);
      document.dispatchEvent(new Event("visibilitychange"));
      expect(replaceState).toHaveBeenCalled();
    } finally {
      history.destroy();
    }
  });
});

describe("app router history wiring", () => {
  it("creates browser history through createAppWebHistory", () => {
    const source = readFileSync(
      resolve(__dirname, "../../../src/router/index.ts"),
      "utf8"
    );
    expect(source).toContain(
      "history: createAppWebHistory(import.meta.env.BASE_URL)"
    );
    expect(source).not.toMatch(/history:\s*createWebHistory\(/);
  });
});
