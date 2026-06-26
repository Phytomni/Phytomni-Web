import { describe, expect, it } from "vitest";
import {
  CANONICAL_AGENT_DISPLAY_NAMES,
  CANONICAL_AGENT_I18N_KEYS,
  CANONICAL_AGENT_PAGE_TITLE_KEYS,
  CANONICAL_AGENT_TOOLS,
  CANONICAL_AGENT_ZH_NAMES,
} from "@/constants/agents";
import enUS from "@/locales/langs/en-US";
import zhCN from "@/locales/langs/zh-CN";

const getMessage = (messages: unknown, path: string) =>
  path.split(".").reduce<unknown>((node, key) => {
    if (node && typeof node === "object" && key in node) {
      return (node as Record<string, unknown>)[key];
    }
    return undefined;
  }, messages);

describe("canonical agent locale names", () => {
  it("keeps every canonical tool mapped to one stable chat-agent i18n key", () => {
    expect(Object.keys(CANONICAL_AGENT_I18N_KEYS).sort()).toEqual(
      [...CANONICAL_AGENT_TOOLS].sort()
    );
    expect(CANONICAL_AGENT_I18N_KEYS.BriefGeneAgent).toBe(
      "chat.agents.briefGeneAgent"
    );
  });

  it("has Chinese and English copy for every canonical chat-agent i18n key", () => {
    for (const toolName of CANONICAL_AGENT_TOOLS) {
      const i18nKey = CANONICAL_AGENT_I18N_KEYS[toolName];
      expect(getMessage(zhCN, i18nKey), `${toolName} zh-CN`).toEqual(
        expect.any(String)
      );
      expect(getMessage(enUS, i18nKey), `${toolName} en-US`).toEqual(
        expect.any(String)
      );
    }
  });

  it("keeps routed agent page titles aligned in Chinese and English", () => {
    for (const [toolName, titleKey] of Object.entries(
      CANONICAL_AGENT_PAGE_TITLE_KEYS
    )) {
      const canonicalTool = toolName as keyof typeof CANONICAL_AGENT_PAGE_TITLE_KEYS;
      expect(getMessage(zhCN, titleKey), `${toolName} zh-CN title`).toBe(
        CANONICAL_AGENT_ZH_NAMES[canonicalTool]
      );
      expect(getMessage(enUS, titleKey), `${toolName} en-US title`).toBe(
        CANONICAL_AGENT_DISPLAY_NAMES[canonicalTool]
      );
    }
  });

  it("keeps product-approved Chinese display names for renamed agents", () => {
    expect(CANONICAL_AGENT_ZH_NAMES.ChatAgent).toBe("对话智能体");
    expect(CANONICAL_AGENT_ZH_NAMES.BriefGeneAgent).toBe("基因综述智能体");
    expect(CANONICAL_AGENT_ZH_NAMES.DeepGenomeAgent).toBe(
      "基因深度分析智能体"
    );
    expect(CANONICAL_AGENT_ZH_NAMES.InSilicoResearchAgent).toBe(
      "虚拟研究智能体"
    );
  });

  it("keeps BriefGeneAgent Chinese copy on the gene-review meaning", () => {
    expect(getMessage(zhCN, CANONICAL_AGENT_I18N_KEYS.BriefGeneAgent)).toContain(
      "基因综述"
    );
  });

  it("does not keep legacy GeneFunction locale aliases in chat labels", () => {
    expect(getMessage(zhCN, "chat.agents.geneFunction")).toBeUndefined();
    expect(getMessage(enUS, "chat.agents.geneFunction")).toBeUndefined();
    expect(getMessage(zhCN, "chat.logs.openGeneFunctionAgent")).toBeUndefined();
    expect(getMessage(enUS, "chat.logs.openGeneFunctionAgent")).toBeUndefined();
  });
});
