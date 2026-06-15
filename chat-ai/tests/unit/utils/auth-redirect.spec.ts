import { describe, it, expect, vi } from "vitest";
import { safeRedirect, redirectIfAuthed } from "@/utils/auth-redirect";

// GUEST_ONLY_PATHS membership matters for #12-13 — keep the test
// assertions data-driven from the live import so the source-of-truth
// stays in @/router/whitelist.
import { GUEST_ONLY_PATHS } from "@/router/whitelist";

vi.mock("@/utils/auth", () => ({
  getToken: vi.fn(),
}));
import { getToken } from "@/utils/auth";

describe("safeRedirect — fallback on bad input", () => {
  it("returns fallback when target is null", () => {
    expect(safeRedirect(null, "/chat")).toBe("/chat");
  });

  it("returns fallback when target is undefined", () => {
    expect(safeRedirect(undefined, "/chat")).toBe("/chat");
  });

  it("returns fallback when target is empty string", () => {
    expect(safeRedirect("", "/chat")).toBe("/chat");
  });

  it("uses first element of array target", () => {
    expect(safeRedirect(["/history", "/evil"], "/chat")).toBe("/history");
  });

  it("returns fallback when array's first element is null", () => {
    expect(safeRedirect([null] as any, "/chat")).toBe("/chat");
  });
});

describe("safeRedirect — open-redirect hardening", () => {
  it("rejects non-relative path (no leading slash)", () => {
    expect(safeRedirect("chat", "/chat")).toBe("/chat");
  });

  it("rejects protocol-relative // prefix", () => {
    expect(safeRedirect("//evil.example.com", "/chat")).toBe("/chat");
  });

  it("rejects backslash-escaped /\\ prefix", () => {
    expect(safeRedirect("/\\evil.example.com", "/chat")).toBe("/chat");
  });

  it("rejects CRLF injection", () => {
    expect(safeRedirect("/chat\r\nSet-Cookie: x", "/chat")).toBe("/chat");
  });

  it("rejects tab injection", () => {
    expect(safeRedirect("/chat\t", "/chat")).toBe("/chat");
  });

  it("rejects scheme-like input (no leading slash branch)", () => {
    expect(safeRedirect("javascript:alert(1)", "/chat")).toBe("/chat");
  });
});

describe("safeRedirect — happy path + guest-path self-loop guard", () => {
  it("accepts valid in-app path", () => {
    expect(safeRedirect("/chat", "/history")).toBe("/chat");
  });

  it("preserves query string in returned value", () => {
    expect(safeRedirect("/history?id=42", "/chat")).toBe("/history?id=42");
  });

  it("rejects guest-only path to prevent self-loop", () => {
    const guest = Array.from(GUEST_ONLY_PATHS)[0];
    expect(safeRedirect(guest, "/chat")).toBe("/chat");
  });

  it("rejects guest-only path even when carrying a query string", () => {
    const guest = Array.from(GUEST_ONLY_PATHS)[0];
    expect(safeRedirect(`${guest}?next=x`, "/chat")).toBe("/chat");
  });
});

describe("redirectIfAuthed", () => {
  it("returns false and does not redirect when no token", () => {
    (getToken as any).mockReturnValue(undefined);
    const router = { replace: vi.fn() };
    const result = redirectIfAuthed({ query: {} }, router);
    expect(result).toBe(false);
    expect(router.replace).not.toHaveBeenCalled();
  });

  it("returns true and redirects to safe target when authed", () => {
    (getToken as any).mockReturnValue("token-abc");
    const router = { replace: vi.fn() };
    const result = redirectIfAuthed({ query: { redirect: "/history" } }, router);
    expect(result).toBe(true);
    expect(router.replace).toHaveBeenCalledWith("/history");
  });

  it("redirects to default fallback /chat when query.redirect absent", () => {
    (getToken as any).mockReturnValue("token-abc");
    const router = { replace: vi.fn() };
    redirectIfAuthed({ query: {} }, router);
    expect(router.replace).toHaveBeenCalledWith("/chat");
  });

  it("respects custom fallback when provided", () => {
    (getToken as any).mockReturnValue("token-abc");
    const router = { replace: vi.fn() };
    redirectIfAuthed({ query: {} }, router, "/profile");
    expect(router.replace).toHaveBeenCalledWith("/profile");
  });

  it("sanitizes malicious redirect target before replacing", () => {
    (getToken as any).mockReturnValue("token-abc");
    const router = { replace: vi.fn() };
    redirectIfAuthed({ query: { redirect: "//evil.com" } }, router);
    expect(router.replace).toHaveBeenCalledWith("/chat");
  });
});
