const HELP = `Usage: node assert-upload-styles.js --help

The browser-evaluated form audits the synthetic unified attachment fixture.
It checks automated layout and accessibility contracts only; it never marks a
human visual review as passed.`;

if (
  typeof process !== "undefined" &&
  Array.isArray(process.argv) &&
  process.argv.includes("--help")
) {
  console.log(HELP);
  process.exit(0);
}

(() => {
  if (typeof document === "undefined") {
    throw new Error("This script must run in the Chat visual fixture browser");
  }

  const root = document.querySelector('[data-testid="chat-visual-root"]');
  if (!root) throw new Error("chat visual root missing");

  const allowedFixtures = new Set([
    "empty",
    "uploading-detail-open",
    "mixed-ready-failed-expired",
    "ten-files-overflow",
    "incompatible-agent-blocked",
  ]);
  const fixture = root.getAttribute("data-attachment-fixture") || "";
  const failures = [];
  const fail = (message) => failures.push(message);
  const tolerance = 1;
  const viewport = { width: innerWidth, height: innerHeight };

  if (!allowedFixtures.has(fixture)) {
    fail("unknown attachment fixture key: " + String(fixture));
  }

  const readRect = (element) => {
    if (!element) return null;
    const { top, right, bottom, left, width, height } =
      element.getBoundingClientRect();
    return { top, right, bottom, left, width, height };
  };
  const isVisible = (element) => {
    if (!element) return false;
    const rect = readRect(element);
    if (!rect || rect.width <= 0 || rect.height <= 0) return false;
    const style = getComputedStyle(element);
    return (
      style.display !== "none" &&
      style.visibility !== "hidden" &&
      Number(style.opacity) > 0
    );
  };
  const isInsideViewport = (rect) =>
    Boolean(
      rect &&
      rect.left >= -tolerance &&
      rect.right <= viewport.width + tolerance &&
      rect.top >= -tolerance &&
      rect.bottom <= viewport.height + tolerance
    );
  const isInteractive = (element) =>
    element instanceof HTMLElement &&
    ["BUTTON", "A", "INPUT", "TEXTAREA", "SELECT"].includes(element.tagName);

  const documentWidth = Math.max(
    document.documentElement.scrollWidth,
    document.body?.scrollWidth || 0
  );
  if (documentWidth > document.documentElement.clientWidth + tolerance) {
    fail(
      `document overflow scrollWidth=${documentWidth} > clientWidth=${document.documentElement.clientWidth}`
    );
  }

  const composer = root.querySelector('[data-testid="chat-composer"]');
  const composerSurface = composer?.querySelector(".chat-composer-surface");
  const editor =
    composer?.querySelector('[data-testid="chat-composer-editor"]') ||
    composer?.querySelector('[data-testid="mention-input"]') ||
    composer?.querySelector(
      '.chat-composer-body textarea, .chat-composer-body [contenteditable="true"], .chat-composer-body .el-textarea__inner'
    ) ||
    composer?.querySelector(".chat-composer-body");
  if (!composer || !composerSurface) {
    fail("chat composer surface is missing");
  }
  if (!editor || !isVisible(editor)) {
    fail("editor is hidden");
  }

  const strip = root.querySelector('[data-testid="attachment-chip-strip"]');
  const row = strip?.querySelector(".attachment-chip-strip__row");
  const chips = strip
    ? Array.from(strip.querySelectorAll('[data-testid="attachment-chip"]'))
    : [];
  const overflow = strip?.querySelector(
    '[data-testid="attachment-chip-overflow"]'
  );
  const detail = root.querySelector('[data-testid="attachment-chip-detail"]');
  const detailProgress = detail?.querySelector(
    '[data-testid="attachment-chip-detail-progress"]'
  );

  if (fixture === "empty") {
    if (strip) fail("empty fixture unexpectedly renders attachment strip");
  } else if (!strip || !row) {
    fail("attachment chip strip is missing");
  }

  const stripRect = readRect(strip);
  const editorRect = readRect(editor);
  const detailRect = readRect(detail);
  if (strip && (!isVisible(strip) || !isInsideViewport(stripRect))) {
    fail("attachment chip strip escapes the viewport");
  }
  if (row) {
    if (getComputedStyle(row).flexWrap !== "nowrap") {
      fail("wrapped attachment strip");
    }
    const chipTops = chips
      .map((chip) => readRect(chip)?.top)
      .filter((top) => typeof top === "number");
    if (new Set(chipTops.map((top) => Math.round(top))).size > 1) {
      fail("wrapped attachment strip");
    }
  }

  if (detail) {
    if (!isVisible(detail) || !isInsideViewport(detailRect)) {
      fail("attachment detail escapes the viewport");
    }
    if (
      stripRect &&
      detailRect &&
      (detailRect.left < stripRect.left - tolerance ||
        detailRect.right > stripRect.right + tolerance)
    ) {
      fail("attachment detail escapes containing strip");
    }
    if (
      editorRect &&
      detailRect &&
      detailRect.bottom > editorRect.top + tolerance
    ) {
      fail("detail surface overlaps editor");
    }
  }

  if (fixture === "uploading-detail-open" && !detail) {
    fail("uploading detail fixture is missing the detail surface");
  }

  if (fixture === "mixed-ready-failed-expired") {
    const states = chips.map((chip) => chip.getAttribute("data-state"));
    if (states.join(",") !== "completed,failed,expired") {
      fail(`mixed fixture states are ${states.join(",")}`);
    }
  }

  if (fixture === "ten-files-overflow") {
    if (chips.length !== 3) {
      fail(
        `overflow fixture renders ${chips.length} direct chips instead of 3`
      );
    }
    if (!overflow || !overflow.textContent?.includes("+7")) {
      fail("overflow fixture is missing the exact +7 more affordance");
    }
  }

  const controls = strip
    ? Array.from(strip.querySelectorAll("button")).filter(
        (button) => !button.closest(".attachment-chip-strip__live-region")
      )
    : [];
  for (const control of controls) {
    const controlRect = readRect(control);
    const insideRow = Boolean(row && row.contains(control));
    if (!insideRow && !isInsideViewport(controlRect)) {
      fail("attachment control escapes viewport");
    }
    if (control.getAttribute("type") !== "button") {
      fail("attachment control is missing type=button");
    }
    if (!control.getAttribute("aria-label")) {
      fail("attachment control is missing an accessible label");
    }
  }

  const progressNow = Number(detailProgress?.getAttribute("aria-valuenow"));
  if (detailProgress) {
    if (
      detailProgress.getAttribute("role") !== "progressbar" ||
      !Number.isFinite(progressNow) ||
      progressNow < 0 ||
      progressNow > 100
    ) {
      fail("attachment progress semantics are invalid");
    }
    if (
      fixture === "uploading-detail-open" &&
      (progressNow <= 0 || progressNow >= 100)
    ) {
      fail("fake progress");
    }
  }

  if (fixture === "incompatible-agent-blocked") {
    const editorDisabled =
      editor?.hasAttribute("disabled") ||
      editor?.getAttribute("aria-disabled") === "true";
    if (editorDisabled) fail("incompatible-Agent fixture hides the editor");
    const send = root.querySelector(
      '[data-testid="chat-composer"] .composer-send-button'
    );
    const sendDisabled =
      send?.hasAttribute("disabled") ||
      send?.getAttribute("aria-disabled") === "true";
    if (!sendDisabled) fail("incompatible-Agent Send control is not disabled");
  }

  const focusTarget =
    chips[0] ||
    overflow ||
    (isInteractive(editor) ? editor : editor?.querySelector("textarea"));
  if (strip && focusTarget instanceof HTMLElement) {
    document.body.dispatchEvent(
      new KeyboardEvent("keydown", { bubbles: true, key: "Tab" })
    );
    focusTarget.focus({ preventScroll: true, focusVisible: true });
    const activeElement = document.activeElement;
    if (activeElement !== focusTarget && !focusTarget.contains(activeElement)) {
      fail("focus target is not effective");
    } else {
      const focusStyle = getComputedStyle(activeElement);
      const focusRing =
        focusStyle.outlineStyle !== "none" &&
        parseFloat(focusStyle.outlineWidth) > 0;
      if (!focusRing) fail("focus ring is missing");
    }
  } else if (fixture !== "empty") {
    fail("focus ring target is missing");
  }

  if (failures.length) {
    throw new Error(failures.join(" | "));
  }

  return {
    pass: true,
    fixture,
    viewport,
    checks: {
      pageOverflow: true,
      stripWrapped: false,
      editorVisible: true,
      detailEditorOverlap: false,
      controlsBounded: true,
      focusRing: true,
      fakeProgress: false,
    },
    manualReview: "Pending",
  };
})();
