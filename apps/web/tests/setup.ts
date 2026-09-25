import { afterEach, vi } from "vitest";
import { Storage } from "happy-dom";

// Node 26 exposes file-backed Web Storage accessors on globalThis. Without a
// configured storage file they resolve to undefined and shadow happy-dom's
// window storage objects, so bridge the browser-owned instances explicitly.
function installTestStorage() {
  Object.defineProperties(globalThis, {
    localStorage: {
      configurable: true,
      value: new Storage(),
    },
    sessionStorage: {
      configurable: true,
      value: new Storage(),
    },
  });
}

installTestStorage();

// happy-dom 20 no longer exposes the browser print entry point. Define the
// minimal test-only surface so print callers can continue to spy on it.
if (typeof window.print !== "function") {
  Object.defineProperty(window, "print", {
    configurable: true,
    value: () => undefined,
  });
}

afterEach(() => {
  vi.restoreAllMocks();
  // Vitest 4 + happy-dom 20 can retain an instance-level Storage spy even
  // after restoreAllMocks(). Replace the browser-owned instances so a test
  // that intentionally makes a storage method throw cannot poison cleanup or
  // the next test.
  installTestStorage();
  document.cookie.split(";").forEach((c) => {
    document.cookie = c
      .replace(/^ +/, "")
      .replace(/=.*/, "=;expires=" + new Date().toUTCString() + ";path=/");
  });
});
