import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { resolve, join } from "node:path";
import { runInNewContext } from "node:vm";
import { flushPromises } from "@vue/test-utils";
import { nextTick } from "vue";
import {
  CHAT_VISUAL_FIXTURE_KEYS,
  CHAT_VISUAL_LOCALES,
  CHAT_VISUAL_THEMES,
  resolveChatVisualFixture,
  getChatVisualFixture,
  getChatRoutingFixture,
  routingFixtures,
} from "../../../visual/chat/fixture-registry";
import {
  SYNTHETIC_IDENTITY,
  buildSyntheticMessages,
  buildSyntheticFileList,
  buildHarnessMessages,
  getSharedMessageFixture,
  getSharedPhase3COverlay,
  buildA2uiLifecycleMessages,
  getAgentLifecycleVisualData,
  COMPOSER_MODEL_VALUE_BY_KEY,
} from "../../../visual/chat/fixture-data";
import {
  PHASE_3B_MESSAGE_KEYS,
  MESSAGE_FIXTURES,
  isPhase3BMessageKey,
  PHASE_3C_FIXTURE_KEYS,
  isPhase3CFixtureKey,
  getPhase3COverlay,
} from "../../../fixtures/chat";
import zhCN from "@/locales/langs/zh-CN";
import { createTestAppContext } from "../../../helpers/test-app-context";

const WEB_ROOT = resolve(__dirname, "../../../..");
const SRC_ROOT = resolve(WEB_ROOT, "src");
const VISUAL_CHAT = resolve(WEB_ROOT, "tests/visual/chat");
const MAIN_SOURCE = readFileSync(resolve(VISUAL_CHAT, "main.ts"), "utf8");
const APP_SOURCE = readFileSync(
  resolve(VISUAL_CHAT, "ChatVisualFixtureApp.vue"),
  "utf8"
);
const CONTENT_SOURCE = readFileSync(
  resolve(SRC_ROOT, "views/chat/components/ChatMessageContent.vue"),
  "utf8"
);
const MEASURE_SOURCE = readFileSync(
  resolve(VISUAL_CHAT, "measure-geometry.js"),
  "utf8"
);
const ASSERT_GEOMETRY_SOURCE = readFileSync(
  resolve(VISUAL_CHAT, "assert-geometry.js"),
  "utf8"
);
const REDACT_SOURCE = readFileSync(
  resolve(VISUAL_CHAT, "redact-identity.js"),
  "utf8"
);
const ASSERT_PATH_SOURCE = readFileSync(
  resolve(VISUAL_CHAT, "assert-chat-path.js"),
  "utf8"
);
const REFINEMENT_ASSERT_SOURCE = readFileSync(
  resolve(VISUAL_CHAT, "assert-refinement-styles.js"),
  "utf8"
);
const REFINEMENT_CAPTURE_SOURCE = readFileSync(
  resolve(VISUAL_CHAT, "capture-refinement-matrix.sh"),
  "utf8"
);
const UPLOAD_ASSERT_SOURCE = readFileSync(
  resolve(VISUAL_CHAT, "assert-upload-styles.js"),
  "utf8"
);

type GeometryResult = {
  pass: boolean;
  chatMode?: string | null;
  composer?: { bottom: number };
  attachmentStrip?: Rect;
  composerEditor?: Rect;
  attachmentDetail?: Rect;
  error?: string;
  reasons?: string[];
};

type Rect = {
  top: number;
  right: number;
  bottom: number;
  left: number;
  width: number;
  height: number;
};

type GeometryHarnessOptions = {
  state?: "empty" | "populated";
  chatMode?: "instant" | "expert";
  chatModeOverride?: string;
  emptyScrollPosition?: "top" | "cases";
  includeCases?: boolean;
  includeQuickSelect?: boolean;
  width?: number;
  height?: number;
  documentScrollWidth?: number;
  transcriptClientWidth?: number;
  transcriptScrollWidth?: number;
  transcriptRect?: Rect;
  composerRect?: Rect;
  composerSurfaceRect?: Rect;
  lastMessageRect?: Rect;
  lastCaseRect?: Rect;
  contentStackClientHeight?: number;
  contentStackScrollHeight?: number;
  drawerState?: "closed" | "open" | "not-mobile";
  includeTranscript?: boolean;
  includeContentStack?: boolean;
  includeTrigger?: boolean;
  includePrimary?: boolean;
  includeComposer?: boolean;
  triggerVisible?: boolean;
  primaryVisible?: boolean;
  composerVisible?: boolean;
  includeAttachmentStrip?: boolean;
  attachmentStripRect?: Rect;
  includeAttachmentDetail?: boolean;
  attachmentDetailRect?: Rect;
  composerEditorRect?: Rect;
};

const rect = (
  left: number,
  top: number,
  right: number,
  bottom: number
): Rect => ({
  top,
  right,
  bottom,
  left,
  width: right - left,
  height: bottom - top,
});

