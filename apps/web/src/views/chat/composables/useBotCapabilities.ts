import { computed, ref, type Ref } from "vue";
import request from "@/utils/request";
import type { BotUploadCapability } from "@/api/types";
import {
  CANONICAL_AGENT_TOOLS,
  type CanonicalAgentTool,
} from "@/constants/agents";
import type { UploadPurpose } from "../upload/types";

export type BotCapabilityExecution = "chat" | "agent_run" | "blocking";

export interface BotCapability {
  tool: CanonicalAgentTool;
  slug: string;
  execution: BotCapabilityExecution;
  stream: boolean;
  a2ui: boolean;
  resolver: boolean;
  attachments: boolean;
  attachmentPurposes: UploadPurpose[];
  artifacts: boolean;
  enabled: boolean;
}

export type { BotUploadCapability } from "@/api/types";

export interface BotCapabilityManifest {
  agents: BotCapability[];
  upload: BotUploadCapability;
}

export type BotCapabilityByTool = Partial<
  Record<CanonicalAgentTool, BotCapability>
>;
export type BotCapabilityBySlug = Record<string, BotCapability>;

export const BOT_CAPABILITIES_URL = "/api/v1/bot/capabilities";
export const MAX_BOT_CAPABILITIES = CANONICAL_AGENT_TOOLS.length;
export const MAX_BOT_CAPABILITY_CACHE_ENTRIES = 32;
export const RESUMABLE_UPLOAD_PROTOCOL = "obs-multipart-v2";
export const RESUMABLE_UPLOAD_MAX_FILE_BYTES = 10 * 1024 * 1024 * 1024;
export const RESUMABLE_UPLOAD_MAX_ATTACHMENTS = 10;

const TOOL_TO_SLUG: Record<CanonicalAgentTool, string> = {
  ChatAgent: "chat",
  KnowledgeAgent: "knowledge",
  DataAgent: "data",
  ReviewAgent: "review",
  BriefGeneAgent: "brief_gene",
  AnalystAgent: "analyst",
  DeepGenomeAgent: "deep_genome",
  InSilicoResearchAgent: "research",
  DigitalDesignAgent: "design",
  GeneNetworkAgent: "network",
};

const EXECUTION_BY_TOOL: Record<CanonicalAgentTool, BotCapabilityExecution> = {
  ChatAgent: "chat",
  KnowledgeAgent: "chat",
  DataAgent: "blocking",
  ReviewAgent: "chat",
  BriefGeneAgent: "agent_run",
  AnalystAgent: "agent_run",
  DeepGenomeAgent: "agent_run",
  InSilicoResearchAgent: "agent_run",
  DigitalDesignAgent: "agent_run",
  GeneNetworkAgent: "agent_run",
};

type CapabilityRecord = Record<string, unknown>;
type CacheKeyInput = string | { cacheKey?: string } | undefined;

const cache = new Map<string, BotCapabilityManifest>();

function cacheKeyFor(input: CacheKeyInput): string {
  if (typeof input === "string" && input.trim() !== "") {
    return input.trim().slice(0, 128);
  }
  if (
    input &&
    typeof input === "object" &&
    typeof input.cacheKey === "string"
  ) {
    const value = input.cacheKey.trim();
    if (value !== "") return value.slice(0, 128);
  }
  return "default";
}

function disabledCapability(tool: CanonicalAgentTool): BotCapability {
  return {
    tool,
    slug: TOOL_TO_SLUG[tool],
    execution: EXECUTION_BY_TOOL[tool],
    stream: false,
    a2ui: false,
    resolver: false,
    attachments: false,
    attachmentPurposes: [],
    artifacts: false,
    enabled: false,
  };
}

export function disabledBotCapabilities(): BotCapability[] {
  return CANONICAL_AGENT_TOOLS.map((tool) => disabledCapability(tool));
}

function cloneManifest(manifest: readonly BotCapability[]): BotCapability[] {
  return manifest.map((capability) => ({
    ...capability,
    attachmentPurposes: [...capability.attachmentPurposes],
  }));
}

function cloneUploadCapability(
  capability: BotUploadCapability
): BotUploadCapability {
  return { ...capability };
}

