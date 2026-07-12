/** Deterministic synthetic data for the Chat visual fixture harness. */

import type { ChatVisualFixtureDefinition } from "./fixture-registry";
import type { UploadFile, ChatMessage } from "@/views/chat/types";
import type { ChatAgentPickerOption } from "@/views/chat/components/ChatAgentPicker.vue";
import {
  CANONICAL_AT_ABLE_TOOLS,
  CANONICAL_AGENT_DISPLAY_NAMES,
  CANONICAL_AGENT_I18N_KEYS,
} from "@/constants/agents";
import {
  isPhase3BMessageKey,
  buildPhase3BTranscript,
  MESSAGE_FIXTURES,
  MESSAGE_IMAGE,
  FIXTURE_GENE_NETWORK_IMAGE_DATA_URL,
  isPhase3CFixtureKey,
  buildPhase3CTranscript,
  getPhase3COverlay,
  type Phase3BMessageKey,
  type Phase3CFixtureKey,
} from "../../fixtures/chat";

/** Exact visible identity for harness and redaction scripts. */
export const SYNTHETIC_IDENTITY = "Synthetic user";

/** Local non-production identifiers — never server-derived. */
export const SYNTHETIC_DIALOGUE_ID = "fixture-dialogue-local";
export const SYNTHETIC_MESSAGE_IDS = [
  "fixture-msg-user-1",
  "fixture-msg-assistant-1",
] as const;
export const SYNTHETIC_FILE_NAME = "fixture-attachment-local.txt";

export type SyntheticMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
};

export function buildSyntheticMessages(
  fixture: ChatVisualFixtureDefinition
): SyntheticMessage[] {
  if (fixture.messageCount <= 0) {
    return [];
  }
  const rows: SyntheticMessage[] = [
    {
      id: SYNTHETIC_MESSAGE_IDS[0],
      role: "user",
      content: "Synthetic fixture user question about plant genomics.",
    },
    {
      id: SYNTHETIC_MESSAGE_IDS[1],
      role: "assistant",
      content: "Synthetic fixture assistant reply. No backend task completed.",
    },
  ];
  return rows.slice(0, fixture.messageCount);
}

/**
 * Phase 3B/3C keys reuse shared fixture objects (same references as Vitest).
 * Frame keys keep the simple synthetic rows.
 */
export function buildHarnessMessages(
  fixture: ChatVisualFixtureDefinition
): ChatMessage[] | SyntheticMessage[] {
  if (isPhase3BMessageKey(fixture.key)) {
    return buildPhase3BTranscript(fixture.key);
  }
  if (isPhase3CFixtureKey(fixture.key)) {
    const overlay = getPhase3COverlay(fixture.key);
    if (overlay.assistantMessage) {
      return buildPhase3CTranscript(fixture.key);
    }
    // Progress / transfer / send-stop: frame rows + overlay widgets.
    return buildSyntheticMessages(fixture);
  }
  return buildSyntheticMessages(fixture);
}

/** Same object identity Vitest imports — fails if harness copied bodies. */
export function getSharedMessageFixture(key: Phase3BMessageKey): ChatMessage {
  return MESSAGE_FIXTURES[key];
}

export function getSharedPhase3COverlay(key: Phase3CFixtureKey) {
  return getPhase3COverlay(key);
}

export function buildSyntheticFileList(
  fixture: ChatVisualFixtureDefinition
): UploadFile[] {
  if (!fixture.hasAttachment) {
    return [];
  }
  const blob = new File(
    ["synthetic fixture attachment contents"],
    SYNTHETIC_FILE_NAME,
    { type: "text/plain" }
  );
  return [
    {
      name: SYNTHETIC_FILE_NAME,
      size: blob.size,
      type: "text/plain",
      file: blob,
    },
  ];
}

/** Deterministic picker options — no roles API / network. */
export function buildSyntheticPickerOptions(): ChatAgentPickerOption[] {
  return CANONICAL_AT_ABLE_TOOLS.map((tool) => ({
    tool,
    labelKey: CANONICAL_AGENT_I18N_KEYS[tool],
    label: CANONICAL_AGENT_DISPLAY_NAMES[tool],
  }));
}

export const SYNTHETIC_ROLES_TOOL: string[] = [...CANONICAL_AT_ABLE_TOOLS];

/** GeneNetwork image map for the `image` fixture — data URL, no network. */
export function buildFixtureGeneNetworkImages(): Record<string, string[]> {
  const id = MESSAGE_IMAGE.id ?? "fixture-msg-image";
  return { [id]: [FIXTURE_GENE_NETWORK_IMAGE_DATA_URL] };
}

export const COMPOSER_MODEL_VALUE_BY_KEY: Partial<
  Record<ChatVisualFixtureDefinition["key"], string>
> = {
  empty: "",
  populated: "",
  attachment: "",
  sending: "Synthetic sending draft",
  "picker-open": "",
  "picker-search": "",
  "picker-selected": "@KnowledgeAgent,",
  "sidebar-expanded": "",
  "sidebar-compact": "",
  "sidebar-mobile-closed": "",
  "sidebar-mobile-open": "",
  "short-generic": "",
  "long-generic": "",
  cited: "",
  "deep-genome": "",
  table: "",
  steps: "",
  image: "",
  streaming: "",
  "interleaved-streaming": "",
  "activity-closed": "",
  "activity-open": "",
  "log-loading": "",
  "log-populated": "",
  "log-error": "",
  "log-missing-task": "",
  "progress-fast": "Synthetic progress draft",
  "progress-slow": "Synthetic progress draft",
  "progress-completing": "Synthetic progress draft",
  "transfer-real": "Synthetic transfer draft",
  "a2ui-required": "",
  "send-stop": "Synthetic stop draft",
  "parallel-a": "Synthetic dialogue A draft",
  "parallel-b": "Synthetic dialogue B draft",
};
