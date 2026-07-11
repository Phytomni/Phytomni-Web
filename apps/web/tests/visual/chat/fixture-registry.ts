/** Typed closed registry for the Chat visual fixture harness (test-only). */

export const CHAT_VISUAL_FIXTURE_KEYS = [
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
] as const;

export type ChatVisualFixtureKey = typeof CHAT_VISUAL_FIXTURE_KEYS[number];

export const CHAT_VISUAL_LOCALES = ["en-US", "zh-CN"] as const;
export type ChatVisualLocale = typeof CHAT_VISUAL_LOCALES[number];

export const CHAT_VISUAL_THEMES = ["light", "dark"] as const;
export type ChatVisualTheme = typeof CHAT_VISUAL_THEMES[number];

export type ChatVisualChatState = "empty" | "populated";

export type ChatVisualFixtureDefinition = {
  key: ChatVisualFixtureKey;
  /** Root `data-chat-state` for geometry measurement. */
  chatState: ChatVisualChatState;
  sidebarCollapsed: boolean;
  drawerOpen: boolean;
  /** Header mobile trigger — only for closed-mobile fixtures. */
  showSidebarTrigger: boolean;
  /** Force ChatSidebarNav off-canvas identity/primary semantics. */
  offCanvas: boolean;
  isSending: boolean;
  hasAttachment: boolean;
  selectedAgent: string;
  pickerOpen: boolean;
  pickerSearchQuery: string;
  /** Real rendered `chat-message-row` count (empty ⇒ 0, no hidden fakes). */
  messageCount: number;
};

const DEFINITIONS: Record<ChatVisualFixtureKey, ChatVisualFixtureDefinition> = {
  empty: {
    key: "empty",
    chatState: "empty",
    sidebarCollapsed: false,
    drawerOpen: false,
    showSidebarTrigger: false,
    offCanvas: false,
    isSending: false,
    hasAttachment: false,
    selectedAgent: "",
    pickerOpen: false,
    pickerSearchQuery: "",
    messageCount: 0,
  },
  populated: {
    key: "populated",
    chatState: "populated",
    sidebarCollapsed: false,
    drawerOpen: false,
    showSidebarTrigger: false,
    offCanvas: false,
    isSending: false,
    hasAttachment: false,
    selectedAgent: "",
    pickerOpen: false,
    pickerSearchQuery: "",
    messageCount: 2,
  },
  attachment: {
    key: "attachment",
    chatState: "empty",
    sidebarCollapsed: false,
    drawerOpen: false,
    showSidebarTrigger: false,
    offCanvas: false,
    isSending: false,
    hasAttachment: true,
    selectedAgent: "",
    pickerOpen: false,
    pickerSearchQuery: "",
    messageCount: 0,
  },
  sending: {
    key: "sending",
    chatState: "populated",
    sidebarCollapsed: false,
    drawerOpen: false,
    showSidebarTrigger: false,
    offCanvas: false,
    isSending: true,
    hasAttachment: false,
    selectedAgent: "",
    pickerOpen: false,
    pickerSearchQuery: "",
    messageCount: 2,
  },
  "picker-open": {
    key: "picker-open",
    chatState: "empty",
    sidebarCollapsed: false,
    drawerOpen: false,
    showSidebarTrigger: false,
    offCanvas: false,
    isSending: false,
    hasAttachment: false,
    selectedAgent: "",
    pickerOpen: true,
    pickerSearchQuery: "",
    messageCount: 0,
  },
  "picker-search": {
    key: "picker-search",
    chatState: "empty",
    sidebarCollapsed: false,
    drawerOpen: false,
    showSidebarTrigger: false,
    offCanvas: false,
    isSending: false,
    hasAttachment: false,
    selectedAgent: "",
    pickerOpen: true,
    pickerSearchQuery: "Knowledge",
    messageCount: 0,
  },
  "picker-selected": {
    key: "picker-selected",
    chatState: "empty",
    sidebarCollapsed: false,
    drawerOpen: false,
    showSidebarTrigger: false,
    offCanvas: false,
    isSending: false,
    hasAttachment: false,
    selectedAgent: "KnowledgeAgent",
    pickerOpen: false,
    pickerSearchQuery: "",
    messageCount: 0,
  },
  "sidebar-expanded": {
    key: "sidebar-expanded",
    chatState: "empty",
    sidebarCollapsed: false,
    drawerOpen: false,
    showSidebarTrigger: false,
    offCanvas: false,
    isSending: false,
    hasAttachment: false,
    selectedAgent: "",
    pickerOpen: false,
    pickerSearchQuery: "",
    messageCount: 0,
  },
  "sidebar-compact": {
    key: "sidebar-compact",
    chatState: "empty",
    sidebarCollapsed: true,
    drawerOpen: false,
    showSidebarTrigger: false,
    offCanvas: false,
    isSending: false,
    hasAttachment: false,
    selectedAgent: "",
    pickerOpen: false,
    pickerSearchQuery: "",
    messageCount: 0,
  },
  "sidebar-mobile-closed": {
    key: "sidebar-mobile-closed",
    chatState: "empty",
    sidebarCollapsed: false,
    drawerOpen: false,
    showSidebarTrigger: true,
    offCanvas: true,
    isSending: false,
    hasAttachment: false,
    selectedAgent: "",
    pickerOpen: false,
    pickerSearchQuery: "",
    messageCount: 0,
  },
  "sidebar-mobile-open": {
    key: "sidebar-mobile-open",
    chatState: "empty",
    sidebarCollapsed: false,
    drawerOpen: true,
    showSidebarTrigger: false,
    offCanvas: false,
    isSending: false,
    hasAttachment: false,
    selectedAgent: "",
    pickerOpen: false,
    pickerSearchQuery: "",
    messageCount: 0,
  },
};