function cloneCapabilityManifest(
  manifest: BotCapabilityManifest
): BotCapabilityManifest {
  return {
    agents: cloneManifest(manifest.agents),
    upload: cloneUploadCapability(manifest.upload),
  };
}

function isRecord(value: unknown): value is CapabilityRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isBooleanRecord(record: CapabilityRecord, key: string): boolean {
  return typeof record[key] === "boolean";
}

function parseAttachmentPurposes(value: unknown): UploadPurpose[] {
  if (!Array.isArray(value)) return [];
  const parsed: UploadPurpose[] = [];
  for (const item of value) {
    if ((item !== "dataset" && item !== "document") || parsed.includes(item)) {
      return [];
    }
    parsed.push(item);
  }
  return parsed;
}

export function disabledBotUploadCapability(): BotUploadCapability {
  return {
    enabled: false,
    protocol: RESUMABLE_UPLOAD_PROTOCOL,
    upload_origin: "",
    max_file_bytes: RESUMABLE_UPLOAD_MAX_FILE_BYTES,
    max_attachments: RESUMABLE_UPLOAD_MAX_ATTACHMENTS,
  };
}

function isValidUploadOrigin(value: string): boolean {
  try {
    const origin = new URL(value);
    return (
      (origin.protocol === "http:" || origin.protocol === "https:") &&
      origin.hostname !== "" &&
      origin.username === "" &&
      origin.password === "" &&
      origin.search === "" &&
      origin.hash === "" &&
      (origin.pathname === "" || origin.pathname === "/")
    );
  } catch {
    return false;
  }
}

function parseUploadCapability(value: unknown): BotUploadCapability {
  const disabled = disabledBotUploadCapability();
  if (!isRecord(value)) return disabled;
  if (
    value.protocol !== RESUMABLE_UPLOAD_PROTOCOL ||
    typeof value.enabled !== "boolean" ||
    typeof value.upload_origin !== "string" ||
    typeof value.max_file_bytes !== "number" ||
    !Number.isSafeInteger(value.max_file_bytes) ||
    value.max_file_bytes < 1 ||
    value.max_file_bytes > RESUMABLE_UPLOAD_MAX_FILE_BYTES ||
    typeof value.max_attachments !== "number" ||
    !Number.isSafeInteger(value.max_attachments) ||
    value.max_attachments < 1 ||
    value.max_attachments > RESUMABLE_UPLOAD_MAX_ATTACHMENTS
  ) {
    return disabled;
  }
  if (value.enabled && !isValidUploadOrigin(value.upload_origin as string)) {
    return disabled;
  }
  if (!value.enabled && value.upload_origin !== "") return disabled;
  return {
    enabled: value.enabled as boolean,
    protocol: RESUMABLE_UPLOAD_PROTOCOL,
    upload_origin: value.upload_origin as string,
    max_file_bytes: value.max_file_bytes as number,
    max_attachments: value.max_attachments as number,
  };
}

function parseAgentCapabilities(records: unknown): BotCapability[] {
  if (!Array.isArray(records) || records.length > MAX_BOT_CAPABILITIES) {
    return disabledBotCapabilities();
  }

  const disabled = disabledBotCapabilities();
  const indexByTool = new Map<CanonicalAgentTool, number>(
    CANONICAL_AGENT_TOOLS.map((tool, index) => [tool, index])
  );
  const seen = new Set<CanonicalAgentTool>();

  for (const candidate of records) {
    if (!isRecord(candidate) || typeof candidate.tool !== "string") continue;
    const tool = candidate.tool as CanonicalAgentTool;
    const index = indexByTool.get(tool);
    if (index === undefined || seen.has(tool)) continue;
    seen.add(tool);

    const expectedSlug = TOOL_TO_SLUG[tool];
    const execution = candidate.execution;
    if (
      candidate.slug !== expectedSlug ||
      (execution !== "chat" &&
        execution !== "agent_run" &&
        execution !== "blocking") ||
      !isBooleanRecord(candidate, "stream") ||
      !isBooleanRecord(candidate, "a2ui") ||
      !isBooleanRecord(candidate, "resolver") ||
      !isBooleanRecord(candidate, "attachments") ||
      !isBooleanRecord(candidate, "artifacts") ||
      !isBooleanRecord(candidate, "enabled")
    ) {
      continue;
    }

    const enabled = candidate.enabled as boolean;
    const attachments = candidate.attachments as boolean;
    disabled[index] = {
      tool,
      slug: expectedSlug,
      execution,
      stream: candidate.stream as boolean,
      a2ui: candidate.a2ui as boolean,
      resolver: candidate.resolver as boolean,
      attachments,
      attachmentPurposes:
        enabled && attachments
          ? parseAttachmentPurposes(candidate.attachment_purposes)
          : [],
      artifacts: candidate.artifacts as boolean,
      enabled,
    };
  }

  return disabled;
}

