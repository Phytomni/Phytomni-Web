(() => {
  const root = document.querySelector('[data-testid="chat-visual-root"]');
  if (!root) throw new Error("chat visual root missing");

  const failures = [];
  const fail = (message) => failures.push(message);
  const resolveColor = (value) => {
    const probe = document.createElement("span");
    probe.style.color = value;
    document.body.appendChild(probe);
    const result = getComputedStyle(probe).color;
    probe.remove();
    return result;
  };
  const token = (name) =>
    resolveColor(
      getComputedStyle(document.documentElement).getPropertyValue(name).trim()
    );

  const activeItem = root.dataset.activeSidebarItem;
  const chatMode = root.dataset.chatMode;
  const selectedRows = root.querySelectorAll(".sidebar-nav-row.is-active");
  if (selectedRows.length !== 1) {
    fail("expected one selected sidebar row, found " + selectedRows.length);
  }

  const selectedRow = selectedRows[0];
  const selectedStyle = selectedRow ? getComputedStyle(selectedRow) : null;
  const primarySoft = token("--phy-color-primary-soft");
  const elevatedBackground = token("--phy-color-bg-elevated");
  const actionText = token("--phy-color-action-text");
  if (selectedStyle?.backgroundColor !== primarySoft) {
    fail("selected sidebar background is not primary-soft");
  }
  if (selectedStyle?.color !== actionText) {
    fail("selected sidebar text is not action-text");
  }
  if (selectedRow?.getAttribute("aria-current") !== "page") {
    fail("selected sidebar row lacks aria-current=page");
  }
  if (
    selectedRow &&
    parseFloat(selectedStyle.borderTopLeftRadius) <
      selectedRow.getBoundingClientRect().height / 2
  ) {
    fail("selected sidebar row is not a complete pill");
  }

  const expectedSelected = {
    "new-chat": '[data-test="sidebar-nav-new-chat"]',
    "explore-agent": '[data-test="sidebar-nav-explore-agent"]',
    "knowledge-base": '[data-test="sidebar-nav-gene-display"]',
    favorites: '[data-test="sidebar-nav-favorites"]',
  }[activeItem];
  if (!expectedSelected || !selectedRow?.matches(expectedSelected)) {
    fail("selected sidebar DOM row does not match fixture state");
  }

  const startNew = root.querySelector('[data-test="sidebar-nav-new-chat"]');
  if (
    activeItem === "explore-agent" &&
    startNew &&
    getComputedStyle(startNew).backgroundColor !== resolveColor("transparent")
  ) {
    fail("inactive Start New retains a visible fill");
  }

  const exploreAgentsList = root.querySelector(
    '[data-testid="chat-explore-agents-list"]'
  );
  const exploreButton = root.querySelector(
    '[data-test="sidebar-nav-explore-agent"]'
  );
  const exploreAgentOptions =
    exploreAgentsList?.querySelectorAll(".agent-option");
  if (activeItem === "explore-agent") {
    if (exploreButton?.getAttribute("aria-expanded") !== "true") {
      fail("Explore Agents selection lacks aria-expanded=true");
    }
    if (!exploreAgentsList || exploreAgentOptions?.length !== 8) {
      fail(
        "Explore Agents selection must reveal eight expandable agent options"
      );
    }
  } else {
    if (exploreButton?.getAttribute("aria-expanded") !== "false") {
      fail("inactive Explore Agents row lacks aria-expanded=false");
    }
    if (exploreAgentsList) {
      fail(
        "Explore Agents list is visible while another sidebar item is active"
      );
    }
  }

  const modeGroup = root.querySelector(".chat-mode-selector .el-radio-group");
  if (
    modeGroup &&
    getComputedStyle(modeGroup).backgroundColor !==
      token("--phy-color-fill-subtle")
  ) {
    fail("mode group background is not fill-subtle");
  }
  const activeMode = root.querySelector(
    ".chat-mode-selector .el-radio-button.is-active .el-radio-button__inner"
  );
  if (!activeMode) {
    fail("active mode segment missing");
  } else {
    const style = getComputedStyle(activeMode);
    if (style.backgroundColor !== primarySoft) {
      fail("active mode background is not primary-soft");
    }
    if (style.color !== actionText) {
      fail("active mode text is not action-text");
    }
    const value = activeMode.previousElementSibling?.getAttribute("value");
    if (value !== chatMode) {
      fail("active mode DOM value does not match fixture mode");
    }
  }

  const quickOptions = [
    ...root.querySelectorAll('[data-testid="chat-agent-quick-option"]'),
  ];
  const chatState = root.dataset.chatState;
  if (
    chatState === "empty" &&
    chatMode === "expert" &&
    quickOptions.length === 0
  ) {
    fail("Expert empty state is missing quick-select buttons");
  }
  for (const option of quickOptions) {
    const style = getComputedStyle(option);
    const rect = option.getBoundingClientRect();
    if (parseFloat(style.borderTopLeftRadius) < rect.height / 2) {
      fail("quick-select trigger is not pill-shaped");
    }
    if (parseFloat(style.borderTopWidth) < 1) {
      fail("quick-select trigger lost its tokenized border");
    }
    const selected = option.getAttribute("aria-pressed") === "true";
    const expectedBackground = selected ? primarySoft : elevatedBackground;
    if (style.backgroundColor !== expectedBackground) {
      fail(
        selected
          ? "selected quick-select background is not primary-soft"
          : "quick-select background is not elevated"
      );
    }
  }

  const headerInner = root.querySelector(".chat-header-inner");
  const chatMain = root.querySelector(".chat-main");
  if (!headerInner || !chatMain) {
    fail("header geometry nodes missing");
  } else {
    const inner = headerInner.getBoundingClientRect();
    const main = chatMain.getBoundingClientRect();
    const left = inner.left - main.left;
    const right = main.right - inner.right;
    if (left < 0 || left > 33) {
      fail("header left gutter invalid: " + left);
    }
    if (right < 0 || right > 33) {
      fail("header right gutter invalid: " + right);
    }
  }

  const expectedImages = [
    "KnowledgeAgent.jpg",
    "DataAgent.jpg",
    "AnalystAgent.jpg",
    "ReviewAgent.jpg",
    "GeneNetworkAgent.jpg",
    "DeepGenomeAgent.jpg",
    "DigitalDesignAgent.jpg",
  ];
  const images = [...root.querySelectorAll(".chat-case-icon img")];
  const caseLinks = [
    ...root.querySelectorAll('[data-testid="chat-case-link"]'),
  ];
  const monograms = [...root.querySelectorAll(".chat-case-monogram")];
  if (caseLinks.length !== 8) {
    fail("expected eight case links, found " + caseLinks.length);
  }
  if (monograms.length !== 1 || monograms[0]?.textContent?.trim() !== "BG") {
    fail("expected one BG case monogram");
  }
  if (images.length !== 7) {
    fail("expected seven case images, found " + images.length);
  }
  images.forEach((image, index) => {
    if (!image.complete || image.naturalWidth !== 660) {
      fail("case image " + index + " is not a loaded 660px source");
    }
    if (!image.src.endsWith("/agent-icons/" + expectedImages[index])) {
      fail("case image " + index + " has the wrong source");
    }
  });

  if (chatMode === "instant") {
    const renderedInSilico = [...root.querySelectorAll("*")].filter((node) =>
      node.textContent?.includes("In Silico")
    );
    if (renderedInSilico.length > 0) {
      const scientific = renderedInSilico.some((node) =>
        [...node.querySelectorAll("em")].some(
          (em) => em.textContent?.trim() === "In Silico"
        )
      );
      if (!scientific) fail("rendered In Silico label is not semantic");
    }
  }

  if (failures.length) throw new Error(failures.join(" | "));
  return {
    pass: true,
    activeItem,
    chatMode,
    selectedCount: selectedRows.length,
    caseLinkCount: caseLinks.length,
    caseImageCount: images.length,
    caseMonogramCount: monograms.length,
  };
})();