async function runGeometryHarness(
  options: GeometryHarnessOptions = {}
): Promise<GeometryResult> {
  const width = options.width ?? 1440;
  const height = options.height ?? 900;
  const drawerState = options.drawerState ?? "not-mobile";
  const state = options.state ?? "populated";
  const chatMode = options.chatModeOverride ?? options.chatMode ?? "instant";
  const emptyScrollPosition = options.emptyScrollPosition ?? "top";
  const includeCases = options.includeCases ?? state === "empty";
  const includeQuickSelect =
    options.includeQuickSelect ?? (state === "empty" && chatMode === "expert");
  const makeElement = (bounds: Rect, visible = true) => ({
    __visible: visible,
    getBoundingClientRect: () => bounds,
  });

  const transcript = Object.assign(
    makeElement(options.transcriptRect ?? rect(280, 48, width, 720)),
    {
      scrollHeight: 1200,
      clientHeight: 672,
      clientWidth: options.transcriptClientWidth ?? Math.max(1, width - 280),
      scrollWidth: options.transcriptScrollWidth ?? Math.max(1, width - 280),
    }
  );
  let transcriptScrollTop = 0;
  Object.defineProperty(transcript, "scrollTop", {
    configurable: true,
    get: () => transcriptScrollTop,
    set: (value: number) => {
      transcriptScrollTop = Math.max(
        0,
        Math.min(value, transcript.scrollHeight - transcript.clientHeight)
      );
    },
  });

  const contentStack = Object.assign(makeElement(rect(0, 48, width, height)), {
    scrollHeight: options.contentStackScrollHeight ?? 1200,
    clientHeight: options.contentStackClientHeight ?? Math.max(1, height - 48),
    clientWidth: width,
    scrollWidth: width,
  });
  let contentStackScrollTop = 0;
  Object.defineProperty(contentStack, "scrollTop", {
    configurable: true,
    get: () => contentStackScrollTop,
    set: (value: number) => {
      contentStackScrollTop = Math.max(
        0,
        Math.min(value, contentStack.scrollHeight - contentStack.clientHeight)
      );
    },
  });

  const lastMessage = makeElement(
    options.lastMessageRect ?? rect(360, 620, Math.min(width - 40, 1080), 700)
  );
  const casesRegion = makeElement(rect(240, 560, width - 24, 840));
  const caseLinks = Array.from({ length: 8 }, (_value, index) =>
    makeElement(
      index === 7
        ? (options.lastCaseRect ?? rect(280, 720, width - 40, 800))
        : rect(280, 560 + index * 20, width - 40, 600 + index * 20)
    )
  );
  const quickSelect = makeElement(rect(280, 500, width - 40, 548));
  const headerPreferences = makeElement(rect(width - 180, 8, width - 16, 40));
  const mainSurface = {
    getAttribute: (name: string) =>
      name === "aria-hidden" && drawerState === "open" ? "true" : null,
  };
  const drawerSurface = makeElement(rect(0, 0, Math.min(width, 272), height));
  const drawerScrim = makeElement(rect(0, 0, width, height));
  const root = Object.assign(makeElement(rect(0, 0, width, height)), {
    getAttribute: (name: string) => {
      if (name === "data-chat-state") return state;
      if (name === "data-sidebar-drawer-state") return drawerState;
      if (name === "data-empty-scroll-position") return emptyScrollPosition;
      if (name === "data-chat-mode") return chatMode;
      return null;
    },
    querySelectorAll: (selector: string) => {
      if (selector === '[data-testid="chat-transcript"]') {
        return options.includeTranscript === false ? [] : [transcript];
      }
      if (selector === '[data-testid="chat-content-stack"]') {
        return options.includeContentStack === false ? [] : [contentStack];
      }
      if (selector === '[data-testid="chat-message-row"]') {
        return state === "populated" ? [lastMessage] : [];
      }
      if (selector === '[data-testid="chat-cases"]') {
        return includeCases ? [casesRegion] : [];
      }
      if (selector === '[data-testid="chat-case-link"]') {
        return includeCases ? caseLinks : [];
      }
      if (selector === '[data-testid="chat-agent-quick-select"]') {
        return includeQuickSelect ? [quickSelect] : [];
      }
      return [];
    },
    querySelector: (selector: string) => {
      if (selector === '[data-testid="chat-cases"]') {
        return includeCases ? casesRegion : null;
      }
      if (selector === '[data-testid="chat-composer"]') return composer;
      if (selector === '[data-testid="attachment-chip-strip"]') {
        return options.includeAttachmentStrip === true ? attachmentStrip : null;
      }
      if (selector === '[data-testid="attachment-chip-detail"]') {
        return options.includeAttachmentDetail === true
          ? attachmentDetail
          : null;
      }
      if (selector === ".chat-composer-body") return composerEditor;
      if (selector === ".phy-adaptive-shell__main") return mainSurface;
      if (
        selector ===
        ".phy-adaptive-sidebar.is-drawer-open .phy-adaptive-sidebar__surface"
      ) {
        return drawerState === "open" ? drawerSurface : null;
      }
      if (
        selector ===
        ".phy-adaptive-sidebar.is-drawer-open .phy-adaptive-sidebar__scrim"
      ) {
        return drawerState === "open" ? drawerScrim : null;
      }
      return null;
    },
  });

  const primary = makeElement(
    drawerState === "closed"
      ? rect(-260, 80, -20, 120)
      : rect(16, 80, 240, 120),
    options.primaryVisible ?? true
  );
  const trigger = makeElement(
    rect(12, 10, 52, 50),
    options.triggerVisible ?? true
  );
  const composer = makeElement(
    options.composerRect ??
      rect(Math.min(300, width / 4), 740, width - 24, 880),
    options.composerVisible ?? true
  );
  const composerSurface = makeElement(
    options.composerSurfaceRect ??
      options.composerRect ??
      rect(Math.min(300, width / 4), 740, width - 24, 880),
    options.composerVisible ?? true
  );
  const attachmentStrip = makeElement(
    options.attachmentStripRect ?? rect(300, 700, width - 24, 744)
  );
  const attachmentDetail = makeElement(
    options.attachmentDetailRect ?? rect(300, 520, width - 24, 692)
  );
  const composerEditor = makeElement(
    options.composerEditorRect ?? rect(300, 744, width - 24, 816)
  );
  if (options.composerSurfaceRect) {
    Object.assign(composer, {
      querySelector: (selector: string) =>
        selector === ".chat-composer-surface" ? composerSurface : null,
    });
  }
  const includeTrigger = options.includeTrigger ?? drawerState === "closed";
  const documentMock = {
    documentElement: {
      scrollWidth: options.documentScrollWidth ?? width,
      clientWidth: width,
      scrollHeight: height,
    },
    querySelectorAll: (selector: string) => {
      if (
        selector ===
        '[data-testid="chat-root"], [data-testid="chat-visual-root"]'
      ) {
        return [root];
      }
      if (selector === '[data-testid="chat-primary-action"]') {
        return options.includePrimary === false ? [] : [primary];
      }
      if (selector === '[data-testid="chat-sidebar-trigger"]') {
        return includeTrigger ? [trigger] : [];
      }
      if (selector === '[data-testid="chat-composer"]') {
        return options.includeComposer === false ? [] : [composer];
      }
      if (selector === '[data-testid="chat-header-preferences"]') {
        return [headerPreferences];
      }
      return [];
    },
  };
  const windowMock: Record<string, unknown> = {};

  const result = (await runInNewContext(MEASURE_SOURCE, {
    window: windowMock,
    document: documentMock,
    innerWidth: width,
    innerHeight: height,
    getComputedStyle: (element: { __visible?: boolean }) => ({
      display: "block",
      visibility: "visible",
      opacity: element.__visible === false ? "0" : "1",
    }),
    requestAnimationFrame: (callback: () => void) => {
      callback();
      return 1;
    },
  })) as GeometryResult;

  const isInsideViewport = (bounds: Rect): boolean =>
    bounds.left >= 0 &&
    bounds.top >= 0 &&
    bounds.right <= width &&
    bounds.bottom <= height;
  const fixtureReasons: string[] = [];
  if (options.includeAttachmentStrip === true) {
    if (
      !isInsideViewport(
        options.attachmentStripRect ?? attachmentStrip.getBoundingClientRect()
      )
    ) {
      fixtureReasons.push("attachment chip strip escapes viewport");
    }
    if (
      !isInsideViewport(
        options.composerEditorRect ?? composerEditor.getBoundingClientRect()
      )
    ) {
      fixtureReasons.push("composer editor escapes viewport");
    }
  }
  if (
    options.includeAttachmentDetail === true &&
    !isInsideViewport(
      options.attachmentDetailRect ?? attachmentDetail.getBoundingClientRect()
    )
  ) {
    fixtureReasons.push("attachment detail escapes viewport");
  }
  return {
    ...result,
    attachmentStrip:
      options.includeAttachmentStrip === true
        ? (options.attachmentStripRect ??
          attachmentStrip.getBoundingClientRect())
        : undefined,
    composerEditor:
      options.includeAttachmentStrip === true
        ? (options.composerEditorRect ?? composerEditor.getBoundingClientRect())
        : undefined,
    attachmentDetail:
      options.includeAttachmentDetail === true
        ? (options.attachmentDetailRect ??
          attachmentDetail.getBoundingClientRect())
        : undefined,
    pass: result.pass && fixtureReasons.length === 0,
    ...(fixtureReasons.length
      ? { reasons: [...(result.reasons ?? []), ...fixtureReasons] }
      : {}),
  };
}

vi.mock("vue-element-plus-x", () => ({
  MentionSender: {
    name: "MentionSender",
    inheritAttrs: false,
    template:
      '<div class="mention-sender-stub" v-bind="$attrs"><textarea data-testid="mention-input" :disabled="disabled" :value="modelValue" /><slot name="header" /><slot name="prefix" /><slot name="action-list" /></div>',
    props: [
      "modelValue",
      "loading",
      "disabled",
      "options",
      "placeholder",
      "autoSize",
      "clearable",
      "variant",
      "triggerStrings",
      "triggerSplit",
      "whole",
      "submitType",
      "allowSpeech",
    ],
    emits: ["update:modelValue", "submit", "select", "search"],
    setup(
      _props: unknown,
      { expose }: { expose: (exposed: Record<string, unknown>) => void }
    ) {
      expose({
        openHeader: vi.fn(),
        closeHeader: vi.fn(),
        popoverVisible: false,
      });
      return {};
    },
  },
  FilesCard: {
    name: "FilesCard",
    template: '<div class="files-card-stub" />',
    props: ["uid", "name", "fileSize", "showDelIcon"],
  },
  Typewriter: { name: "Typewriter", template: "<div></div>" },
}));

import ChatVisualFixtureApp from "../../../visual/chat/ChatVisualFixtureApp.vue";

function walkFiles(dir: string, acc: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) {
      walkFiles(full, acc);
    } else if (/\.(ts|tsx|vue|js|mjs|cjs)$/.test(name)) {
      acc.push(full);
    }
  }
  return acc;
}

