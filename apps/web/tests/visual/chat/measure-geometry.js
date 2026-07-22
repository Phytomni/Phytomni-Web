/**
 * Page-context geometry measurement for Chat visual capture.
 *
 * Scrolls the active transcript/content owner, applies every reviewed overflow / clearance /
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
      contentStack: null,
      scrollOwner: null,
      emptyScrollPosition: null,
      primaryAction: measureRect(null),
      navigationTrigger: measureRect(null),
      composer: measureRect(null),
      headerPreferences: measureRect(null),
      quickSelectCount: 0,
      caseRegionCount: 0,
      caseLinkCount: 0,
      lastCase: { present: false },
      lastMessage: { present: false },
      state: null,
      chatMode: null,
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
  const chatMode = root.getAttribute("data-chat-mode") || "instant";
  if (chatMode !== "instant" && chatMode !== "expert") {
    return persistFailure(
      { root: measureRect(root), state, chatMode },
      `Root data-chat-mode must be instant|expert; got "${String(chatMode)}"`
    );
  }

  const transcripts = root.querySelectorAll('[data-testid="chat-transcript"]');
  if (transcripts.length !== 1) {
    return persistFailure(
      {
        root: measureRect(root),
        transcript: { present: false, count: transcripts.length },
        state,
        chatMode,
      },
      `Expected exactly one chat-transcript; found ${transcripts.length}`
    );
  }

  const transcriptEl = transcripts[0];
  const contentStacks = root.querySelectorAll(
    '[data-testid="chat-content-stack"]'
  );
  if (contentStacks.length !== 1) {
    return persistFailure(
      {
        root: measureRect(root),
        contentStack: { present: false, count: contentStacks.length },
        state,
        chatMode,
      },
      `Expected exactly one chat-content-stack; found ${contentStacks.length}`
    );
  }

  const contentStackEl = contentStacks[0];
  const emptyScrollPosition =
    root.getAttribute("data-empty-scroll-position") === "cases"
      ? "cases"
      : "top";
  const scrollOwnerEl = state === "empty" ? contentStackEl : transcriptEl;
  const shouldScrollToBottom = state === "populated";
  const shouldLandOnCases =
    state === "empty" && emptyScrollPosition === "cases";
  const mobileSafeInset = innerWidth < 600 ? 24 : 0;

  if (shouldScrollToBottom) {
    scrollOwnerEl.scrollTop = Math.max(
      0,
      scrollOwnerEl.scrollHeight - scrollOwnerEl.clientHeight - mobileSafeInset
    );
  } else if (shouldLandOnCases) {
    const landingSelector =
      innerWidth >= 390 && innerWidth < 600
        ? '[data-testid="chat-composer"]'
        : '[data-testid="chat-cases"]';
    const casesLandingEl = root.querySelector?.(landingSelector);
    const ownerTop = scrollOwnerEl.getBoundingClientRect().top;
    const casesTop = casesLandingEl?.getBoundingClientRect().top ?? ownerTop;
    const landingInset = innerWidth < 600 ? 8 : 16;
    scrollOwnerEl.scrollTop = Math.max(
      0,
      scrollOwnerEl.scrollTop + casesTop - ownerTop - landingInset
    );
  } else {
    scrollOwnerEl.scrollTop = 0;
  }
  await frame();
  await frame();

  const ownerScrollTop = scrollOwnerEl.scrollTop;
  const ownerScrollHeight = scrollOwnerEl.scrollHeight;
  const ownerClientHeight = scrollOwnerEl.clientHeight;
  const ownerClientWidth = scrollOwnerEl.clientWidth;
  const ownerScrollWidth = scrollOwnerEl.scrollWidth;
  const ownerAtBottom =
    ownerScrollHeight - ownerClientHeight - ownerScrollTop <=
      Math.max(1, mobileSafeInset) || ownerScrollHeight <= ownerClientHeight;
  const ownerAtTop = ownerScrollTop <= 1;

  const scrollTop = transcriptEl.scrollTop;
  const scrollHeight = transcriptEl.scrollHeight;
  const clientHeight = transcriptEl.clientHeight;
  const clientWidth = transcriptEl.clientWidth;
  const scrollWidth = transcriptEl.scrollWidth;
  const atBottom =
    scrollHeight - clientHeight - scrollTop <= Math.max(1, mobileSafeInset) ||
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
  const preferenceNodes = document.querySelectorAll(
    '[data-testid="chat-header-preferences"]'
  );
  const quickSelectNodes = root.querySelectorAll(
    '[data-testid="chat-agent-quick-select"]'
  );
  const caseRegions = root.querySelectorAll('[data-testid="chat-cases"]');
  const caseLinks = root.querySelectorAll('[data-testid="chat-case-link"]');
  const lastCase =
    caseLinks.length > 0 ? caseLinks[caseLinks.length - 1] : null;
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
      ? measureRect(
          composerNodes[0].querySelector?.(".chat-composer-surface") ||
            composerNodes[0]
        )
      : { ...measureRect(null), count: composerNodes.length };
  const lastMessage = lastRow
    ? { present: true, ...measureRect(lastRow) }
    : { present: false };
  const headerPreferences =
    preferenceNodes.length === 1
      ? measureRect(preferenceNodes[0])
      : { ...measureRect(null), count: preferenceNodes.length };
  const lastCaseRect = lastCase
    ? { present: true, ...measureRect(lastCase) }
    : { present: false };
  const rootRect = measureRect(root);
  const transcriptRect = measureRect(transcriptEl);

  const drawerState = root.getAttribute("data-sidebar-drawer-state");
  const isMobileViewport = innerWidth < MOBILE_BREAKPOINT;
  const closedMobile = drawerState === "closed";
  const openMobile = drawerState === "open";
  const desktopState = drawerState === "not-mobile" || drawerState == null;
  const mainSurface = root.querySelector?.(".phy-adaptive-shell__main");
  const drawerSurface = root.querySelector?.(
    ".phy-adaptive-sidebar.is-drawer-open .phy-adaptive-sidebar__surface"
  );
  const drawerScrim = root.querySelector?.(
    ".phy-adaptive-sidebar.is-drawer-open .phy-adaptive-sidebar__scrim"
  );
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

  if (composerNodes.length !== 1 || (!composer.visible && !openMobile)) {
    reasons.push("composer missing or not visible");
  } else if (
    !openMobile &&
    (state === "populated" || emptyScrollPosition === "top") &&
    !isInsideViewport(composer)
  ) {
    reasons.push("composer escapes viewport in the reviewed state");
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
  if (shouldScrollToBottom && !ownerAtBottom) {
    reasons.push("active scroll owner is not at bottom");
  }
  if (!shouldScrollToBottom && !shouldLandOnCases && !ownerAtTop) {
    reasons.push("empty landing top fixture is not at top");
  }
  if (ownerScrollWidth > ownerClientWidth) {
    reasons.push(
      `content stack overflow scrollWidth=${ownerScrollWidth} > clientWidth=${ownerClientWidth}`
    );
  }

  if (state === "empty") {
    if (caseRegions.length !== 1 || caseLinks.length !== 7) {
      reasons.push(
        `empty state requires one Cases region with seven links; found regions=${caseRegions.length} links=${caseLinks.length}`
      );
    }
    const expectedQuickSelectCount =
      state === "empty" && chatMode === "instant" ? 1 : 0;
    if (quickSelectNodes.length !== expectedQuickSelectCount) {
      reasons.push(
        `state=${state} mode=${chatMode} requires ${expectedQuickSelectCount} quick selection regions; found ${quickSelectNodes.length}`
      );
    }
    if (emptyScrollPosition === "cases" && !isVisibleInViewport(lastCaseRect)) {
      reasons.push("empty Cases fixture final case is not visible");
    }
  } else {
    if (caseRegions.length !== 0 || caseLinks.length !== 0) {
      reasons.push("populated state must not render Cases");
    }
    if (quickSelectNodes.length !== 0) {
      reasons.push("populated state must not render quick selection");
    }
  }

  if (preferenceNodes.length !== 1) {
    reasons.push(
      `expected one Chat header preference group; found ${preferenceNodes.length}`
    );
  } else if (!openMobile && !isVisibleInViewport(headerPreferences)) {
    reasons.push("Chat header preferences escape the viewport");
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

  if (openMobile) {
    if (mainSurface?.getAttribute("aria-hidden") !== "true") {
      reasons.push("open mobile requires hidden main surface");
    }
    if (!drawerSurface || !isVisibleInViewport(measureRect(drawerSurface))) {
      reasons.push("open mobile requires visible drawer surface");
    }
    if (!drawerScrim || !isVisibleInViewport(measureRect(drawerScrim))) {
      reasons.push("open mobile requires visible drawer scrim");
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
    contentStack: measureRect(contentStackEl),
    scrollOwner: {
      kind: state === "empty" ? "content-stack" : "transcript",
      scrollTop: ownerScrollTop,
      scrollHeight: ownerScrollHeight,
      clientHeight: ownerClientHeight,
      clientWidth: ownerClientWidth,
      scrollWidth: ownerScrollWidth,
      atTop: ownerAtTop,
      atBottom: ownerAtBottom,
    },
    emptyScrollPosition,
    headerPreferences,
    quickSelectCount: quickSelectNodes.length,
    caseRegionCount: caseRegions.length,
    caseLinkCount: caseLinks.length,
    lastCase: lastCaseRect,
    primaryAction,
    navigationTrigger,
    composer,
    mainSurfaceHidden: mainSurface?.getAttribute("aria-hidden") === "true",
    drawerSurface: measureRect(drawerSurface),
    drawerScrim: measureRect(drawerScrim),
    lastMessage,
    state,
    chatMode,
    drawerState,
    pass: reasons.length === 0,
    ...(reasons.length ? { reasons } : {}),
  };

  window[GEOMETRY_KEY] = result;
  return result;
})();
