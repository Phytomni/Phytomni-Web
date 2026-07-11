import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { resolve, join } from "node:path";
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
} from "../../../visual/chat/fixture-data";

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
  it("contains every exact Phase 3A state key", () => {
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
    ];
    for (const file of harnessTs) {
      const text = readFileSync(file, "utf8");
      expect(text).not.toMatch(/@\/api\b/);
      expect(text).not.toMatch(/from\s+['"]@\/utils\/request['"]/);
    }
  });
});

describe("Chat visual fixture boot contracts", () => {
  it("locks style/font imports and Pinia/i18n/Element Plus order in main.ts", () => {
    expect(MAIN_SOURCE).toContain('import "@fontsource/inter/400"');
    expect(MAIN_SOURCE).toContain('import "@fontsource/inter/600"');
    expect(MAIN_SOURCE).toContain('import "element-plus/dist/index.css"');
    expect(MAIN_SOURCE).toContain('import "@/styles/tokens.css"');
    expect(MAIN_SOURCE).toContain('import "@/assets/main.css"');
    expect(MAIN_SOURCE).toContain('import "@/assets/theme.css"');
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
    expect(MEASURE_SOURCE).toMatch(/pass\s*=\s*false|pass:\s*false/);
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
        PhyComposerFrame: {
          name: "PhyComposerFrame",
          template: "<div><slot /></div>",
        },
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
});