describe("Chat visual fixture registry", () => {
  it("contains every exact frame, Phase 3B message-state, and Phase 3C key", () => {
    expect([...CHAT_VISUAL_FIXTURE_KEYS]).toEqual([
      "instant-empty",
      "expert-auto-empty",
      "expert-selected-empty",
      "expert-selected-populated",
      "empty",
      "empty-cases",
      "populated",
      "attachment",
      "upload-queued",
      "upload-uploading",
      "upload-paused",
      "upload-failed",
      "upload-completed",
      "uploading-detail-open",
      "mixed-ready-failed-expired",
      "ten-files-overflow",
      "incompatible-agent-blocked",
      "sending",
      "picker-open",
      "picker-search",
      "picker-selected",
      "sidebar-expanded",
      "sidebar-compact",
      "sidebar-mobile-closed",
      "sidebar-mobile-open",
      "agent-preview",
      "sidebar-compact-explore-open",
      "history-title-only",
      "history-loading",
      "history-empty",
      "history-error",
      "short-generic",
      "long-generic",
      "cited",
      "deep-genome",
      "table",
      "steps",
      "image",
      "streaming",
      "interleaved-streaming",
      "activity-closed",
      "activity-open",
      "log-loading",
      "log-populated",
      "log-error",
      "log-missing-task",
      "progress-fast",
      "progress-slow",
      "progress-completing",
      "transfer-real",
      "a2ui-required",
      "a2ui-lifecycle",
      "send-stop",
      "parallel-a",
      "parallel-b",
    ]);
  });

  it("rejects unknown state, locale, and theme without silent defaults", () => {
    expect(resolveChatVisualFixture("nope", "en-US", "light").ok).toBe(false);
    expect(resolveChatVisualFixture("empty", "fr-FR", "light").ok).toBe(false);
    expect(resolveChatVisualFixture("empty", "en-US", "system").ok).toBe(false);
    expect(resolveChatVisualFixture(null, "en-US", "light").ok).toBe(false);
  });

  it("accepts every exact locale and theme pair for every state", () => {
    for (const key of CHAT_VISUAL_FIXTURE_KEYS) {
      for (const locale of CHAT_VISUAL_LOCALES) {
        for (const theme of CHAT_VISUAL_THEMES) {
          const resolved = resolveChatVisualFixture(key, locale, theme);
          expect(resolved.ok).toBe(true);
          if (resolved.ok) {
            expect(resolved.fixture.key).toBe(key);
            expect(resolved.locale).toBe(locale);
            expect(resolved.theme).toBe(theme);
          }
        }
      }
    }
  });

  it("registers all bounded result-archive delivery visual states", () => {
    for (const key of [
      "agent-delivery-pending",
      "agent-delivery-ready",
      "agent-delivery-retryable",
      "agent-delivery-nonretryable",
    ] as const) {
      const fixture = getChatVisualFixture(key);
      const data = getAgentLifecycleVisualData(key);
      expect(fixture.messageCount).toBe(1);
      expect(data.message.content).toContain("Analysis report");
      expect(data.message.content).not.toContain("obs://");
      expect(data.artifactLinks?.length ?? 0).toBeLessThanOrEqual(1);
    }
  });

  it("registers sanitized DeepGenome lifecycle visual states", () => {
    const keys = [
      "deep-genome-preparing",
      "deep-genome-running-partial",
      "deep-genome-succeeded",
    ] as const;
    const forbiddenContent =
      /obs:\/\/|\/home\/|\brun_id\b|OsD18|Oryza sativa|Arabidopsis thaliana|[\w.+-]+@[\w.-]+|password|secret|token|credential/iu;

    for (const key of keys) {
      const resolved = resolveChatVisualFixture(key, "en-US", "light");
      expect(resolved.ok).toBe(true);
      const data = getAgentLifecycleVisualData(key);
      expect(data.message.tool_name).toBe("DeepGenomeAgent");
      expect(data.message.content).not.toMatch(forbiddenContent);
    }

    const preparing = getAgentLifecycleVisualData("deep-genome-preparing");
    expect(preparing.message.content).toBe(
      "Server task created: synthetic-child"
    );

    const partial = getAgentLifecycleVisualData("deep-genome-running-partial");
    expect(partial.message.content).toContain("### Synthetic partial report");
    expect(partial.message.doc_list).toEqual([]);

    const succeeded = getAgentLifecycleVisualData("deep-genome-succeeded");
    expect(succeeded.message.content).toContain("### Synthetic final report");
    expect(succeeded.artifactPreview).toEqual({
      title: "Finished",
      kind: "Deep Genome Agent",
      summary: "Synthetic deep genome report",
      openLabel: "View",
    });
    expect(Object.keys(succeeded.artifactPreview ?? {})).toHaveLength(4);

    for (const file of [
      resolve(VISUAL_CHAT, "fixture-registry.ts"),
      resolve(VISUAL_CHAT, "fixture-data.ts"),
      resolve(VISUAL_CHAT, "ChatVisualFixtureApp.vue"),
    ]) {
      expect(readFileSync(file, "utf8")).not.toMatch(/@\/api\b/);
    }
  });

  it("uses exact Synthetic user identity and empty has zero message rows", () => {
    expect(SYNTHETIC_IDENTITY).toBe("Synthetic user");
    const empty = getChatVisualFixture("empty");
    expect(empty.messageCount).toBe(0);
    expect(buildSyntheticMessages(empty)).toHaveLength(0);
    const populated = getChatVisualFixture("populated");
    expect(populated.messageCount).toBeGreaterThan(0);
    expect(buildSyntheticMessages(populated)).toHaveLength(
      populated.messageCount
    );
  });

  it("registers the sanitized chip-state visual matrix", () => {
    const empty = getChatVisualFixture("empty");
    expect(buildSyntheticFileList(empty)).toHaveLength(0);

    const detail = getChatVisualFixture("uploading-detail-open");
    expect(detail.attachmentDetailOpen).toBe(true);
    const detailItems = buildSyntheticFileList(detail);
    expect(detailItems).toHaveLength(1);
    expect(detailItems[0].status).toBe("uploading");
    expect("purpose" in detailItems[0]).toBe(false);

    const mixed = getChatVisualFixture("mixed-ready-failed-expired");
    expect(buildSyntheticFileList(mixed).map((item) => item.status)).toEqual([
      "completed",
      "failed",
      "expired",
    ]);

    const overflow = getChatVisualFixture("ten-files-overflow");
    const overflowItems = buildSyntheticFileList(overflow);
    expect(overflowItems).toHaveLength(10);
    expect(overflowItems.every((item) => item.status === "completed")).toBe(
      true
    );

    const blocked = getChatVisualFixture("incompatible-agent-blocked");
    expect(blocked.selectedAgent).toBe("DeepGenomeAgent");
    expect(blocked.attachmentTargetBlocked).toBe(true);
    expect(blocked.attachmentTargetAvailable).toBe(false);
    expect(COMPOSER_MODEL_VALUE_BY_KEY[blocked.key]).toBe(
      "Synthetic incompatible attachment draft"
    );

    for (const key of [
      "empty",
      "uploading-detail-open",
      "mixed-ready-failed-expired",
      "ten-files-overflow",
      "incompatible-agent-blocked",
    ] as const) {
      for (const theme of CHAT_VISUAL_THEMES) {
        const resolved = resolveChatVisualFixture(key, "en-US", theme);
        expect(resolved.ok).toBe(true);
        if (resolved.ok) expect(resolved.theme).toBe(theme);
      }
    }
  });

  it("registers deterministic Instant and Expert routing snapshots", () => {
    expect(routingFixtures).toEqual([
      {
        id: "instant-empty",
        mode: "instant",
        selectedAgent: "",
        populated: false,
        permissionsLoading: false,
        allowedTools: ["ChatAgent", "DataAgent", "AnalystAgent"],
      },
      {
        id: "expert-auto-empty",
        mode: "expert",
        selectedAgent: "",
        populated: false,
        permissionsLoading: false,
        allowedTools: ["ChatAgent", "DataAgent", "AnalystAgent"],
      },
      {
        id: "expert-selected-empty",
        mode: "expert",
        selectedAgent: "DataAgent",
        populated: false,
        permissionsLoading: false,
        allowedTools: ["ChatAgent", "DataAgent", "AnalystAgent"],
      },
      {
        id: "expert-selected-populated",
        mode: "expert",
        selectedAgent: "AnalystAgent",
        populated: true,
        permissionsLoading: false,
        allowedTools: ["ChatAgent", "DataAgent", "AnalystAgent"],
      },
      {
        id: "incompatible-agent-blocked",
        mode: "expert",
        selectedAgent: "DeepGenomeAgent",
        populated: false,
        permissionsLoading: false,
        allowedTools: ["ChatAgent", "DeepGenomeAgent"],
      },
    ]);

    for (const routingFixture of routingFixtures) {
      const fixture = getChatVisualFixture(
        routingFixture.id as (typeof CHAT_VISUAL_FIXTURE_KEYS)[number]
      );
      expect(getChatRoutingFixture(routingFixture.id)).toBe(routingFixture);
      expect(fixture.chatState).toBe(
        routingFixture.populated ? "populated" : "empty"
      );
      expect(fixture.selectedAgent).toBe(routingFixture.selectedAgent);
    }
  });

  it("keeps closed/open mobile as distinct registry keys", () => {
    expect(CHAT_VISUAL_FIXTURE_KEYS).toContain("sidebar-mobile-closed");
    expect(CHAT_VISUAL_FIXTURE_KEYS).toContain("sidebar-mobile-open");
    const closed = getChatVisualFixture("sidebar-mobile-closed");
    const open = getChatVisualFixture("sidebar-mobile-open");
    expect(closed.showSidebarTrigger).toBe(true);
    expect(closed.drawerOpen).toBe(false);
    expect(open.drawerOpen).toBe(true);
    expect(open.showSidebarTrigger).toBe(false);
  });

  it("registers deterministic Chat recovery fixtures", () => {
    const recoveryKeys = [
      "agent-preview",
      "sidebar-compact-explore-open",
      "history-title-only",
      "history-loading",
      "history-empty",
      "history-error",
    ] as const;

    for (const key of recoveryKeys) {
      expect(CHAT_VISUAL_FIXTURE_KEYS).toContain(key);
      const fixture = getChatVisualFixture(
        key as (typeof CHAT_VISUAL_FIXTURE_KEYS)[number]
      );
      expect(fixture.key).toBe(key);
    }

    const titleOnly = getChatVisualFixture("history-title-only" as never);
    expect(titleOnly.messageCount).toBe(1);
    expect(buildSyntheticMessages(titleOnly)).toEqual([
      expect.objectContaining({ role: "user" }),
    ]);
    expect(buildSyntheticMessages(titleOnly)).not.toEqual([
      expect.objectContaining({ role: "assistant" }),
    ]);
  });

  it("registers every Phase 3B message key with shared fixture objects", () => {
    for (const key of PHASE_3B_MESSAGE_KEYS) {
      expect(CHAT_VISUAL_FIXTURE_KEYS).toContain(key);
      expect(isPhase3BMessageKey(key)).toBe(true);
      expect(getSharedMessageFixture(key)).toBe(MESSAGE_FIXTURES[key]);
      const fixture = getChatVisualFixture(key);
      expect(fixture.chatState).toBe("populated");
      expect(fixture.messageCount).toBe(2);
      const rows = buildHarnessMessages(fixture);
      expect(rows).toHaveLength(2);
      expect(rows[1]).toBe(MESSAGE_FIXTURES[key]);
    }
  });

  it("registers every Phase 3C key with shared synthetic overlays (no network)", () => {
    for (const key of PHASE_3C_FIXTURE_KEYS) {
      expect(CHAT_VISUAL_FIXTURE_KEYS).toContain(key);
      expect(isPhase3CFixtureKey(key)).toBe(true);
      expect(getSharedPhase3COverlay(key)).toBe(getPhase3COverlay(key));
      const fixture = getChatVisualFixture(key);
      expect(fixture.chatState).toBe("populated");
      expect(fixture.messageCount).toBe(2);
      const overlay = getPhase3COverlay(key);
      expect(overlay.kind).toBeTruthy();
      // Progress and transfer never share the same overlay kind.
      if (overlay.kind === "progress") {
        expect(overlay.transfer).toBeUndefined();
        expect(overlay.progress).toBeTruthy();
      }
      if (overlay.kind === "transfer") {
        expect(overlay.progress).toBeUndefined();
        expect(overlay.transfer).toBeTruthy();
      }
    }
  });

  it("registers the sanitized A2UI lifecycle content fixture", () => {
    expect(CHAT_VISUAL_FIXTURE_KEYS).toContain("a2ui-lifecycle");
    const fixture = getChatVisualFixture("a2ui-lifecycle");
    expect(fixture.messageCount).toBe(1);

    const messages = buildA2uiLifecycleMessages();
    expect(messages).toHaveLength(1);
    expect(messages[0].blocks).toHaveLength(7);
  });
});

