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
    "GeneNetworkAgent.jpg",
    "BriefReviewAgent.jpg",
    "DeepGenomeAgent.jpg",
    "DigitalDesignAgent.jpg",
  ];
  const images = [...root.querySelectorAll(".chat-case-icon img")];
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
    const scientific = [...root.querySelectorAll("em")].find(
      (node) => node.textContent?.trim() === "In Silico"
    );
    if (!scientific) fail("formatted In Silico product label missing");
  }

  if (failures.length) throw new Error(failures.join(" | "));
  return {
    pass: true,
    activeItem,
    chatMode,
    selectedCount: selectedRows.length,
    caseImageCount: images.length,
  };
})();
