/** Deterministic synthetic data for the Chat visual fixture harness. */

import type { ChatVisualFixtureDefinition } from "./fixture-registry";
import type { ContentBlock, UploadFile, ChatMessage } from "@/views/chat/types";
import type {
  A2uiOpenSurface,
  A2uiSurfaceState,
} from "@/views/chat/streaming/a2uiContract";
import type { ChatAgentPickerOption } from "@/views/chat/components/ChatAgentPicker.vue";
import {
  CANONICAL_AGENT_TOOLS,
  CANONICAL_AGENT_LABEL_I18N_KEYS,
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
  if (isA2uiLifecycleFixtureKey(fixture.key)) {
    return buildA2uiLifecycleMessages();
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
export function buildSyntheticPickerOptions(
  translate: (key: string) => string = (key) => key
): ChatAgentPickerOption[] {
  return CANONICAL_AGENT_TOOLS.map((tool) => ({
    tool,
    labelKey: CANONICAL_AGENT_LABEL_I18N_KEYS[tool],
    label: translate(CANONICAL_AGENT_LABEL_I18N_KEYS[tool]),
  }));
}

export const A2UI_LIFECYCLE_LONG_LABEL = "L".repeat(256);
export const A2UI_LIFECYCLE_LONG_BODY = "B".repeat(4096);

const A2UI_LIFECYCLE_KEY = "a2ui-lifecycle" as const;

function buildA2uiSurfaceBlock(
  surface: A2uiOpenSurface,
  state: A2uiSurfaceState
): ContentBlock {
  return {
    type: "agent-surface",
    authority: "agent",
    interactive: true,
    a2ui: { surface, state },
  };
}

export function buildA2uiLifecycleMessages(): ChatMessage[] {
  const confirmSurface: A2uiOpenSurface = {
    catalog_version: "v1.0",
    surface_id: "fixture-a2ui-confirm-ready",
    widget: "confirm",
    props: {
      title: "Continue with this fixture?",
      body: A2UI_LIFECYCLE_LONG_BODY,
      confirm_label: "Continue",
      cancel_label: "Dismiss",
    },
  };
  const formSurface: A2uiOpenSurface = {
    catalog_version: "v1.0",
    surface_id: "fixture-a2ui-form-submitting",
    widget: "form",
    props: {
      title: "Structured input",
      fields: [
        {
          name: "fixture_value",
          label: A2UI_LIFECYCLE_LONG_LABEL,
          type: "text",
          required: true,
        },
      ],
    },
  };
  const choiceSurface: A2uiOpenSurface = {
    catalog_version: "v1.0",
    surface_id: "fixture-a2ui-choice-resolved",
    widget: "choice",
    props: {
      title: "Select a fixture option",
      options: [
        { id: "option-a", label: "Option A" },
        { id: "option-b", label: "Option B" },
      ],
      multiple: false,
    },
  };
  const retrySurface: A2uiOpenSurface = {
    catalog_version: "v1.0",
    surface_id: "fixture-a2ui-retry",
    widget: "confirm",
    props: {
      title: "Retryable fixture action",
      confirm_label: "Continue",
      cancel_label: "Dismiss",
    },
  };
  const unknownSurface: A2uiOpenSurface = {
    catalog_version: "v1.0",
    surface_id: "fixture-a2ui-unknown",
    widget: "confirm",
    props: {
      title: "Unknown fixture outcome",
      confirm_label: "Continue",
      cancel_label: "Dismiss",
    },
  };
  const roundOneSurface: A2uiOpenSurface = {
    catalog_version: "v1.0",
    surface_id: "fixture-a2ui-round-one",
    widget: "choice",
    props: {
      title: "First fixture round",
      options: [{ id: "next", label: "Continue" }],
      multiple: false,
    },
  };
  const roundTwoSurface: A2uiOpenSurface = {
    catalog_version: "v1.0",
    surface_id: "fixture-a2ui-round-two",
    widget: "choice",
    props: {
      title: "Second fixture round",
      options: [{ id: "finish", label: "Finish" }],
      multiple: false,
    },
  };
  const submittingEnvelope = {
    surface_id: formSurface.surface_id,
    widget: formSurface.widget,
    action_id: "fixture-a2ui-form-action",
    run_id: "fixture-a2ui-runtime",
    payload: { fields: { fixture_value: "synthetic" } },
  } as const;
  const retryEnvelope = {
    surface_id: retrySurface.surface_id,
    widget: retrySurface.widget,
    action_id: "fixture-a2ui-retry-action",
    run_id: "fixture-a2ui-runtime",
    payload: { accepted: true },
  } as const;

  const blocks: ContentBlock[] = [
    buildA2uiSurfaceBlock(confirmSurface, { status: "ready", round: 1 }),
    buildA2uiSurfaceBlock(formSurface, {
      status: "submitting",
      round: 1,
      envelope: submittingEnvelope,
    }),
    buildA2uiSurfaceBlock(choiceSurface, {
      status: "resolved",
      round: 1,
      actionId: "fixture-a2ui-choice-action",
      resolution: "submitted",
    }),
    buildA2uiSurfaceBlock(retrySurface, {
      status: "temporarily_rejected",
      round: 1,
      envelope: retryEnvelope,
      code: "fixture_gateway_disabled",
    }),
    buildA2uiSurfaceBlock(unknownSurface, {
      status: "unknown",
      round: 1,
      actionId: "fixture-a2ui-unknown-action",
      code: "fixture_unknown_outcome",
    }),
    buildA2uiSurfaceBlock(roundOneSurface, {
      status: "resolved",
      round: 1,
      actionId: "fixture-a2ui-round-one-action",
      resolution: "advanced",
    }),
    buildA2uiSurfaceBlock(roundTwoSurface, { status: "ready", round: 2 }),
  ];

  return [
    {
      id: "fixture-msg-a2ui-lifecycle",
      role: "assistant",
      content: "",
      streaming: false,
      blocks,
    },
  ];
}

export function isA2uiLifecycleFixtureKey(
  key: string
): key is typeof A2UI_LIFECYCLE_KEY {
  return key === A2UI_LIFECYCLE_KEY;
}

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
  "a2ui-lifecycle": "",
  "send-stop": "Synthetic stop draft",
  "parallel-a": "Synthetic dialogue A draft",
  "parallel-b": "Synthetic dialogue B draft",
};
