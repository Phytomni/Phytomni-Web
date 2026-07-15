import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { resolve, join } from "node:path";
import { runInNewContext } from "node:vm";
import { mount, flushPromises } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { nextTick } from "vue";
import {
  CHAT_VISUAL_FIXTURE_KEYS,
  CHAT_VISUAL_LOCALES,
  CHAT_VISUAL_THEMES,
  resolveChatVisualFixture,
  getChatVisualFixture,
} from "../../../visual/chat/fixture-registry";
import {
  SYNTHETIC_IDENTITY,
  buildSyntheticMessages,
  buildSyntheticFileList,
  buildHarnessMessages,
  getSharedMessageFixture,
  getSharedPhase3COverlay,
} from "../../../visual/chat/fixture-data";
import {
  PHASE_3B_MESSAGE_KEYS,
  MESSAGE_FIXTURES,
  isPhase3BMessageKey,
  PHASE_3C_FIXTURE_KEYS,
  isPhase3CFixtureKey,
  getPhase3COverlay,
} from "../../../fixtures/chat";

const WEB_ROOT = resolve(__dirname, "../../../..");
const SRC_ROOT = resolve(WEB_ROOT, "src");
const VISUAL_CHAT = resolve(WEB_ROOT, "tests/visual/chat");
const MAIN_SOURCE = readFileSync(resolve(VISUAL_CHAT, "main.ts"), "utf8");
const APP_SOURCE = readFileSync(
  resolve(VISUAL_CHAT, "ChatVisualFixtureApp.vue"),
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

type GeometryResult = {
  pass: boolean;
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
  width?: number;
  height?: number;
  documentScrollWidth?: number;
  transcriptScrollWidth?: number;
  transcriptRect?: Rect;
  composerRect?: Rect;
  lastMessageRect?: Rect;
  drawerState?: "closed" | "open" | "not-mobile";
  includeTrigger?: boolean;
  triggerVisible?: boolean;
  primaryVisible?: boolean;
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
  const makeElement = (bounds: Rect, visible = true) => ({
    __visible: visible,
    getBoundingClientRect: () => bounds,
  });

  const transcript = Object.assign(
    makeElement(options.transcriptRect ?? rect(280, 48, width, 720)),
    {
      scrollHeight: 1200,
      clientHeight: 672,
      clientWidth: Math.max(1, width - 280),
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

  const lastMessage = makeElement(
    options.lastMessageRect ?? rect(360, 620, Math.min(width - 40, 1080), 700)
  );
  const root = Object.assign(makeElement(rect(0, 0, width, height)), {
    getAttribute: (name: string) => {
      if (name === "data-chat-state") return "populated";
      if (name === "data-sidebar-drawer-state") return drawerState;
      return null;
    },
    querySelectorAll: (selector: string) => {
      if (selector === '[data-testid="chat-transcript"]') return [transcript];
      if (selector === '[data-testid="chat-message-row"]') return [lastMessage];
      return [];
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
    options.composerRect ?? rect(Math.min(300, width / 4), 740, width - 24, 880)
  );
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
      if (selector === '[data-testid="chat-primary-action"]') return [primary];
      if (selector === '[data-testid="chat-sidebar-trigger"]') {
        return includeTrigger ? [trigger] : [];
      }
      if (selector === '[data-testid="chat-composer"]') return [composer];
      return [];
    },
  };
  const windowMock: Record<string, unknown> = {};

  return (await runInNewContext(MEASURE_SOURCE, {
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
}

vi.mock("vue-element-plus-x", () => ({
  MentionSender: {
    name: "MentionSender",
    inheritAttrs: false,
    template:
      '<div class="mention-sender-stub" v-bind="$attrs"><slot name="header" /><slot name="prefix" /><slot name="action-list" /></div>',
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
  Prompts: { name: "Prompts", template: "<div></div>" },
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
      "empty",
      "populated",
      "attachment",
      "sending",
      "picker-open",
      "picker-search",
      "picker-selected",
      "sidebar-expanded",
      "sidebar-compact",
      "sidebar-mobile-closed",
      "sidebar-mobile-open",
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
});

describe("Chat visual fixture geometry negative controls", () => {
  it("passes a valid populated desktop layout", async () => {
    const result = await runGeometryHarness();
    expect(result).toMatchObject({ pass: true });
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

const mountFixtureApp = (
  fixture: ReturnType<typeof getChatVisualFixture> | null,
  errorMessage: string | null = null
) =>
  mount(ChatVisualFixtureApp, {
    props: { fixture, errorMessage },
    global: {
      mocks: {
        $t: (key: string) => key,
      },
      stubs: {
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
        ElTooltip: true,
        ElAvatar: true,
        ElIcon: true,
        ElButton: {
          name: "ElButton",
          template: "<button><slot /></button>",
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
      },
    },
  });

describe("Chat visual fixture rendering (no network)", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;
  let xhrOpenSpy: ReturnType<typeof vi.spyOn> | undefined;

  beforeEach(() => {
    setActivePinia(createPinia());
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
      wrapper.findAll('[data-testid="chat-account-identity"]')
    ).toHaveLength(1);
    expect(wrapper.find('[data-testid="chat-account-identity"]').text()).toBe(
      SYNTHETIC_IDENTITY
    );
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(xhrOpenSpy?.mock.calls ?? []).toHaveLength(0);
    expect(buildSyntheticFileList(fixture)).toHaveLength(0);
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
        key as typeof CHAT_VISUAL_FIXTURE_KEYS[number]
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
});
