/**
 * Page-context geometry measurement for Chat visual capture.
 *
 * Scrolls the transcript owner, applies every reviewed overflow / clearance /
 * responsive-navigation contract, stores the result on
 * window.__PHY_CHAT_GEOMETRY_RESULT__, and returns it. This measurement step
 * never throws solely because pass === false; assert-geometry.js is the only
 * hard-fail step so the JSON can be persisted before assertion.
 */
(async () => {
  const GEOMETRY_KEY = "__PHY_CHAT_GEOMETRY_RESULT__";
  const MOBILE_BREAKPOINT = 900;
  const MOBILE_HEADER_MAX_HEIGHT = 96;
  const EDGE_TOLERANCE = 0.5;

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

  function isInsideViewport(rect) {
    return (
      rect.present &&
      rect.left >= -EDGE_TOLERANCE &&
      rect.right <= innerWidth + EDGE_TOLERANCE &&
      rect.top >= -EDGE_TOLERANCE &&
      rect.bottom <= innerHeight + EDGE_TOLERANCE
    );
  }

  function isVisibleInViewport(rect) {
    return rect.visible && isInsideViewport(rect);
  }

  function frame() {
    return new Promise((resolve) => requestAnimationFrame(() => resolve()));
  }

  function persistFailure(partial, error) {
    const result = {
      viewport: { width: innerWidth, height: innerHeight },
      document: {
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
        scrollHeight: document.documentElement.scrollHeight,
      },
      root: { present: false },
      transcript: null,
      primaryAction: measureRect(null),
      navigationTrigger: measureRect(null),
      composer: measureRect(null),
      lastMessage: { present: false },
      state: null,
      pass: false,
      error,
      ...partial,
    };
    window[GEOMETRY_KEY] = result;
    return result;
  }

  const roots = document.querySelectorAll(
    '[data-testid="chat-root"], [data-testid="chat-visual-root"]'
  );
  if (roots.length !== 1) {
    return persistFailure(
      { root: { present: false, count: roots.length } },
      `Expected exactly one chat-root or chat-visual-root; found ${roots.length}`
    );
  }

  const root = roots[0];
  const state = root.getAttribute("data-chat-state");
  if (state !== "empty" && state !== "populated") {
    return persistFailure(
      { root: measureRect(root), state },
      `Root data-chat-state must be empty|populated; got "${String(state)}"`
    );
  }

  const transcripts = root.querySelectorAll('[data-testid="chat-transcript"]');
  if (transcripts.length !== 1) {
    return persistFailure(
      {
        root: measureRect(root),
        transcript: { present: false, count: transcripts.length },
        state,
      },
      `Expected exactly one chat-transcript; found ${transcripts.length}`
    );
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
      : { ...measureRect(null), count: primaryNodes.length };
  const navigationTrigger =
    triggerNodes.length === 1
      ? { ...measureRect(triggerNodes[0]), count: 1 }
      : { ...measureRect(null), count: triggerNodes.length };
  const composer =
    composerNodes.length === 1
      ? measureRect(composerNodes[0])
      : { ...measureRect(null), count: composerNodes.length };
  const lastMessage = lastRow
    ? { present: true, ...measureRect(lastRow) }
    : { present: false };
  const rootRect = measureRect(root);
  const transcriptRect = measureRect(transcriptEl);

  const drawerState = root.getAttribute("data-sidebar-drawer-state");
  const isMobileViewport = innerWidth < MOBILE_BREAKPOINT;
  const closedMobile = drawerState === "closed";
  const openMobile = drawerState === "open";
  const desktopState = drawerState === "not-mobile" || drawerState == null;
  const docScrollWidth = document.documentElement.scrollWidth;
  const docClientWidth = document.documentElement.clientWidth;
  const reasons = [];

  if (docScrollWidth > docClientWidth) {
    reasons.push(
      `document overflow scrollWidth=${docScrollWidth} > clientWidth=${docClientWidth}`
    );
  }
  if (scrollWidth > clientWidth) {
    reasons.push(
      `transcript overflow scrollWidth=${scrollWidth} > clientWidth=${clientWidth}`
    );
  }

  if (composerNodes.length !== 1 || !composer.visible) {
    reasons.push("composer missing or not visible");
  } else if (!isInsideViewport(composer)) {
    reasons.push("composer escapes viewport");
  }

  if (lastMessage.present) {
    if (
      composer.present &&
      lastMessage.bottom > composer.top + EDGE_TOLERANCE
    ) {
      reasons.push(
        `lastMessage.bottom (${lastMessage.bottom}) > composer.top (${composer.top})`
      );
    }
  } else if (state === "populated") {
    reasons.push("populated state missing lastMessage");
  }

  if (state === "empty" && messageRows.length !== 0) {
    reasons.push("empty state has message rows");
  }
  if (state === "populated" && messageRows.length < 1) {
    reasons.push("populated state missing message rows");
  }
  if (state === "empty" && lastMessage.present) {
    reasons.push("empty state must not present lastMessage");
  }
  if (!atBottom) {
    reasons.push("transcript not at bottom");
  }

  if (isMobileViewport && !closedMobile && !openMobile) {
    reasons.push("viewport below 900 requires mobile drawer state");
  }
  if (!isMobileViewport && !desktopState) {
    reasons.push("viewport at or above 900 requires non-mobile drawer state");
  }
  if (
    isMobileViewport &&
    transcriptRect.top - rootRect.top > MOBILE_HEADER_MAX_HEIGHT
  ) {
    reasons.push(
      `mobile transcript starts too far below viewport (${
        transcriptRect.top - rootRect.top
      }px)`
    );
  }

  if (closedMobile) {
    if (triggerNodes.length !== 1 || !isVisibleInViewport(navigationTrigger)) {
      reasons.push("closed mobile requires visible unique sidebar trigger");
    }
  } else if (openMobile || desktopState) {
    if (primaryNodes.length !== 1 || !isVisibleInViewport(primaryAction)) {
      reasons.push(
        "desktop/compact/open-mobile requires visible unique primary action"
      );
    }
  }

  if (primaryNodes.length > 1) {
    reasons.push(`primary-action count ${primaryNodes.length}`);
  }
  if (triggerNodes.length > 1) {
    reasons.push(`sidebar trigger count ${triggerNodes.length}`);
  }

  const result = {
    viewport: { width: innerWidth, height: innerHeight },
    document: {
      scrollWidth: docScrollWidth,
      clientWidth: docClientWidth,
      scrollHeight: document.documentElement.scrollHeight,
    },
    root: rootRect,
    transcript: {
      present: true,
      scrollTop,
      scrollHeight,
      clientHeight,
      clientWidth,
      scrollWidth,
      atBottom,
      ...transcriptRect,
    },
    primaryAction,
    navigationTrigger,
    composer,
    lastMessage,
    state,
    drawerState,
    pass: reasons.length === 0,
    ...(reasons.length ? { reasons } : {}),
  };

  window[GEOMETRY_KEY] = result;
  return result;
})();
