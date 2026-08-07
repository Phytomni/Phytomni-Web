/** Deterministic synthetic data for the Chat visual fixture harness. */

import type {
  AgentLifecycleVisualFixtureKey,
  ChatVisualFixtureDefinition,
} from "./fixture-registry";
import type { ContentBlock, ChatMessage } from "@/views/chat/types";
import type {
  ResumableUploadItem,
  UploadStatus,
} from "@/views/chat/upload/types";
import type {
  A2uiOpenSurface,
  A2uiSurfaceState,
} from "@/views/chat/streaming/a2uiContract";
import type { ChatAgentPickerOption } from "@/views/chat/components/ChatAgentPicker.vue";
import {
  CANONICAL_AGENT_LABEL_I18N_KEYS,
  CANONICAL_AGENT_DISPLAY_ORDER,
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

type SyntheticLifecycle = {
  id: number;
  phase: "PREPARING" | "RUNNING" | "SUCCEEDED" | "FAILED" | "CANCELLED";
  terminal: boolean;
  child_task_count: number;
  child_work_accepted: boolean;
  report_revision: number;
  artifact_summary: {
    image_count: number;
    output_directory_count: number;
    has_report: boolean;
  };
  reconciliation: "FRESH" | "CACHED" | "DEGRADED";
  tracking_degraded: boolean;
  error_code: "bot_transport_failed" | "run_contract_invalid" | null;
};

type SyntheticAnalystLog = {
  state: "PENDING" | "AVAILABLE" | "TERMINAL_EMPTY" | "DEGRADED";
  source: "BOT_RUN" | "LEGACY_TASK";
  text: string;
  revision: number;
  truncated: boolean;
  can_request_legacy_refresh: boolean;
  error_code: "log_refresh_unavailable" | null;
};

type SyntheticResultArchiveDelivery = {
  schema_version: 1;
  required: true;
  status: "pending" | "ready" | "failed";
  revision: number;
  name: string | null;
  size_bytes: number | null;
  error_code: "archive_generation_failed" | "archive_contract_invalid" | null;
  retryable: boolean;
};

type SyntheticConversationArtifactLink = {
  id: string;
  name: string;
  kind: "archive";
};

const SYNTHETIC_NETWORK_RESULT_DATA_URL =
  "data:image/svg+xml," +
  encodeURIComponent(`
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 360" role="img" aria-labelledby="title desc">
      <title id="title">Synthetic plant gene network</title>
      <desc id="desc">A bounded fixture diagram with six connected genes.</desc>
      <rect width="640" height="360" rx="24" fill="#f7fbf9"/>
      <g stroke="#78a7c8" stroke-width="4" opacity="0.72">
        <path d="M120 180 L250 90 L390 120 L520 190 L400 285 L235 270 Z" fill="none"/>
        <path d="M120 180 L390 120 M250 90 L400 285 M235 270 L520 190" fill="none"/>
      </g>
      <g font-family="Inter,Arial,sans-serif" font-size="18" font-weight="600" text-anchor="middle">
        <g><circle cx="120" cy="180" r="42" fill="#4f8f67"/><text x="120" y="186" fill="white">RGA1</text></g>
        <g><circle cx="250" cy="90" r="38" fill="#3b82a0"/><text x="250" y="96" fill="white">DREB</text></g>
        <g><circle cx="390" cy="120" r="44" fill="#5a9c73"/><text x="390" y="126" fill="white">NAC6</text></g>
        <g><circle cx="520" cy="190" r="39" fill="#397f9d"/><text x="520" y="196" fill="white">WRKY</text></g>
        <g><circle cx="400" cy="285" r="42" fill="#65a67a"/><text x="400" y="291" fill="white">ERF3</text></g>
        <g><circle cx="235" cy="270" r="37" fill="#498ba8"/><text x="235" y="276" fill="white">MYB2</text></g>
      </g>
    </svg>
  `);

export type AgentLifecycleVisualData = {
  message: ChatMessage;
  lifecycle?: SyntheticLifecycle;
  artifactPreview?: {
    title: string;
    kind: string;
    summary: string;
    openLabel: string;
  };
  delivery?: SyntheticResultArchiveDelivery;
  artifactLinks?: SyntheticConversationArtifactLink[];
  geneNetworkImages?: Record<string, string[]>;
  log?: {
    rowId: string;
    taskId: string;
    data: SyntheticAnalystLog;
  };
};

const lifecycle = (
  phase: SyntheticLifecycle["phase"],
  options: {
    imageCount?: number;
    hasReport?: boolean;
    reportRevision?: number;
  } = {}
): SyntheticLifecycle => ({
  id: 901,
  phase,
  terminal: ["SUCCEEDED", "FAILED", "CANCELLED"].includes(phase),
  child_task_count: phase === "PREPARING" ? 0 : 1,
  child_work_accepted: phase !== "PREPARING",
  report_revision: options.reportRevision ?? 0,
  artifact_summary: {
    image_count: options.imageCount ?? 0,
    output_directory_count: 0,
    has_report: options.hasReport ?? false,
  },
  reconciliation: "FRESH",
  tracking_degraded: false,
  error_code: phase === "FAILED" ? "bot_transport_failed" : null,
});

const AGENT_LIFECYCLE_VISUAL_DATA: Record<
  AgentLifecycleVisualFixtureKey,
  AgentLifecycleVisualData
> = {
  "agent-preparing": {
    message: {
      id: "fixture-agent-preparing",
      role: "assistant",
      content: "",
      tool_name: "GeneNetworkAgent",
    },
    lifecycle: lifecycle("PREPARING", { imageCount: 1 }),
  },
  "agent-running-partial": {
    message: {
      id: "fixture-agent-running-partial",
      role: "assistant",
      content:
        "### Partial network report\n\nThe Agent has accepted one bounded analysis step.",
      tool_name: "GeneNetworkAgent",
    },
    lifecycle: lifecycle("RUNNING", {
      imageCount: 1,
      hasReport: true,
      reportRevision: 1,
    }),
  },
  "agent-succeeded-artifacts": {
    message: {
      id: "fixture-agent-succeeded-artifacts",
      role: "assistant",
      content:
        "### Network report\n\nA synthetic regulatory edge passed the fixture threshold.",
      tool_name: "GeneNetworkAgent",
    },
    lifecycle: lifecycle("SUCCEEDED", {
      imageCount: 1,
      hasReport: true,
      reportRevision: 2,
    }),
    geneNetworkImages: {
      "fixture-agent-succeeded-artifacts": [SYNTHETIC_NETWORK_RESULT_DATA_URL],
    },
  },
  "agent-succeeded-empty": {
    message: {
      id: "fixture-agent-succeeded-empty",
      role: "assistant",
      content: "",
      tool_name: "GeneNetworkAgent",
    },
    lifecycle: lifecycle("SUCCEEDED"),
  },
  "agent-failed": {
    message: {
      id: "fixture-agent-failed",
      role: "assistant",
      content: "",
      tool_name: "DigitalDesignAgent",
    },
    lifecycle: lifecycle("FAILED"),
  },
  "agent-delivery-pending": {
    message: {
      id: "fixture-agent-delivery-pending",
      role: "assistant",
      content:
        "### Analysis report\n\nThe scientific report remains available while delivery is prepared.",
      tool_name: "AnalystAgent",
    },
    lifecycle: lifecycle("SUCCEEDED", { hasReport: true, reportRevision: 2 }),
    delivery: {
      schema_version: 1,
      required: true,
      status: "pending",
      revision: 2,
      name: null,
      size_bytes: null,
      error_code: null,
      retryable: false,
    },
  },
  "agent-delivery-ready": {
    message: {
      id: "fixture-agent-delivery-ready",
      role: "assistant",
      content:
        "### Analysis report\n\nThe scientific report remains visible with one result archive.",
      tool_name: "InSilicoResearchAgent",
    },
    lifecycle: lifecycle("SUCCEEDED", { hasReport: true, reportRevision: 2 }),
    delivery: {
      schema_version: 1,
      required: true,
      status: "ready",
      revision: 2,
      name: "research-results.zip",
      size_bytes: 2048,
      error_code: null,
      retryable: false,
    },
    artifactLinks: [
      {
        id: "fixture-archive-ready",
        name: "research-results.zip",
        kind: "archive",
      },
    ],
  },
  "agent-delivery-retryable": {
    message: {
      id: "fixture-agent-delivery-retryable",
      role: "assistant",
      content:
        "### Analysis report\n\nThe scientific report remains visible after archive generation failed.",
      tool_name: "GeneNetworkAgent",
    },
    lifecycle: lifecycle("SUCCEEDED", { hasReport: true, reportRevision: 2 }),
    delivery: {
      schema_version: 1,
      required: true,
      status: "failed",
      revision: 2,
      name: null,
      size_bytes: null,
      error_code: "archive_generation_failed",
      retryable: true,
    },
  },
  "agent-delivery-nonretryable": {
    message: {
      id: "fixture-agent-delivery-nonretryable",
      role: "assistant",
      content:
        "### Analysis report\n\nThe scientific report remains visible when archive delivery cannot continue.",
      tool_name: "DigitalDesignAgent",
    },
    lifecycle: lifecycle("SUCCEEDED", { hasReport: true, reportRevision: 2 }),
    delivery: {
      schema_version: 1,
      required: true,
      status: "failed",
      revision: 2,
      name: null,
      size_bytes: null,
      error_code: "archive_contract_invalid",
      retryable: false,
    },
  },
  "review-confirm-fallback": {
    message: {
      id: "fixture-review-confirm-fallback",
      role: "assistant",
      content: "",
      tool_name: "ReviewAgent",
      blocks: [
        {
          type: "agent-surface",
          authority: "agent",
          interactive: true,
          a2ui: {
            surface: {
              catalog_version: "v1.0",
              surface_id: "fixture-review-confirm-fallback",
              widget: "confirm",
              props: {
                title: "Continue the synthetic review?",
                body: "This fixture intentionally omits optional action copy.",
              },
            },
            state: { status: "ready", round: 1 },
          },
        },
      ],
    },
  },
  "analyst-log-pending": {
    message: {
      id: "fixture-analyst-log-pending",
      role: "assistant",
      content: "The synthetic analysis request was accepted.",
      tool_name: "AnalystAgent",
      task_id: "fixture-analyst-task-pending",
    },
    lifecycle: lifecycle("RUNNING"),
    log: {
      rowId: "902",
      taskId: "fixture-analyst-task-pending",
      data: {
        state: "PENDING",
        source: "BOT_RUN",
        text: "",
        revision: 0,
        truncated: false,
        can_request_legacy_refresh: false,
        error_code: null,
      },
    },
  },
  "analyst-log-available": {
    message: {
      id: "fixture-analyst-log-available",
      role: "assistant",
      content: "The synthetic analysis report is available.",
      tool_name: "AnalystAgent",
      task_id: "fixture-analyst-task-available",
    },
    lifecycle: lifecycle("SUCCEEDED", {
      hasReport: true,
      reportRevision: 2,
    }),
    log: {
      rowId: "903",
      taskId: "fixture-analyst-task-available",
      data: {
        state: "AVAILABLE",
        source: "BOT_RUN",
        text: "[INFO] Synthetic analysis initialized.\n[DONE] Fixture report ready.",
        revision: 2,
        truncated: false,
        can_request_legacy_refresh: false,
        error_code: null,
      },
    },
  },
  "deep-genome-preparing": {
    message: {
      id: "901",
      role: "assistant",
      content: "Server task created: synthetic-child",
      status: "RUNNING",
      tool_name: "DeepGenomeAgent",
    },
    lifecycle: lifecycle("PREPARING"),
  },
  "deep-genome-running-partial": {
    message: {
      id: "902",
      role: "assistant",
      content:
        "### Synthetic partial report\n\nOne bounded analysis section is available.",
      status: "RUNNING",
      tool_name: "DeepGenomeAgent",
      doc_list: [],
    },
    lifecycle: lifecycle("RUNNING", {
      hasReport: true,
      reportRevision: 1,
    }),
  },
  "deep-genome-succeeded": {
    message: {
      id: "903",
      role: "assistant",
      content:
        "### Synthetic final report\n\nThe deterministic fixture report is complete.",
      status: "SUCCEEDED",
      tool_name: "DeepGenomeAgent",
      doc_list: [],
    },
    lifecycle: lifecycle("SUCCEEDED", {
      hasReport: true,
      reportRevision: 2,
    }),
    artifactPreview: {
      title: "Finished",
      kind: "Deep Genome Agent",
      summary: "Synthetic deep genome report",
      openLabel: "View",
    },
  },
};

export function getAgentLifecycleVisualData(
  key: AgentLifecycleVisualFixtureKey
): AgentLifecycleVisualData {
  return AGENT_LIFECYCLE_VISUAL_DATA[key];
}

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
  if (fixture.key in AGENT_LIFECYCLE_VISUAL_DATA) {
    return [
      AGENT_LIFECYCLE_VISUAL_DATA[fixture.key as AgentLifecycleVisualFixtureKey]
        .message,
    ];
  }
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
): ResumableUploadItem[] {
  if (!fixture.hasAttachment) {
    return [];
  }
  const status: UploadStatus = fixture.uploadStatus ?? "completed";
  const size = 1024 * 1024;

  const buildItem = (
    localId: string,
    name: string,
    itemStatus: UploadStatus,
    type = "text/plain"
  ): ResumableUploadItem => {
    const loadedBytes =
      itemStatus === "completed"
        ? size
        : itemStatus === "uploading"
          ? 256 * 1024
          : itemStatus === "paused" ||
              itemStatus === "failed" ||
              itemStatus === "expired"
            ? 512 * 1024
            : 0;
    const blob = new File(["synthetic fixture attachment contents"], name, {
      type,
    });
    return {
      localId,
      file: blob,
      assetId: itemStatus === "completed" ? `asset-${localId}` : null,
      name,
      size,
      type,
      lastModified: 1_700_000_000_000,
      status: itemStatus,
      partSize: size,
      partCount: 1,
      receivedParts: itemStatus === "completed" ? [1] : [],
      loadedBytes,
      speedBytesPerSecond: itemStatus === "uploading" ? 256 * 1024 : 0,
      etaSeconds: itemStatus === "uploading" ? 3 : null,
      retryCount: itemStatus === "failed" || itemStatus === "expired" ? 1 : 0,
      errorCode:
        itemStatus === "failed"
          ? "upload_failed"
          : itemStatus === "expired"
            ? "upload_session_expired"
            : null,
    };
  };

  if (fixture.key === "uploading-detail-open") {
    return [
      buildItem(
        "fixture-upload-detail",
        "fixture-reads.fastq.gz",
        "uploading",
        "application/gzip"
      ),
    ];
  }

  if (fixture.key === "mixed-ready-failed-expired") {
    return [
      buildItem(
        "fixture-upload-ready",
        "fixture-report.pdf",
        "completed",
        "application/pdf"
      ),
      buildItem(
        "fixture-upload-failed",
        "fixture-counts.tsv",
        "failed",
        "text/tab-separated-values"
      ),
      buildItem(
        "fixture-upload-expired",
        "fixture-archive.fastq.gz",
        "expired",
        "application/gzip"
      ),
    ];
  }

  if (fixture.key === "ten-files-overflow") {
    return Array.from({ length: 10 }, (_value, index) =>
      buildItem(
        `fixture-upload-${index + 1}`,
        `fixture-file-${String(index + 1).padStart(2, "0")}.txt`,
        "completed"
      )
    );
  }

  return [buildItem("fixture-upload-local", SYNTHETIC_FILE_NAME, status)];
}

/** Deterministic picker options — no roles API / network. */
export function buildSyntheticPickerOptions(
  translate: (key: string) => string = (key) => key
): ChatAgentPickerOption[] {
  return CANONICAL_AGENT_DISPLAY_ORDER.map((tool) => ({
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
  "uploading-detail-open": "",
  "mixed-ready-failed-expired": "",
  "ten-files-overflow": "",
  "incompatible-agent-blocked": "Synthetic incompatible attachment draft",
  sending: "Synthetic sending draft",
  "picker-open": "",
  "picker-search": "",
  "picker-selected": "@KnowledgeAgent,",
  "sidebar-expanded": "",
  "sidebar-compact": "",
  "sidebar-mobile-closed": "",
  "sidebar-mobile-open": "",
  "agent-preview": "",
  "sidebar-compact-explore-open": "",
  "history-title-only": "",
  "history-loading": "",
  "history-empty": "",
  "history-error": "",
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
