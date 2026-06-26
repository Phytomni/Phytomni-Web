/**
 * Task 3: Send-on-Enter after @mention is fully selected.
 *
 * Tests the REAL `guardEnterSubmit` util imported from its source module.
 * (Previous version re-implemented the guard inline — testing a copy, not the
 * shipped function.)
 *
 * The bug: `MentionSender`'s internal `handleKeyDown` calls `submit()` on
 * every keyCode===13, regardless of whether the mention dropdown is open.
 * The fix: a capture-phase keydown handler reads `popoverVisible` and calls
 * `e.stopPropagation()` when the dropdown is open, preventing the premature
 * submit.
 *
 * We test the pure util directly via a minimal fake event + spy — no DOM
 * mount needed, no circular re-implementation.
 */

import { describe, it, expect, vi } from "vitest";
import { guardEnterSubmit } from "@/views/chat/utils/guardEnterSubmit";

describe("guardEnterSubmit — Enter submit guard after @mention select", () => {
  it("blocks Enter when dropdown is OPEN: calls stopPropagation and returns true", () => {
    const stopPropagation = vi.fn();
    const e = { stopPropagation };
    const result = guardEnterSubmit(e, true);
    expect(stopPropagation).toHaveBeenCalledTimes(1);
    expect(result).toBe(true);
  });

  it("allows Enter when dropdown is CLOSED: does NOT call stopPropagation, returns false", () => {
    const stopPropagation = vi.fn();
    const e = { stopPropagation };
    const result = guardEnterSubmit(e, false);
    expect(stopPropagation).not.toHaveBeenCalled();
    expect(result).toBe(false);
  });

  it("allows Enter when popoverVisible is undefined (ref not yet mounted): returns false", () => {
    const stopPropagation = vi.fn();
    const e = { stopPropagation };
    const result = guardEnterSubmit(e, undefined);
    expect(stopPropagation).not.toHaveBeenCalled();
    expect(result).toBe(false);
  });

  it("real no-double-send: select-then-submit — first Enter blocked, second Enter allowed exactly once", () => {
    const stopPropagation = vi.fn();
    const e = { stopPropagation };

    // Step 1: dropdown still open after @mention select → Enter must be blocked
    const r1 = guardEnterSubmit(e, true);
    expect(r1).toBe(true);
    expect(stopPropagation).toHaveBeenCalledTimes(1);

    // Step 2: dropdown now closed → next Enter is allowed (submit fires once)
    const r2 = guardEnterSubmit(e, false);
    expect(r2).toBe(false);
    // stopPropagation count stays at 1 — second call did NOT add another invocation
    expect(stopPropagation).toHaveBeenCalledTimes(1);
  });
});
