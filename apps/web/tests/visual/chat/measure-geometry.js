/**
 * Page-context geometry measurement for Chat visual capture.
 * Stores the result on window.__PHY_CHAT_GEOMETRY_RESULT__ and returns it.
 * Never throws solely because pass === false (assert-geometry.js hard-fails).
 */
(async () => {
  const GEOMETRY_KEY = "__PHY_CHAT_GEOMETRY_RESULT__";

  function measureRect(el) {
    if (!el) {
      return {
        present: false,
        top: 0,
        right: 0,
        bottom: 0,
        left: 0,
        width: 0,
        height: 0,
        visible: false,
      };
    }
    const rect = el.getBoundingClientRect();
    const style = getComputedStyle(el);
    const visible =
      rect.width > 0 &&
      rect.height > 0 &&
      style.display !== "none" &&
      style.visibility !== "hidden" &&
      Number(style.opacity) > 0;
    return {
      present: true,
      top: rect.top,
      right: rect.right,
      bottom: rect.bottom,
      left: rect.left,
      width: rect.width,
      height: rect.height,
      visible,
    };
  }

  function frame() {
    return new Promise((resolve) => requestAnimationFrame(() => resolve()));
  }

  const roots = document.querySelectorAll(
    '[data-testid="chat-root"], [data-testid="chat-visual-root"]'
  );
  if (roots.length !== 1) {
    const fail = {
      viewport: { width: innerWidth, height: innerHeight },
      document: {
        scrollWidth: document.documentElement.scrollWidth,
        scrollHeight: document.documentElement.scrollHeight,
      },
      root: { present: false, count: roots.length },
      transcript: null,
      primaryAction: measureRect(null),
      navigationTrigger: measureRect(null),
      composer: measureRect(null),
      lastMessage: { present: false },
      state: null,
      pass: false,
      error: `Expected exactly one chat-root or chat-visual-root; found ${roots.length}`,
    };
    window[GEOMETRY_KEY] = fail;
    return fail;
  }

  const root = roots[0];
  const state = root.getAttribute("data-chat-state");
  if (state !== "empty" && state !== "populated") {
    const fail = {
      viewport: { width: innerWidth, height: innerHeight },
      document: {
        scrollWidth: document.documentElement.scrollWidth,
        scrollHeight: document.documentElement.scrollHeight,
      },
      root: measureRect(root),
      transcript: null,
      primaryAction: measureRect(null),
      navigationTrigger: measureRect(null),
      composer: measureRect(null),
      lastMessage: { present: false },
      state,
      pass: false,
      error: `Root data-chat-state must be empty|populated; got "${String(
        state
      )}"`,
    };
    window[GEOMETRY_KEY] = fail;
    return fail;
  }

  const transcripts = root.querySelectorAll('[data-testid="chat-transcript"]');
  if (transcripts.length !== 1) {
    const fail = {
      viewport: { width: innerWidth, height: innerHeight },
      document: {
        scrollWidth: document.documentElement.scrollWidth,
        scrollHeight: document.documentElement.scrollHeight,
      },
      root: measureRect(root),
      transcript: { present: false, count: transcripts.length },
      primaryAction: measureRect(null),
      navigationTrigger: measureRect(null),
      composer: measureRect(null),
      lastMessage: { present: false },
      state,
      pass: false,
      error: `Expected exactly one chat-transcript; found ${transcripts.length}`,
    };
    window[GEOMETRY_KEY] = fail;
    return fail;
  }

  const transcriptEl = transcripts[0];
  transcriptEl.scrollTop = transcriptEl.scrollHeight;
  await frame();
  await frame();

  const scrollTop = transcriptEl.scrollTop;
  const scrollHeight = transcriptEl.scrollHeight;
  const clientHeight = transcriptEl.clientHeight;
  const clientWidth = transcriptEl.clientWidth;
  const scrollWidth = transcriptEl.scrollWidth;
  const atBottom =
    scrollHeight - clientHeight - scrollTop <= 1 ||
    scrollHeight <= clientHeight;

  const primaryNodes = document.querySelectorAll(
    '[data-testid="chat-primary-action"]'
  );
  const triggerNodes = document.querySelectorAll(
    '[data-testid="chat-sidebar-trigger"]'
  );
  const composerNodes = document.querySelectorAll(
    '[data-testid="chat-composer"]'
  );
  const messageRows = root.querySelectorAll('[data-testid="chat-message-row"]');
  const lastRow =
    messageRows.length > 0 ? messageRows[messageRows.length - 1] : null;

  const primaryAction =
    primaryNodes.length === 1
      ? measureRect(primaryNodes[0])
      : {
          ...measureRect(null),
          count: primaryNodes.length,
        };
  const navigationTrigger =
    triggerNodes.length === 0
      ? { ...measureRect(null), count: 0 }
      : triggerNodes.length === 1
      ? { ...measureRect(triggerNodes[0]), count: 1 }
      : { ...measureRect(null), count: triggerNodes.length, visible: false };
  const composer =
    composerNodes.length === 1
      ? measureRect(composerNodes[0])
      : { ...measureRect(null), count: composerNodes.length };

  const lastMessage = lastRow
    ? { present: true, ...measureRect(lastRow) }
    : { present: false };

  const drawerState = root.getAttribute("data-sidebar-drawer-state");
  const closedMobile = drawerState === "closed" && triggerNodes.length === 1;
  const openMobile = drawerState === "open";

  let pass = true;
  const reasons = [];

  if (primaryNodes.length !== 1) {
    pass = false;
    reasons.push(`primary-action count ${primaryNodes.length}`);
  }
  if (composerNodes.length !== 1 || !composer.visible) {
    pass = false;
    reasons.push("composer missing or not visible");
  }
  if (state === "empty" && messageRows.length !== 0) {
    pass = false;
    reasons.push("empty state has message rows");
  }
  if (state === "populated" && messageRows.length < 1) {
    pass = false;
    reasons.push("populated state missing message rows");
  }
  if (state === "populated" && !lastMessage.present) {
    pass = false;
    reasons.push("populated state missing lastMessage");
  }
  if (state === "empty" && lastMessage.present) {
    pass = false;
    reasons.push("empty state must not present lastMessage");
  }
  if (!atBottom) {
    pass = false;
    reasons.push("transcript not at bottom");
  }
  if (closedMobile) {
    if (triggerNodes.length !== 1 || !navigationTrigger.visible) {
      pass = false;
      reasons.push("closed mobile requires visible unique sidebar trigger");
    }
  }
  if (openMobile) {
    if (!primaryAction.visible) {
      pass = false;
      reasons.push("open mobile requires visible primary action");
    }
  }
  if (
    !closedMobile &&
    triggerNodes.length > 0 &&
    drawerState !== "closed" &&
    drawerState !== "open"
  ) {
    // Desktop/compact may omit the trigger; if present outside mobile pair, keep unique.
    if (triggerNodes.length !== 1) {
      pass = false;
      reasons.push("sidebar trigger must be unique when present");
    }
  }

  const result = {
    viewport: { width: innerWidth, height: innerHeight },
    document: {
      scrollWidth: document.documentElement.scrollWidth,
      scrollHeight: document.documentElement.scrollHeight,
    },
    root: measureRect(root),
    transcript: {
      present: true,
      scrollTop,
      scrollHeight,
      clientHeight,
      clientWidth,
      scrollWidth,
      atBottom,
      ...measureRect(transcriptEl),
    },
    primaryAction,
    navigationTrigger,
    composer,
    lastMessage,
    state,
    pass,
    ...(reasons.length ? { reasons } : {}),
  };

  window[GEOMETRY_KEY] = result;
  return result;
})();
