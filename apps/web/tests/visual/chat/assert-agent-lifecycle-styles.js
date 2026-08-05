(() => {
  const root = document.querySelector('[data-testid="chat-visual-root"]');
  if (!root) throw new Error("chat visual root missing");

  const allowed = new Set([
    "agent-preparing",
    "agent-running-partial",
    "agent-succeeded-artifacts",
    "agent-succeeded-empty",
    "agent-failed",
    "agent-delivery-pending",
    "agent-delivery-ready",
    "agent-delivery-retryable",
    "agent-delivery-nonretryable",
    "review-confirm-fallback",
    "analyst-log-pending",
    "analyst-log-available",
  ]);
  const state = root.dataset.agentLifecycleState;
  const failures = [];
  const fail = (message) => failures.push(message);
  const visibleText = (element) => element?.textContent?.trim() || "";

  if (!allowed.has(state)) {
    fail("unknown Agent lifecycle fixture state: " + String(state));
  }

  const transcript = root.querySelector('[data-testid="chat-transcript"]');
  const transcriptContent = root.querySelector(".transcript-content");
  for (const [label, element] of [
    ["root", root],
    ["transcript", transcript],
    ["transcript content", transcriptContent],
  ]) {
    if (!element) {
      fail(label + " is missing");
      continue;
    }
    if (element.scrollWidth > element.clientWidth + 1) {
      fail(label + " overflows horizontally");
    }
  }

  const clippedControls = [];
  const undersizedControls = [];
  const controls = root.querySelectorAll(
    ".transcript-content button, .transcript-content [role=button]"
  );
  for (const control of controls) {
    const rect = control.getBoundingClientRect();
    if (
      rect.left < -0.5 ||
      rect.right > innerWidth + 0.5 ||
      rect.top < -0.5 ||
      rect.bottom > innerHeight + 0.5
    ) {
      clippedControls.push(control.className || control.tagName);
    }
    if (rect.width < 24 || rect.height < 24) {
      undersizedControls.push(control.className || control.tagName);
    }
  }
  if (clippedControls.length) fail("a lifecycle control is clipped");
  if (undersizedControls.length) {
    fail("a lifecycle control is smaller than 24 CSS pixels");
  }

  const lifecycleStatus = root.querySelector(".agent-lifecycle");
  const lifecycleStatuses = root.querySelectorAll(
    ".agent-lifecycle, .agent-lifecycle__terminal"
  );
  const noData = root.querySelector(".no-images");
  const confirm = root.querySelector(".a2ui-confirm");
  const analystLog = root.querySelector('[data-testid="chat-analyst-log"]');

  if (state?.startsWith("agent-") && !visibleText(lifecycleStatus)) {
    fail("Agent lifecycle status is missing or empty");
  }
  if (state === "agent-failed" && lifecycleStatuses.length !== 1) {
    fail("failed Agent state must render exactly one lifecycle status");
  }
  if (state === "agent-succeeded-empty" && !visibleText(noData)) {
    fail("succeeded-empty fixture has no terminal empty copy");
  }
  if (state !== "agent-succeeded-empty" && noData) {
    fail("terminal empty copy leaked into a non-empty lifecycle state");
  }
  if (state === "agent-succeeded-artifacts") {
    const image = root.querySelector(".images-container img");
    if (!image || !image.getAttribute("alt")) {
      fail("succeeded-artifacts fixture has no accessible result image");
    }
  }
  if (state?.startsWith("agent-delivery-")) {
    const archiveActions = root.querySelectorAll(
      '[data-test="result-archive-download"], [data-test="result-archive-retry"]'
    );
    if (archiveActions.length > 1)
      fail("delivery fixture rendered multiple archive actions");
    if (/obs:\/\//iu.test(visibleText(root)))
      fail("delivery fixture exposed raw OBS text");
    if (state === "agent-delivery-ready" && archiveActions.length !== 1) {
      fail("ready delivery fixture must render one archive action");
    }
    if (state === "agent-delivery-pending" && archiveActions.length !== 0) {
      fail("pending delivery fixture must not render an archive action");
    }
  }
  if (state === "review-confirm-fallback") {
    const buttons = confirm?.querySelectorAll("button") ?? [];
    if (!confirm || buttons.length !== 2) {
      fail("Review confirmation fallback did not render two actions");
    }
    for (const button of buttons) {
      if (!visibleText(button)) fail("Review confirmation action has no label");
    }
  }
  if (state?.startsWith("analyst-log-") && !analystLog) {
    fail("Analyst log production component is missing");
  }
  if (
    state?.startsWith("analyst-log-") &&
    !visibleText(root.querySelector(".chat-activity__status"))
  ) {
    fail("Analyst log lifecycle status is missing");
  }
  if (
    state === "analyst-log-pending" &&
    !visibleText(root.querySelector(".log-empty"))
  ) {
    fail("pending Analyst log copy is missing");
  }
  if (
    state === "analyst-log-available" &&
    !visibleText(root.querySelector(".log-pre"))
  ) {
    fail("available Analyst log content is missing");
  }

  const result = {
    pass: failures.length === 0,
    state,
    viewport: { width: innerWidth, height: innerHeight },
    controlCount: controls.length,
    clippedControlCount: clippedControls.length,
    undersizedControlCount: undersizedControls.length,
    horizontalOverflow: {
      root: root.scrollWidth - root.clientWidth,
      transcript: transcript
        ? transcript.scrollWidth - transcript.clientWidth
        : null,
    },
    lifecycleStatusVisible: Boolean(visibleText(lifecycleStatus)),
    terminalEmptyVisible: Boolean(visibleText(noData)),
    confirmVisible: Boolean(confirm),
    analystLogVisible: Boolean(analystLog),
  };
  window.__PHY_AGENT_LIFECYCLE_STYLE_RESULT__ = result;
  if (failures.length) throw new Error(failures.join(" | "));
  return result;
})();
