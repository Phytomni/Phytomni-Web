(() => {
  const root = document.querySelector('[data-testid="chat-visual-root"]');
  if (!root) throw new Error("chat visual root missing");

  const allowed = new Set([
    "queued",
    "uploading",
    "paused",
    "failed",
    "completed",
  ]);
  const status = root.dataset.uploadStatus;
  const failures = [];
  const fail = (message) => failures.push(message);
  if (!allowed.has(status)) {
    fail("unknown upload fixture status: " + String(status));
  }

  const card = root.querySelector('[data-testid="chat-upload-card"]');
  if (!card) {
    fail("upload card is missing");
  } else {
    if (card.dataset.uploadStatus !== status) {
      fail("upload card status does not match the fixture root");
    }
    const cardRect = card.getBoundingClientRect();
    if (cardRect.left < -0.5 || cardRect.right > innerWidth + 0.5) {
      fail("upload card overflows the viewport horizontally");
    }
    const cardStyle = getComputedStyle(card);
    if (parseFloat(cardStyle.borderTopLeftRadius) <= 0) {
      fail("upload card lost its tokenized radius");
    }
    const name = card.querySelector('[data-testid="chat-upload-name"]');
    if (!name || !name.textContent?.trim()) {
      fail("upload card has no non-empty file label");
    }
    const progress = card.querySelector('[data-testid="chat-upload-progress"]');
    const progressNow = Number(progress?.getAttribute("aria-valuenow"));
    if (
      !progress ||
      progress.getAttribute("role") !== "progressbar" ||
      !Number.isFinite(progressNow) ||
      progressNow < 0 ||
      progressNow > 100
    ) {
      fail("upload progress semantics are invalid");
    }

    const actionIds = {
      pause: '[data-testid="chat-upload-pause"]',
      resume: '[data-testid="chat-upload-resume"]',
      retry: '[data-testid="chat-upload-retry"]',
      cancel: '[data-testid="chat-upload-cancel"]',
      remove: '[data-testid="chat-upload-remove"]',
    };
    const visible = (selector) => Boolean(card.querySelector(selector));
    const expected =
      {
        queued: ["cancel", "remove"],
        uploading: ["pause", "cancel", "remove"],
        paused: ["resume", "cancel", "remove"],
        failed: ["retry", "cancel", "remove"],
        completed: ["remove"],
      }[status] || [];
    for (const [name, selector] of Object.entries(actionIds)) {
      if (visible(selector) !== expected.includes(name)) {
        fail("unexpected " + name + " action for " + status + " upload");
      }
    }
    for (const button of card.querySelectorAll("button")) {
      const rect = button.getBoundingClientRect();
      if (rect.left < -0.5 || rect.right > innerWidth + 0.5) {
        fail("upload action overflows the viewport");
      }
      if (button.getAttribute("type") !== "button") {
        fail("upload action is missing type=button");
      }
      if (!button.getAttribute("aria-label")) {
        fail("upload action is missing an accessible label");
      }
    }
  }

  if (failures.length) throw new Error(failures.join(" | "));
  return { pass: true, status };
})();
