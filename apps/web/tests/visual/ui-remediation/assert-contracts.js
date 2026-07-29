(() => {
  const root = document.querySelector(
    '[data-testid="ui-remediation-visual-root"]'
  );
  const state = root?.dataset.fixtureState || "invalid";
  const counts = {
    controls: 0,
    headings: 0,
    links: 0,
    images: 0,
    monograms: 0,
    columns: 0,
    dialogs: 0,
  };
  const fail = (message) => {
    throw new Error(`ui-remediation contract: ${message}`);
  };
  if (!root || document.documentElement.scrollWidth > window.innerWidth)
    fail("horizontal overflow");
  if (state === "change-password") {
    const controls = [
      ...document.querySelectorAll(".change-password-form input"),
    ];
    counts.controls = controls.length;
    const labels = document.querySelectorAll(
      ".change-password-form .el-form-item__label"
    );
    if (
      controls.length !== 4 ||
      labels.length !== 4 ||
      !document.body.textContent.includes("researcher@example.test")
    )
      fail("password controls");
    const lefts = controls.map((control) =>
      Math.round(control.getBoundingClientRect().left)
    );
    if (new Set(lefts).size !== 1) fail("password alignment");
  } else if (state === "markdown") {
    const headings = [...document.querySelectorAll("h4")];
    counts.headings = headings.length;
    if (
      headings.length !== 1 ||
      headings[0].textContent?.trim() !== "1. 基因定位与靶点设计"
    )
      fail("markdown heading");
  } else if (state === "review" || state === "brief-gene") {
    counts.headings = document.querySelectorAll(".agent-demo-shell").length;
    if (
      counts.headings !== 1 ||
      document.querySelectorAll(".cited-answer").length < 1
    )
      fail("agent demo");
  } else if (state === "cases") {
    counts.links = document.querySelectorAll(
      '[data-testid="chat-case-link"]'
    ).length;
    counts.images = document.querySelectorAll(".chat-case-icon img").length;
    counts.monograms = [
      ...document.querySelectorAll(".chat-case-monogram"),
    ].filter((node) => node.textContent?.trim() === "BG").length;
    counts.columns = getComputedStyle(
      document.querySelector(".chat-cases-grid")
    ).gridTemplateColumns.split(" ").length;
    const expected =
      window.innerWidth >= 1280 ? 4 : window.innerWidth >= 600 ? 2 : 1;
    if (
      counts.links !== 8 ||
      counts.images !== 7 ||
      counts.monograms !== 1 ||
      counts.columns !== expected
    )
      fail("case grid");
  } else if (state.endsWith("preview")) {
    counts.dialogs = document.querySelectorAll('[role="dialog"]').length;
    const images = [...document.querySelectorAll('[role="dialog"] img')];
    counts.images = images.length;
    if (counts.dialogs !== 1) fail("preview dialog");
    if (
      state === "review-preview" &&
      (images.length !== 1 ||
        !images[0].src.endsWith("ReviewAgent.png") ||
        !images[0].complete ||
        !images[0].naturalWidth)
    )
      fail("review media");
    if (state === "brief-gene-preview" && images.length !== 0)
      fail("brief gene media");
  }
  return { pass: true, state, counts };
})();
