/** Deterministic synthetic data for the Chat visual fixture harness. */

import type { ChatVisualFixtureDefinition } from "./fixture-registry";
import type { UploadFile } from "@/views/chat/types";
import type { ChatAgentPickerOption } from "@/views/chat/components/ChatAgentPicker.vue";
import {
  CANONICAL_AT_ABLE_TOOLS,
  CANONICAL_AGENT_DISPLAY_NAMES,
  CANONICAL_AGENT_I18N_KEYS,
} from "@/constants/agents";

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
};