describe("Chat visual fixture source contracts", () => {
  it("fails if any apps/web/src file imports the visual harness", () => {
    const offenders: string[] = [];
    for (const file of walkFiles(SRC_ROOT)) {
      const text = readFileSync(file, "utf8");
      if (
        text.includes("tests/visual/chat") ||
        text.includes("ChatVisualFixtureApp") ||
        text.includes("fixture-registry")
      ) {
        // Allow only coincidental comments that do not import the harness path.
        if (
          /from\s+['"][^'"]*tests\/visual\/chat/.test(text) ||
          /import\s+['"][^'"]*tests\/visual\/chat/.test(text) ||
          /import\([^)]*tests\/visual\/chat/.test(text)
        ) {
          offenders.push(file);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("fixture modules do not import production API adapters", () => {
    const harnessTs = [
      resolve(VISUAL_CHAT, "fixture-registry.ts"),
      resolve(VISUAL_CHAT, "fixture-data.ts"),
      resolve(VISUAL_CHAT, "main.ts"),
      resolve(VISUAL_CHAT, "ChatVisualFixtureApp.vue"),
      resolve(WEB_ROOT, "tests/fixtures/chat/messages.ts"),
      resolve(WEB_ROOT, "tests/fixtures/chat/phase3c.ts"),
      resolve(WEB_ROOT, "tests/fixtures/chat/index.ts"),
    ];
    for (const file of harnessTs) {
      const text = readFileSync(file, "utf8");
      expect(text).not.toMatch(/@\/api\b/);
      expect(text).not.toMatch(/from\s+['"]@\/utils\/request['"]/);
    }
  });

  it("Phase 3B harness path mounts production ChatMessageContent and ChatMessageRow", () => {
    expect(APP_SOURCE).toContain("ChatMessageContent");
    expect(APP_SOURCE).toContain("ChatMessageRow");
    expect(APP_SOURCE).toMatch(
      /import ChatMessageContent from ["']@\/views\/chat\/components\/ChatMessageContent\.vue["']/
    );
    expect(APP_SOURCE).toMatch(
      /import ChatMessageRow from ["']@\/views\/chat\/components\/ChatMessageRow\.vue["']/
    );
    expect(APP_SOURCE).toContain("isPhase3BMessageKey");
    expect(APP_SOURCE).toContain("buildHarnessMessages");
  });

  it("mirrors the production DeepGenome wide-row predicate in both content paths", () => {
    const wideBinding =
      /:wide="\s*message\.role === ['"]assistant['"]\s*&&\s*message\.tool_name === ['"]DeepGenomeAgent['"]\s*"/g;
    expect(APP_SOURCE.match(wideBinding)).toHaveLength(2);
  });

  it("Phase 3C harness mounts Activity/log/progress/transfer from shared fixtures", () => {
    expect(APP_SOURCE).toContain("isPhase3CFixtureKey");
    expect(APP_SOURCE).toContain("getPhase3COverlay");
    expect(APP_SOURCE).toContain("ChatActivity");
    expect(APP_SOURCE).toContain("ChatAnalystLog");
    expect(APP_SOURCE).toContain("SendProgress");
    expect(APP_SOURCE).toContain("TransferProgress");
    expect(APP_SOURCE).toMatch(
      /<TransferProgress[\s\S]*v-if="transferSnapshot"/
    );
    expect(APP_SOURCE).toMatch(/<SendProgress[\s\S]*v-else-if="progressProps"/);
    expect(APP_SOURCE).not.toMatch(/@\/api\b/);
  });

  it("renders frame fixtures through production role rows and bubble tokens", () => {
    const scopedStyle = APP_SOURCE.split("<style scoped>")[1] ?? "";
    expect(scopedStyle).not.toMatch(/^\s*\.message(?:\.user)?\s*\{/m);
    expect(APP_SOURCE).not.toContain('class="message"');
    expect(APP_SOURCE).toMatch(
      /<ChatMessageRow[\s\S]*v-for="message in frameMessages"/
    );
    expect(APP_SOURCE).toContain("phy-bubble-user");
    expect(APP_SOURCE).toContain("phy-bubble-assistant");
    expect(APP_SOURCE).not.toContain('class="fixture-message-row"');
    expect(scopedStyle).not.toContain(".fixture-message-row.is-user");
  });

  it("mirrors the singleton header and state-specific landing scroll owners", () => {
    expect(APP_SOURCE).toContain('data-testid="chat-header-preferences"');
    expect(APP_SOURCE.match(/<LangSwitch/g) ?? []).toHaveLength(1);
    expect(APP_SOURCE.match(/<ThemeSwitch/g) ?? []).toHaveLength(1);
    expect(APP_SOURCE).toContain('data-testid="chat-content-stack"');
    expect(
      APP_SOURCE.match(/data-testid="chat-content-stack"/g) ?? []
    ).toHaveLength(1);
    expect(APP_SOURCE.match(/<ChatComposer/g) ?? []).toHaveLength(1);
    expect(APP_SOURCE).toContain("'is-empty': fixture.chatState === 'empty'");
    expect(APP_SOURCE).toContain(
      "'is-populated': fixture.chatState === 'populated'"
    );
    expect(APP_SOURCE).toMatch(
      /\.chat-content-stack\.is-empty\s*\{[\s\S]*?overflow-y:\s*auto/
    );
    expect(APP_SOURCE).toMatch(
      /\.chat-content-stack\.is-populated\s*\{[\s\S]*?overflow:\s*hidden/
    );
    expect(APP_SOURCE).toMatch(
      /\.chat-content-stack\.is-populated\s+\.message-container\s*\{[\s\S]*?overflow-y:\s*auto/
    );
  });

  it("mirrors the expanded Explore Agents disclosure in the fixture", () => {
    expect(APP_SOURCE).toContain("deriveCaseRouteOptions");
    expect(APP_SOURCE).toContain("AgentDisplayName");
    expect(APP_SOURCE).toContain("activeSidebarItem === 'explore-agent'");
    expect(APP_SOURCE).toContain('data-testid="chat-explore-agents-list"');
    expect(APP_SOURCE).toMatch(
      /<template #explore-agents>[\s\S]*?v-for="agent in presetAgents"/
    );
  });

  it("exposes preview, compact disclosure, and history state contracts", () => {
    expect(APP_SOURCE).toContain('data-history-state="');
    expect(APP_SOURCE).toContain("agent-capability-popover");
    expect(APP_SOURCE).toContain('data-testid="chat-history-retry"');
    expect(APP_SOURCE).toContain('data-testid="chat-agent-preview"');
    expect(APP_SOURCE).toContain('data-testid="chat-welcome"');
    expect(APP_SOURCE).toContain("compactExploreOpen");
    expect(MEASURE_SOURCE).toContain("agent-capability-popover__media");
    expect(MEASURE_SOURCE).toContain("history-state");
    expect(MEASURE_SOURCE).toContain("agent-option");
  });
});

describe("Chat visual fixture boot contracts", () => {
  it("locks style/font imports and Pinia/i18n/Element Plus order in main.ts", () => {
    expect(MAIN_SOURCE).toContain('import "@fontsource/inter/400"');
    expect(MAIN_SOURCE).toContain('import "@fontsource/inter/600"');
    expect(MAIN_SOURCE).toContain('import "element-plus/dist/index.css"');
    expect(MAIN_SOURCE).toContain('import "@/styles/tokens.css"');
    expect(MAIN_SOURCE).toContain('import "@/styles/markdown.css"');
    expect(MAIN_SOURCE).toContain('import "@/assets/main.css"');
    expect(MAIN_SOURCE).not.toContain('import "@/assets/theme.css"');
    expect(MAIN_SOURCE).not.toContain('from "@/main"');
    expect(MAIN_SOURCE).not.toMatch(/\binitTheme\s*\(/);

    const piniaUse = MAIN_SOURCE.indexOf("app.use(pinia)");
    const i18nUse = MAIN_SOURCE.indexOf("app.use(i18n)");
    const epUse = MAIN_SOURCE.indexOf("app.use(ElementPlus");
    const setTheme = MAIN_SOURCE.indexOf("setTheme(");
    const setLang = MAIN_SOURCE.indexOf("await setLanguage(");
    const mount = MAIN_SOURCE.indexOf("app.mount(");
    expect(piniaUse).toBeGreaterThan(-1);
    expect(i18nUse).toBeGreaterThan(piniaUse);
    expect(epUse).toBeGreaterThan(i18nUse);
    expect(setTheme).toBeGreaterThan(epUse);
    expect(setLang).toBeGreaterThan(setTheme);
    expect(mount).toBeGreaterThan(setLang);
    expect(MAIN_SOURCE).toContain("await nextTick()");
    expect(MAIN_SOURCE).toContain("document.fonts.ready");
    expect(MAIN_SOURCE).toContain('data-fixture-ready", "true"');
  });

  it("maps EP locale from app language like App.vue", () => {
    expect(APP_SOURCE).toContain("<el-config-provider");
    expect(APP_SOURCE).toContain('appStore.language === "zh-CN" ? zhCn : en');
  });

  it("marks fixture ready only after mount readiness path in main.ts", () => {
    const readyIdx = MAIN_SOURCE.indexOf('data-fixture-ready", "true"');
    const fontsIdx = MAIN_SOURCE.indexOf("document.fonts.ready");
    const mountIdx = MAIN_SOURCE.indexOf("app.mount(");
    expect(readyIdx).toBeGreaterThan(fontsIdx);
    expect(fontsIdx).toBeGreaterThan(mountIdx);
  });
});

describe("Chat visual fixture script contracts", () => {
  it("locks measure→persist→assert split and at-bottom fields", () => {
    expect(MEASURE_SOURCE).toContain("__PHY_CHAT_GEOMETRY_RESULT__");
    expect(MEASURE_SOURCE).toContain("chat-root");
    expect(MEASURE_SOURCE).toContain("chat-visual-root");
    expect(MEASURE_SOURCE).toContain("atBottom");
    expect(MEASURE_SOURCE).toContain("scrollTop");
    expect(MEASURE_SOURCE).toContain("scrollHeight");
    expect(MEASURE_SOURCE).toContain("clientHeight");
    expect(MEASURE_SOURCE).toContain("clientWidth");
    expect(MEASURE_SOURCE).toContain("scrollWidth");
    expect(MEASURE_SOURCE).toContain("primaryAction");
    expect(MEASURE_SOURCE).toContain("navigationTrigger");
    expect(MEASURE_SOURCE).toContain("lastMessage");
    expect(MEASURE_SOURCE).toContain("document overflow");
    expect(MEASURE_SOURCE).toContain("transcript overflow");
    expect(MEASURE_SOURCE).toContain("composer escapes viewport");
    expect(MEASURE_SOURCE).toContain("lastMessage.bottom");
    expect(MEASURE_SOURCE).toContain("innerWidth >= 390 && innerWidth < 600");
    expect(MEASURE_SOURCE).toContain("chat-composer");
    expect(MEASURE_SOURCE).toContain('".chat-composer-surface"');
    expect(MEASURE_SOURCE).toContain("querySelector?.");
    expect(MEASURE_SOURCE).toContain("composerNodes[0]");
    expect(MEASURE_SOURCE).toContain(
      "viewport below 900 requires mobile drawer state"
    );
    expect(MEASURE_SOURCE).toContain(
      "closed mobile requires visible unique sidebar trigger"
    );
    expect(MEASURE_SOURCE).toContain(
      "mobile transcript starts too far below viewport"
    );
    expect(MEASURE_SOURCE).toContain(
      "desktop/compact/open-mobile requires visible unique primary action"
    );
    expect(MEASURE_SOURCE).toMatch(/pass\s*=\s*false|pass:\s*false/);
    expect(MEASURE_SOURCE).not.toContain("throw new Error");
    expect(ASSERT_GEOMETRY_SOURCE).toContain("__PHY_CHAT_GEOMETRY_RESULT__");
    expect(ASSERT_GEOMETRY_SOURCE).toContain("pass: true");
    expect(ASSERT_GEOMETRY_SOURCE).toContain("throw");
  });

  it("locks safe redaction return and path-only assertion", () => {
    expect(REDACT_SOURCE).toContain("chat-account-identity");
    expect(REDACT_SOURCE).toContain("Synthetic user");
    expect(REDACT_SOURCE).toContain("count: 1");
    expect(REDACT_SOURCE).toContain("pass: true");
    expect(REDACT_SOURCE).not.toMatch(/console\.(log|info|warn|error|debug)/);
    expect(ASSERT_PATH_SOURCE).toContain("location.pathname");
    expect(ASSERT_PATH_SOURCE).toContain('"/chat"');
    expect(ASSERT_PATH_SOURCE).toContain("path_ok: true");
    expect(ASSERT_PATH_SOURCE).not.toContain("location.href");
    expect(ASSERT_PATH_SOURCE).not.toContain("location.search");
    expect(ASSERT_PATH_SOURCE).not.toContain("location.hash");
  });

  it("redact-identity replaces without capturing prior text", () => {
    expect(REDACT_SOURCE).not.toMatch(
      /(?:const|let|var)\s+\w+\s*=\s*nodes\[0\]\.(?:textContent|innerText)/
    );
  });

  it("locks upload-state style assertions to shared attachment semantics", () => {
    expect(UPLOAD_ASSERT_SOURCE).toContain("upload fixture status");
    expect(UPLOAD_ASSERT_SOURCE).not.toContain("ChatUploadCard");
    expect(UPLOAD_ASSERT_SOURCE).toContain("aria-valuenow");
    expect(UPLOAD_ASSERT_SOURCE).toContain("uploading");
    expect(UPLOAD_ASSERT_SOURCE).toContain("completed");
    expect(UPLOAD_ASSERT_SOURCE).toContain("viewport horizontally");
    expect(UPLOAD_ASSERT_SOURCE).toContain("pass: true");
    expect(UPLOAD_ASSERT_SOURCE).not.toContain("location.href");
  });
});

describe("Chat visual fixture geometry negative controls", () => {
  it("passes a valid populated desktop layout", async () => {
    const result = await runGeometryHarness();
    expect(result).toMatchObject({ pass: true });
  });

  it("keeps a narrow chip strip and editor inside the composer viewport", async () => {
    const result = await runGeometryHarness({
      state: "empty",
      chatMode: "instant",
      includeCases: true,
      includeQuickSelect: false,
      width: 320,
      height: 568,
      drawerState: "closed",
      composerRect: rect(16, 292, 304, 548),
      includeAttachmentStrip: true,
      attachmentStripRect: rect(16, 304, 304, 344),
      composerEditorRect: rect(16, 348, 304, 420),
    });

    expect(result).toMatchObject({
      pass: true,
      attachmentStrip: { top: 304, bottom: 344 },
      composerEditor: { top: 348, bottom: 420 },
    });
  });

  it("rejects a detail surface when it leaves the viewport", async () => {
    const result = await runGeometryHarness({
      state: "empty",
      chatMode: "instant",
      includeCases: true,
      includeQuickSelect: false,
      includeAttachmentStrip: true,
      includeAttachmentDetail: true,
      attachmentStripRect: rect(280, 700, 1160, 744),
      composerEditorRect: rect(280, 744, 1160, 816),
      attachmentDetailRect: rect(280, 920, 1160, 1000),
    });

    expect(result.pass).toBe(false);
    expect(result.reasons?.join("; ")).toMatch(
      /attachment detail escapes viewport/
    );
  });

  it("keeps the uploading detail fixture bounded above the editor", async () => {
    const result = await runGeometryHarness({
      state: "empty",
      chatMode: "instant",
      includeCases: true,
      includeQuickSelect: false,
      width: 390,
      height: 844,
      drawerState: "closed",
      includeAttachmentStrip: true,
      includeAttachmentDetail: true,
      attachmentStripRect: rect(16, 510, 374, 554),
      composerEditorRect: rect(16, 554, 374, 626),
      attachmentDetailRect: rect(16, 286, 374, 498),
      composerRect: rect(16, 510, 374, 700),
    });

    expect(result).toMatchObject({
      pass: true,
      attachmentStrip: { width: 358 },
      composerEditor: { height: 72 },
      attachmentDetail: { top: 286, bottom: 498 },
    });
  });

  it.each([
    {
      label: "missing primary action",
      options: { includePrimary: false },
      reason: /visible unique primary action/,
    },
    {
      label: "missing composer",
      options: { includeComposer: false },
      reason: /composer missing or not visible/,
    },
  ])(
    "fails closed when the required $label node is missing",
    async ({ options, reason }) => {
      const result = await runGeometryHarness(options);
      expect(result.pass).toBe(false);
      expect(result.reasons?.join("; ")).toMatch(reason);
    }
  );

  it("measures the visible composer surface when the wrapper provides one", async () => {
    const result = await runGeometryHarness({
      composerRect: rect(280, 740, 1160, 880),
      composerSurfaceRect: rect(280, 740, 1160, 865.84),
    });
    expect(result).toMatchObject({ pass: true, composer: { bottom: 865.84 } });
  });

  it("falls back to the composer wrapper when no surface descendant exists", async () => {
    const result = await runGeometryHarness({
      composerRect: rect(280, 740, 1160, 880),
    });
    expect(result).toMatchObject({ pass: true, composer: { bottom: 880 } });
  });

  it("accepts empty Instant without an agent quick-select row", async () => {
    const result = await runGeometryHarness({
      state: "empty",
      chatMode: "instant",
      includeCases: true,
      includeQuickSelect: false,
    });
    expect(result.pass).toBe(true);
  });

  it("rejects empty Expert without the agent quick-select row", async () => {
    const result = await runGeometryHarness({
      state: "empty",
      chatMode: "expert",
      includeCases: true,
      includeQuickSelect: false,
    });
    expect(result.pass).toBe(false);
    expect(result.reasons?.join("; ")).toMatch(
      /mode=expert requires 1 quick selection regions/
    );
  });

  it("rejects an unsupported chat mode with explicit failure context", async () => {
    const result = await runGeometryHarness({
      chatModeOverride: "preview",
    });
    expect(result.pass).toBe(false);
    expect(result.chatMode).toBe("preview");
    expect(result.error).toMatch(/data-chat-mode must be instant\|expert/);
  });

  it.each([
    {
      label: "missing transcript",
      options: { includeTranscript: false },
      reason: /Expected exactly one chat-transcript/,
    },
    {
      label: "missing content stack",
      options: { includeContentStack: false },
      reason: /Expected exactly one chat-content-stack/,
    },
  ])(
    "retains validated mode context for $label",
    async ({ options, reason }) => {
      const result = await runGeometryHarness({
        chatMode: "expert",
        ...options,
      });
      expect(result.pass).toBe(false);
      expect(result.chatMode).toBe("expert");
      expect(result.error).toMatch(reason);
    }
  );

  it("exposes interactive sidebar and mode state for visual review", () => {
    expect(APP_SOURCE).toContain(
      ':data-active-sidebar-item="activeSidebarItem"'
    );
    expect(APP_SOURCE).toContain(':data-chat-mode="fixtureChatMode"');
    expect(APP_SOURCE).toContain(':active-item="activeSidebarItem"');
    expect(APP_SOURCE).toContain(':chat-mode="fixtureChatMode"');
    expect(APP_SOURCE).toContain(
      '@update:chat-mode="fixtureChatMode = $event"'
    );
    expect(APP_SOURCE).toContain(':expert-mode-enabled="true"');
    expect(APP_SOURCE).toContain("getChatRoutingFixture");
    expect(APP_SOURCE).toContain("routingPermissionsLoading");
    expect(APP_SOURCE).toContain("allowedTools.includes(option.tool)");
    expect(APP_SOURCE).toContain(
      ':attachment-target-available="attachmentTargetAvailable"'
    );
    expect(APP_SOURCE).toContain(
      ':attachment-target-blocked="attachmentTargetBlocked"'
    );
  });

  it("locks the focused computed-style capture contract", () => {
    for (const needle of [
      "--phy-color-primary-soft",
      "--phy-color-action-text",
      "chat-mode-selector",
      "chat-header-inner",
      "chat-case-icon img",
      "In Silico",
      "rendered In Silico label is not semantic",
      "chat-agent-quick-option",
      "quick-select trigger is not pill-shaped",
      "selected quick-select background is not primary-soft",
    ]) {
      expect(REFINEMENT_ASSERT_SOURCE).toContain(needle);
    }
    for (const viewport of ["390 844", "1440 900", "2560 1440"]) {
      expect(REFINEMENT_CAPTURE_SOURCE).toContain(viewport);
    }
    expect(REFINEMENT_CAPTURE_SOURCE).toContain('test "${png_count}" -eq 30');
    expect(REFINEMENT_CAPTURE_SOURCE).toContain(
      'test "${geometry_count}" -eq 30'
    );
    expect(REFINEMENT_CAPTURE_SOURCE).toContain(
      'test "${refinement_count}" -eq 30'
    );
  });

  it("keeps the empty landing at the top with Composer and Cases present", async () => {
    const result = await runGeometryHarness({
      state: "empty",
      chatMode: "expert",
      emptyScrollPosition: "top",
      includeCases: true,
      includeQuickSelect: true,
      composerRect: rect(280, 360, 1160, 520),
      lastCaseRect: rect(280, 760, 1160, 820),
    });

    expect(result.pass).toBe(true);
  });

  it("accepts the Cases-anchored capture when the final case is visible", async () => {
    const result = await runGeometryHarness({
      state: "empty",
      chatMode: "expert",
      emptyScrollPosition: "cases",
      includeCases: true,
      includeQuickSelect: true,
      composerRect: rect(280, -260, 1160, -100),
      lastCaseRect: rect(280, 720, 1160, 800),
      contentStackScrollHeight: 1500,
      contentStackClientHeight: 852,
    });

    expect(result.pass).toBe(true);
  });

  it("allows an open mobile drawer to hide the main Composer", async () => {
    const result = await runGeometryHarness({
      state: "empty",
      chatMode: "expert",
      width: 390,
      height: 844,
      drawerState: "open",
      composerVisible: false,
      includeCases: true,
      includeQuickSelect: true,
    });

    expect(result.pass).toBe(true);
  });

  it("rejects a Cases-anchored capture that cannot show the final case", async () => {
    const result = await runGeometryHarness({
      state: "empty",
      emptyScrollPosition: "cases",
      includeCases: true,
      includeQuickSelect: true,
      lastCaseRect: rect(280, 920, 1160, 1000),
    });

    expect(result.pass).toBe(false);
    expect(result.reasons?.join("; ")).toMatch(/final case is not visible/);
  });

  it("rejects Cases or quick selection in populated Chat", async () => {
    const result = await runGeometryHarness({
      state: "populated",
      includeCases: true,
      includeQuickSelect: true,
    });

    expect(result.pass).toBe(false);
    expect(result.reasons?.join("; ")).toMatch(
      /populated state must not render Cases|populated state must not render quick selection/
    );
  });

  it.each([
    {
      label: "document overflow",
      options: { documentScrollWidth: 1441 },
      reason: /document overflow/,
    },
    {
      label: "transcript overflow",
      options: { transcriptScrollWidth: 1161 },
      reason: /transcript overflow/,
    },
    {
      label: "composer viewport escape",
      options: { composerRect: rect(300, 740, 1460, 880) },
      reason: /composer escapes viewport/,
    },
    {
      label: "last-message clearance",
      options: { lastMessageRect: rect(360, 700, 1080, 760) },
      reason: /lastMessage\.bottom/,
    },
    {
      label: "sub-900 mobile state",
      options: { width: 899, drawerState: "not-mobile" as const },
      reason: /viewport below 900 requires mobile drawer state/,
    },
    {
      label: "closed-mobile trigger",
      options: {
        width: 899,
        drawerState: "closed" as const,
        includeTrigger: false,
      },
      reason: /closed mobile requires visible unique sidebar trigger/,
    },
    {
      label: "mobile main-row displacement",
      options: {
        width: 899,
        drawerState: "closed" as const,
        transcriptRect: rect(0, 240, 899, 720),
      },
      reason: /mobile transcript starts too far below viewport/,
    },
    {
      label: "primary action visibility",
      options: { primaryVisible: false },
      reason: /visible unique primary action/,
    },
  ])("rejects $label", async ({ options, reason }) => {
    const result = await runGeometryHarness(options);
    expect(result.pass).toBe(false);
    expect(result.reasons?.join("; ")).toMatch(reason);
  });
});

type VisualMountOptions = {
  renderA2ui?: boolean;
  renderRoutingControls?: boolean;
  locale?: "en-US" | "zh-CN";
};

const mountFixtureApp = (
  fixture: ReturnType<typeof getChatVisualFixture> | null,
  errorMessage: string | null = null,
  options: VisualMountOptions = {}
) => {
  const stubs = {
    ChatModeSelector: true,
    ChatAgentPicker: true,
    LangSwitch: true,
    ThemeSwitch: true,
    ElUpload: true,
    ElDropdown: {
      name: "ElDropdown",
      template:
        '<div class="dropdown-stub"><slot /><slot name="dropdown" /></div>',
    },
    ElDropdownMenu: {
      template: '<div class="dropdown-menu-stub"><slot /></div>',
    },
    ElDropdownItem: {
      template: "<button><slot /></button>",
    },
    ElTooltip: {
      name: "ElTooltip",
      template: '<div class="tooltip-stub"><slot /></div>',
    },
    ElAvatar: true,
    ElIcon: true,
    RouterLink: {
      name: "RouterLink",
      props: ["to"],
      template: '<a :href="to"><slot /></a>',
    },
    ElButton: {
      name: "ElButton",
      template: '<button v-bind="$attrs"><slot /></button>',
    },
    ElTable: true,
    ElTableColumn: true,
    // Heavy agent renderers — assert production mounts exist via stubs.
    StreamMessage: {
      name: "StreamMessage",
      props: ["blocks", "ns"],
      template:
        '<div data-testid="stream-message" :data-ns="ns === undefined ? \'__absent__\' : String(ns)" />',
    },
    DeepGenomeResultViewer: {
      name: "DeepGenomeResultViewer",
      props: ["ns"],
      template:
        '<div data-testid="deep-genome" :data-ns="ns === undefined ? \'__absent__\' : String(ns)" />',
    },
    CitedAnswer: {
      name: "CitedAnswer",
      props: ["ns"],
      template:
        '<div data-testid="cited-answer" :data-ns="ns === undefined ? \'__absent__\' : String(ns)" />',
    },
    MarkdownViewer: {
      name: "MarkdownViewer",
      props: ["ns", "content"],
      template:
        '<div data-testid="markdown-viewer" :data-ns="ns === undefined ? \'__absent__\' : String(ns)" />',
    },
    teleport: true,
  } as Record<string, unknown>;
  if (options.renderA2ui) delete stubs.StreamMessage;
  if (options.renderRoutingControls) delete stubs.ChatAgentPicker;

  return createTestAppContext({ locale: options.locale ?? "en-US" }).mount(
    ChatVisualFixtureApp,
    {
      props: { fixture, errorMessage },
      global: {
        mocks: {
          $t: (key: string) => key,
        },
        stubs,
      },
    }
  );
};

describe("Chat visual fixture rendering (no network)", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;
  let xhrOpenSpy: ReturnType<typeof vi.spyOn> | undefined;

  beforeEach(() => {
    fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response("{}", { status: 200 }));
    if (typeof XMLHttpRequest !== "undefined") {
      xhrOpenSpy = vi
        .spyOn(XMLHttpRequest.prototype, "open")
        .mockImplementation(() => undefined);
    }
  });

  afterEach(() => {
    fetchSpy.mockRestore();
    xhrOpenSpy?.mockRestore();
  });

  it("renders empty fixture with zero message rows and Synthetic user", async () => {
    const fixture = getChatVisualFixture("empty");
    const wrapper = mountFixtureApp(fixture);
    await flushPromises();
    await nextTick();

    expect(wrapper.find('[data-testid="chat-visual-root"]').exists()).toBe(
      true
    );
    expect(
      wrapper
        .find('[data-testid="chat-visual-root"]')
        .attributes("data-chat-state")
    ).toBe("empty");
    expect(wrapper.findAll('[data-testid="chat-message-row"]')).toHaveLength(0);
    expect(
      wrapper.find('[data-test="sidebar-nav-explore-agent"]').exists()
    ).toBe(true);
    expect(
      wrapper.findAll('[data-testid="chat-account-identity"]')
    ).toHaveLength(1);
    expect(wrapper.find('[data-testid="chat-account-identity"]').text()).toBe(
      SYNTHETIC_IDENTITY
    );
    expect(wrapper.find('[data-testid="attachment-chip-strip"]').exists()).toBe(
      false
    );
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(xhrOpenSpy?.mock.calls ?? []).toHaveLength(0);
    expect(buildSyntheticFileList(fixture)).toHaveLength(0);
  });

  it.each([
    ["upload-queued", "queued", "attachment-chip-detail-cancel"],
    ["upload-uploading", "uploading", "attachment-chip-detail-pause"],
    ["upload-paused", "paused", "attachment-chip-detail-resume"],
    ["upload-failed", "failed", "attachment-chip-detail-retry"],
    ["upload-completed", "completed", "attachment-chip-detail-remove"],
  ] as const)(
    "renders the %s resumable upload state through AttachmentChipStrip",
    async (key, status, actionTestId) => {
      const wrapper = mountFixtureApp(getChatVisualFixture(key));
      await flushPromises();
      await nextTick();

      const root = wrapper.get('[data-testid="chat-visual-root"]');
      expect(root.attributes("data-upload-status")).toBe(status);
      const strip = wrapper.get('[data-testid="attachment-chip-strip"]');
      const chip = strip.get('[data-testid="attachment-chip"]');
      expect(chip.attributes("data-state")).toBe(status);
      expect(
        chip.get('[data-testid="attachment-chip-status"]').text()
      ).not.toBe("");
      await chip.trigger("click");
      expect(
        strip
          .get('[data-testid="attachment-chip-detail-progress"]')
          .attributes("aria-valuenow")
      ).toMatch(/^\d+$/);
      expect(strip.get(`[data-testid="${actionTestId}"]`).exists()).toBe(true);
      expect(fetchSpy).not.toHaveBeenCalled();
      expect(xhrOpenSpy?.mock.calls ?? []).toHaveLength(0);
      wrapper.unmount();
    }
  );

  it("renders compact mixed, overflow, detail, and incompatible-agent fixtures", async () => {
    const detailWrapper = mountFixtureApp(
      getChatVisualFixture("uploading-detail-open")
    );
    await flushPromises();
    await nextTick();
    expect(
      detailWrapper.find('[data-testid="attachment-chip-strip"]').exists()
    ).toBe(true);
    expect(
      detailWrapper.find('[data-testid="attachment-chip-detail"]').exists()
    ).toBe(true);
    detailWrapper.unmount();

    const mixedWrapper = mountFixtureApp(
      getChatVisualFixture("mixed-ready-failed-expired")
    );
    await flushPromises();
    expect(
      mixedWrapper
        .findAll('[data-testid="attachment-chip"]')
        .map((chip) => chip.attributes("data-state"))
    ).toEqual(["completed", "failed", "expired"]);
    mixedWrapper.unmount();

    const overflowWrapper = mountFixtureApp(
      getChatVisualFixture("ten-files-overflow")
    );
    await flushPromises();
    expect(
      overflowWrapper.find('[data-testid="attachment-chip-overflow"]').text()
    ).toContain("+7 more");
    overflowWrapper.unmount();

    const blockedWrapper = mountFixtureApp(
      getChatVisualFixture("incompatible-agent-blocked")
    );
    await flushPromises();
    const editor = blockedWrapper.get('[data-testid="mention-input"]');
    expect(editor.attributes("disabled")).toBeUndefined();
    expect(
      blockedWrapper
        .get('[data-testid="chat-composer"] .composer-send-button')
        .attributes("disabled")
    ).toBeDefined();
    blockedWrapper.unmount();
  });

  it("derives Chinese quick-select labels from the active locale", async () => {
    const wrapper = mountFixtureApp(
      getChatVisualFixture("expert-auto-empty"),
      null,
      {
        renderA2ui: true,
        renderRoutingControls: true,
        locale: "zh-CN",
      }
    );
    await flushPromises();
    await nextTick();

    expect(
      wrapper
        .findAll('[data-testid="chat-agent-quick-option"]')
        .map((option) => option.text())
    ).toEqual([
      zhCN.chat.agentLabels.chatAgent,
      zhCN.chat.agentLabels.dataAgent,
      zhCN.chat.agentLabels.analystAgent,
    ]);
    wrapper.unmount();
  });

  it("renders all eight Cases in both empty fixture positions", async () => {
    for (const key of ["empty", "empty-cases"] as const) {
      const wrapper = mountFixtureApp(getChatVisualFixture(key));
      await flushPromises();
      expect(wrapper.findAll('[data-testid="chat-case-link"]')).toHaveLength(8);
      expect(
        wrapper.get('[data-testid="chat-content-stack"]').classes()
      ).toContain("is-empty");
      wrapper.unmount();
    }
  });

  it("renders populated fixture with matching message row count", async () => {
    const fixture = getChatVisualFixture("populated");
    const wrapper = mountFixtureApp(fixture);
    await flushPromises();
    expect(wrapper.findAll('[data-testid="chat-message-row"]')).toHaveLength(
      fixture.messageCount
    );
    expect(
      wrapper
        .find('[data-testid="chat-visual-root"]')
        .attributes("data-chat-state")
    ).toBe("populated");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("keeps Instant routing free of agent controls", async () => {
    const wrapper = mountFixtureApp(
      getChatVisualFixture("instant-empty"),
      null,
      {
        renderRoutingControls: true,
      }
    );
    await flushPromises();

    expect(wrapper.find('[data-testid="chat-agent-picker"]').exists()).toBe(
      false
    );
    expect(
      wrapper.find('[data-testid="chat-agent-quick-select"]').exists()
    ).toBe(false);
    expect(wrapper.findAll(".composer-tool-button")).toHaveLength(0);
    wrapper.unmount();
  });

  it("renders autonomous and selected Expert picker/menu layouts", async () => {
    const autoEmpty = mountFixtureApp(
      getChatVisualFixture("expert-auto-empty"),
      null,
      { renderRoutingControls: true }
    );
    await flushPromises();

    expect(
      autoEmpty
        .find('[data-testid="chat-visual-root"]')
        .attributes("data-chat-mode")
    ).toBe("expert");
    expect(autoEmpty.find('[data-testid="chat-agent-picker"]').exists()).toBe(
      true
    );
    expect(
      autoEmpty.find('[data-testid="agent-picker-trigger"]').exists()
    ).toBe(true);
    expect(
      autoEmpty.findAll('[data-testid="chat-agent-quick-option"]')
    ).toHaveLength(3);

    const selectedEmpty = mountFixtureApp(
      getChatVisualFixture("expert-selected-empty"),
      null,
      { renderRoutingControls: true }
    );
    await flushPromises();
    expect(
      selectedEmpty.find('[data-testid="agent-picker-chip"]').exists()
    ).toBe(true);
    expect(
      selectedEmpty
        .findAll('[data-testid="chat-agent-quick-option"]')
        .filter((option) => option.classes().includes("is-selected"))
    ).toHaveLength(1);

    const selectedPopulated = mountFixtureApp(
      getChatVisualFixture("expert-selected-populated"),
      null,
      { renderRoutingControls: true }
    );
    await flushPromises();
    expect(
      selectedPopulated.find('[data-testid="chat-agent-picker"]').exists()
    ).toBe(false);
    expect(
      selectedPopulated.find('[data-testid="chat-agent-quick-select"]').exists()
    ).toBe(false);
    expect(selectedPopulated.findAll(".composer-tool-button")).toHaveLength(1);

    autoEmpty.unmount();
    selectedEmpty.unmount();
    selectedPopulated.unmount();
  });

  it("adapts message fixtures to the closed mobile drawer below the medium breakpoint", async () => {
    const previousWidth = window.innerWidth;
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      value: 390,
    });

    const wrapper = mountFixtureApp(getChatVisualFixture("cited"));
    await nextTick();

    const root = wrapper.find('[data-testid="chat-visual-root"]');
    expect(root.attributes("data-sidebar-drawer-state")).toBe("closed");
    expect(
      wrapper.findAll('[data-testid="chat-sidebar-trigger"]')
    ).toHaveLength(1);
    expect(wrapper.findAll('[data-testid="chat-primary-action"]')).toHaveLength(
      1
    );

    wrapper.unmount();
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      value: previousWidth,
    });
  });

  it("shows sidebar trigger only for closed-mobile and primary for open-mobile", async () => {
    const closed = mountFixtureApp(
      getChatVisualFixture("sidebar-mobile-closed")
    );
    expect(closed.findAll('[data-testid="chat-sidebar-trigger"]')).toHaveLength(
      1
    );
    expect(closed.findAll('[data-testid="chat-primary-action"]')).toHaveLength(
      1
    );

    const open = mountFixtureApp(getChatVisualFixture("sidebar-mobile-open"));
    expect(open.findAll('[data-testid="chat-sidebar-trigger"]')).toHaveLength(
      0
    );
    expect(open.findAll('[data-testid="chat-primary-action"]')).toHaveLength(1);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("marks every mounted fixture root ready and renders explicit history recovery states", async () => {
    for (const key of [
      "history-title-only",
      "history-loading",
      "history-empty",
      "history-error",
    ] as const) {
      const fixture = getChatVisualFixture(key);
      const wrapper = mountFixtureApp(fixture, null, {
        renderRoutingControls: true,
      });
      await flushPromises();
      await nextTick();

      const root = wrapper.get('[data-testid="chat-visual-root"]');
      expect(root.attributes("data-fixture-ready")).toBe("true");
      expect(root.attributes("data-history-state")).toBe(fixture.historyState);
      expect(wrapper.find('[data-testid="chat-welcome"]').exists()).toBe(false);
      if (key === "history-title-only") {
        expect(
          wrapper.findAll('[data-testid="chat-message-row"]')
        ).toHaveLength(1);
        expect(
          wrapper
            .get('[data-testid="chat-message-row"]')
            .attributes("data-message-role")
        ).toBe("user");
      } else {
        expect(
          wrapper.findAll('[data-testid="chat-message-row"]')
        ).toHaveLength(0);
      }
      if (key === "history-loading") {
        expect(
          wrapper.find('[data-testid="chat-history-loading"]').exists()
        ).toBe(true);
      }
      if (key === "history-empty") {
        expect(
          wrapper.find('[data-testid="chat-history-empty"]').exists()
        ).toBe(true);
      }
      if (key === "history-error") {
        const retry = wrapper.get('[data-testid="chat-history-retry"]');
        await retry.trigger("click");
        expect(
          wrapper.get('[data-testid="chat-fixture-action"]').text()
        ).toContain("history-retry");
      }
      wrapper.unmount();
    }
  });

  it("opens one canonical full Agent capability preview without cropped media", async () => {
    const wrapper = mountFixtureApp(
      getChatVisualFixture("agent-preview"),
      null,
      { renderRoutingControls: true }
    );
    await flushPromises();
    await nextTick();

    expect(
      wrapper
        .find('[data-testid="chat-visual-root"]')
        .attributes("data-fixture-ready")
    ).toBe("true");
    expect(wrapper.findAll('[data-testid="chat-agent-preview"]').length).toBe(
      1
    );
    expect(wrapper.findAll('[role="dialog"]')).toHaveLength(1);
    expect(wrapper.findAll(".agent-capability-popover__media")).toHaveLength(1);
    expect(
      wrapper.get(".agent-capability-popover__media img").attributes("src")
    ).toContain("DeepGenomeAgent.png");
    expect(
      wrapper
        .find(".agent-capability-popover__media img")
        .attributes("style") ?? ""
    ).not.toContain("object-fit: cover");
    wrapper.unmount();
  });

  it("keeps compact Explore Agents options inside the sidebar without changing preference", async () => {
    const previousWidth = window.innerWidth;
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      value: 1024,
    });
    const wrapper = mountFixtureApp(
      getChatVisualFixture("sidebar-compact-explore-open")
    );
    await nextTick();

    const root = wrapper.get('[data-testid="chat-visual-root"]');
    const sidebar = wrapper.get(".phy-adaptive-sidebar__surface");
    const options = wrapper.findAll(".agent-option");
    expect(root.attributes("data-compact-explore-open")).toBe("true");
    expect(root.attributes("data-sidebar-collapsed-preference")).toBe("true");
    expect(options.length).toBeGreaterThan(0);
    for (const option of options) {
      expect(sidebar.element.contains(option.element)).toBe(true);
    }

    wrapper.unmount();
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      value: previousWidth,
    });
  });

  it("surfaces a clear error for invalid dimensions", () => {
    const wrapper = mountFixtureApp(null, 'Unknown fixture state "nope".');
    expect(wrapper.find('[data-testid="chat-visual-error"]').text()).toContain(
      "Unknown fixture state"
    );
    expect(wrapper.find('[data-testid="chat-visual-root"]').exists()).toBe(
      false
    );
  });

  it("renders Phase 3B message fixtures via ChatMessageRow + ChatMessageContent without network", async () => {
    const expectations: Record<string, { testId: string; ns?: string }> = {
      "short-generic": { testId: "markdown-viewer", ns: "__absent__" },
      "long-generic": { testId: "markdown-viewer", ns: "__absent__" },
      cited: { testId: "cited-answer", ns: "m1" },
      "deep-genome": { testId: "deep-genome", ns: "m1" },
      streaming: { testId: "stream-message", ns: "__absent__" },
      "interleaved-streaming": { testId: "stream-message", ns: "__absent__" },
    };

    for (const [key, expectBranch] of Object.entries(expectations)) {
      const fixture = getChatVisualFixture(
        key as (typeof CHAT_VISUAL_FIXTURE_KEYS)[number]
      );
      const wrapper = mountFixtureApp(fixture);
      await flushPromises();
      await nextTick();

      expect(
        wrapper.findComponent({ name: "ChatMessageContent" }).exists()
      ).toBe(true);
      expect(wrapper.findAll('[data-testid="chat-message-row"]')).toHaveLength(
        fixture.messageCount
      );
      const branch = wrapper.find(`[data-testid="${expectBranch.testId}"]`);
      expect(branch.exists()).toBe(true);
      if (expectBranch.ns !== undefined) {
        expect(branch.attributes("data-ns")).toBe(expectBranch.ns);
      }
      expect(fetchSpy).not.toHaveBeenCalled();
      expect(xhrOpenSpy?.mock.calls ?? []).toHaveLength(0);
      wrapper.unmount();
    }
  });

  it("renders table/steps/image Phase 3B keys without network", async () => {
    for (const key of ["table", "steps", "image"] as const) {
      const fixture = getChatVisualFixture(key);
      const wrapper = mountFixtureApp(fixture);
      await flushPromises();
      expect(
        wrapper.findComponent({ name: "ChatMessageContent" }).exists()
      ).toBe(true);
      expect(wrapper.findAll('[data-testid="chat-message-row"]')).toHaveLength(
        2
      );
      expect(fetchSpy).not.toHaveBeenCalled();
      wrapper.unmount();
    }
  });

  it("renders the sanitized A2UI lifecycle through production content blocks", async () => {
    const fixture = getChatVisualFixture("a2ui-lifecycle");
    const wrapper = mountFixtureApp(fixture, null, { renderA2ui: true });
    await flushPromises();
    await nextTick();

    expect(wrapper.findComponent({ name: "ChatMessageContent" }).exists()).toBe(
      true
    );
    expect(wrapper.findComponent({ name: "StreamMessage" }).exists()).toBe(
      true
    );
    expect(wrapper.findAll(".agent-surface-block")).toHaveLength(7);
    expect(wrapper.findAll(".a2ui-status")).toHaveLength(5);
    expect(wrapper.find(".a2ui-body").text()).toHaveLength(4096);
    expect(wrapper.find(".a2ui-form label").text()).toHaveLength(256);
    expect(wrapper.find('[data-test="a2ui-retry"]').exists()).toBe(true);
    expect(
      wrapper
        .find('.agent-surface-block[data-widget="form"]')
        .attributes("aria-busy")
    ).toBe("true");
    expect(wrapper.findAll(".a2ui-actions")).toHaveLength(3);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(xhrOpenSpy?.mock.calls ?? []).toHaveLength(0);
    wrapper.unmount();
  });

  it("renders the lifecycle fixture in both locales without network", async () => {
    for (const locale of ["en-US", "zh-CN"] as const) {
      const wrapper = mountFixtureApp(
        getChatVisualFixture("a2ui-lifecycle"),
        null,
        { renderA2ui: true, locale }
      );
      await flushPromises();
      await nextTick();

      expect(wrapper.findAll(".agent-surface-block")).toHaveLength(7);
      expect(
        wrapper.findAll('[role="status"][aria-live="polite"]')
      ).toHaveLength(6);
      expect(wrapper.find('[data-test="a2ui-retry"]').exists()).toBe(true);
      wrapper.unmount();
    }
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(xhrOpenSpy?.mock.calls ?? []).toHaveLength(0);
  });

  it("keeps lifecycle geometry bounded for desktop and 375px viewports", async () => {
    const desktop = await runGeometryHarness({
      width: 1440,
      documentScrollWidth: 1440,
      transcriptScrollWidth: 1160,
    });
    expect(desktop.pass).toBe(true);

    const mobile = await runGeometryHarness({
      width: 375,
      height: 900,
      documentScrollWidth: 375,
      transcriptClientWidth: 375,
      transcriptScrollWidth: 375,
      drawerState: "closed",
      includeTrigger: true,
      transcriptRect: rect(0, 48, 375, 720),
      composerRect: rect(8, 740, 367, 880),
      lastMessageRect: rect(16, 620, 359, 700),
    });
    expect(mobile.pass).toBe(true);
    expect(
      (mobile.reasons ?? []).some((reason) => /overflow/.test(reason))
    ).toBe(false);
    expect(CONTENT_SOURCE).toContain("overflow-x: auto");
    expect(CONTENT_SOURCE).toContain("word-break: break-word");
    expect(CONTENT_SOURCE).toContain("max-width: 100%");
  });
});
