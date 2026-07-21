import { computed, ref, type Ref } from "vue";
import request from "@/utils/request";
import {
  CANONICAL_AGENT_TOOLS,
  type CanonicalAgentTool,
} from "@/constants/agents";

export type BotCapabilityExecution = "chat" | "agent_run" | "blocking";

export interface BotCapability {
  tool: CanonicalAgentTool;
  slug: string;
  execution: BotCapabilityExecution;
  stream: boolean;
  a2ui: boolean;
  resolver: boolean;
  attachments: boolean;
  artifacts: boolean;
  enabled: boolean;
}

export type BotCapabilityByTool = Partial<
  Record<CanonicalAgentTool, BotCapability>
>;
export type BotCapabilityBySlug = Record<string, BotCapability>;

export const BOT_CAPABILITIES_URL = "/api/v1/bot/capabilities";
export const MAX_BOT_CAPABILITIES = CANONICAL_AGENT_TOOLS.length;
export const MAX_BOT_CAPABILITY_CACHE_ENTRIES = 32;

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

const cache = new Map<string, BotCapability[]>();

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
    artifacts: false,
    enabled: false,
  };
}

export function disabledBotCapabilities(): BotCapability[] {
  return CANONICAL_AGENT_TOOLS.map((tool) => disabledCapability(tool));
}

function cloneManifest(manifest: readonly BotCapability[]): BotCapability[] {
  return manifest.map((capability) => ({ ...capability }));
}

function isRecord(value: unknown): value is CapabilityRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isBooleanRecord(record: CapabilityRecord, key: string): boolean {
  return typeof record[key] === "boolean";
}

function parseCapabilityResponse(payload: unknown): BotCapability[] {
  if (!isRecord(payload)) return disabledBotCapabilities();

  if ("code" in payload && payload.code !== 200) {
    return disabledBotCapabilities();
  }

  const data = payload.data;
  const records = Array.isArray(data)
    ? data
    : isRecord(data) && Array.isArray(data.capabilities)
    ? data.capabilities
    : null;
  if (!records || records.length > MAX_BOT_CAPABILITIES) {
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

    disabled[index] = {
      tool,
      slug: expectedSlug,
      execution,
      stream: candidate.stream as boolean,
      a2ui: candidate.a2ui as boolean,
      resolver: candidate.resolver as boolean,
      attachments: candidate.attachments as boolean,
      artifacts: candidate.artifacts as boolean,
      enabled: candidate.enabled as boolean,
    };
  }

  return disabled;
}

function setCache(key: string, manifest: readonly BotCapability[]): void {
  if (!cache.has(key) && cache.size >= MAX_BOT_CAPABILITY_CACHE_ENTRIES) {
    const oldest: unknown = cache.keys().next().value;
    if (typeof oldest === "string") cache.delete(oldest);
  }
  cache.set(key, cloneManifest(manifest));
}

export function clearBotCapabilitiesCache(): void {
  cache.clear();
}

export function useBotCapabilities(caller?: CacheKeyInput): {
  capabilities: Ref<BotCapability[]>;
  loading: Ref<boolean>;
  loaded: Ref<boolean>;
  byTool: Readonly<Ref<BotCapabilityByTool>>;
  bySlug: Readonly<Ref<BotCapabilityBySlug>>;
  load: (force?: boolean) => Promise<BotCapability[]>;
} {
  const key = cacheKeyFor(caller);
  const capabilities = ref<BotCapability[]>(disabledBotCapabilities());
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
        capabilities.value = cloneManifest(cached);
        loaded.value = true;
        return cloneManifest(cached);
      }
    }

    loading.value = true;
    try {
      const response = await request<unknown>({
        url: BOT_CAPABILITIES_URL,
        method: "get",
      });
      const parsed = parseCapabilityResponse(response);
      capabilities.value = parsed;
      setCache(key, parsed);
      loaded.value = true;
      return cloneManifest(parsed);
    } catch {
      const fallback = disabledBotCapabilities();
      capabilities.value = fallback;
      setCache(key, fallback);
      loaded.value = true;
      return cloneManifest(fallback);
    } finally {
      loading.value = false;
    }
  };

  return { capabilities, loading, loaded, byTool, bySlug, load };
}