function applyUploadAttachmentPolicy(
  agents: BotCapability[],
  upload: BotUploadCapability
): BotCapability[] {
  if (upload.enabled) return agents;
  return agents.map((agent) =>
    agent.attachments || agent.attachmentPurposes.length > 0
      ? { ...agent, attachments: false, attachmentPurposes: [] }
      : agent
  );
}

export function parseCapabilityResponse(
  payload: unknown
): BotCapabilityManifest {
  const fallback: BotCapabilityManifest = {
    agents: disabledBotCapabilities(),
    upload: disabledBotUploadCapability(),
  };
  if (!isRecord(payload) || ("code" in payload && payload.code !== 200)) {
    return fallback;
  }
  if (!isRecord(payload.data)) return fallback;
  const upload = parseUploadCapability(payload.data.upload);
  return {
    agents: applyUploadAttachmentPolicy(
      parseAgentCapabilities(payload.data.agents),
      upload
    ),
    upload,
  };
}

function setCache(key: string, manifest: BotCapabilityManifest): void {
  if (!cache.has(key) && cache.size >= MAX_BOT_CAPABILITY_CACHE_ENTRIES) {
    const oldest: unknown = cache.keys().next().value;
    if (typeof oldest === "string") cache.delete(oldest);
  }
  cache.set(key, cloneCapabilityManifest(manifest));
}

export function clearBotCapabilitiesCache(): void {
  cache.clear();
}

export function useBotCapabilities(caller?: CacheKeyInput): {
  capabilities: Ref<BotCapability[]>;
  upload: Ref<BotUploadCapability>;
  loading: Ref<boolean>;
  loaded: Ref<boolean>;
  byTool: Readonly<Ref<BotCapabilityByTool>>;
  bySlug: Readonly<Ref<BotCapabilityBySlug>>;
  load: (force?: boolean) => Promise<BotCapability[]>;
} {
  const key = cacheKeyFor(caller);
  const capabilities = ref<BotCapability[]>(disabledBotCapabilities());
  const upload = ref<BotUploadCapability>(disabledBotUploadCapability());
  const loading = ref(false);
  const loaded = ref(false);

  const byTool = computed<BotCapabilityByTool>(() => {
    const result: BotCapabilityByTool = {};
    for (const capability of capabilities.value) {
      result[capability.tool] = capability;
    }
    return result;
  });
  const bySlug = computed<BotCapabilityBySlug>(() => {
    const result: BotCapabilityBySlug = {};
    for (const capability of capabilities.value) {
      result[capability.slug] = capability;
    }
    return result;
  });

  const load = async (force = false): Promise<BotCapability[]> => {
    if (!force) {
      const cached = cache.get(key);
      if (cached) {
        const cloned = cloneCapabilityManifest(cached);
        capabilities.value = cloned.agents;
        upload.value = cloned.upload;
        loaded.value = true;
        return cloneManifest(cloned.agents);
      }
    }

    loading.value = true;
    try {
      const response = await request<unknown>({
        url: BOT_CAPABILITIES_URL,
        method: "get",
      });
      const parsed = parseCapabilityResponse(response);
      capabilities.value = parsed.agents;
      upload.value = parsed.upload;
      setCache(key, parsed);
      loaded.value = true;
      return cloneManifest(parsed.agents);
    } catch {
      const fallback: BotCapabilityManifest = {
        agents: disabledBotCapabilities(),
        upload: disabledBotUploadCapability(),
      };
      capabilities.value = fallback.agents;
      upload.value = fallback.upload;
      setCache(key, fallback);
      loaded.value = true;
      return cloneManifest(fallback.agents);
    } finally {
      loading.value = false;
    }
  };

  return { capabilities, upload, loading, loaded, byTool, bySlug, load };
}