export type ResolveChatVisualFixtureOk = {
  ok: true;
  key: ChatVisualFixtureKey;
  locale: ChatVisualLocale;
  theme: ChatVisualTheme;
  fixture: ChatVisualFixtureDefinition;
};

export type ResolveChatVisualFixtureErr = {
  ok: false;
  error: string;
};

export type ResolveChatVisualFixtureResult =
  | ResolveChatVisualFixtureOk
  | ResolveChatVisualFixtureErr;

export function isChatVisualFixtureKey(
  value: string | null | undefined
): value is ChatVisualFixtureKey {
  return (
    typeof value === "string" &&
    (CHAT_VISUAL_FIXTURE_KEYS as readonly string[]).includes(value)
  );
}

export function isChatVisualLocale(
  value: string | null | undefined
): value is ChatVisualLocale {
  return (
    typeof value === "string" &&
    (CHAT_VISUAL_LOCALES as readonly string[]).includes(value)
  );
}

export function isChatVisualTheme(
  value: string | null | undefined
): value is ChatVisualTheme {
  return (
    typeof value === "string" &&
    (CHAT_VISUAL_THEMES as readonly string[]).includes(value)
  );
}

/**
 * Resolve query dimensions. Unknown state/locale/theme is an explicit error —
 * never silently default.
 */
export function resolveChatVisualFixture(
  state: string | null | undefined,
  locale: string | null | undefined,
  theme: string | null | undefined
): ResolveChatVisualFixtureResult {
  if (!isChatVisualFixtureKey(state)) {
    return {
      ok: false,
      error: `Unknown fixture state "${String(
        state
      )}". Expected one of: ${CHAT_VISUAL_FIXTURE_KEYS.join(", ")}.`,
    };
  }
  if (!isChatVisualLocale(locale)) {
    return {
      ok: false,
      error: `Unknown locale "${String(locale)}". Expected en-US|zh-CN.`,
    };
  }
  if (!isChatVisualTheme(theme)) {
    return {
      ok: false,
      error: `Unknown theme "${String(theme)}". Expected light|dark.`,
    };
  }
  return {
    ok: true,
    key: state,
    locale,
    theme,
    fixture: DEFINITIONS[state],
  };
}

export function getChatVisualFixture(
  key: ChatVisualFixtureKey
): ChatVisualFixtureDefinition {
  return DEFINITIONS[key];
}
