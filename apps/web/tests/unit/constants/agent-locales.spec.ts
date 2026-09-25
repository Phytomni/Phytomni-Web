import { describe, expect, it } from "vitest";
import {
  CANONICAL_AGENT_DISPLAY_NAMES,
  CANONICAL_AGENT_DISPLAY_ORDER,
  CANONICAL_AGENT_I18N_KEYS,
  CANONICAL_AGENT_LABEL_I18N_KEYS,
  CANONICAL_AGENT_PAGE_TITLE_KEYS,
  CANONICAL_AGENT_TOOLS,
  CANONICAL_AGENT_ZH_NAMES,
  derivePickerOptions,
} from "@/constants/agents";
import { CANONICAL_AGENT_PRESENTATIONS } from "@/components/agent";
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
  it("contains each release agent exactly once with complete metadata", () => {
    const releaseTools = [
      "ChatAgent",
      "KnowledgeAgent",
      "DataAgent",
      "ReviewAgent",
      "BriefGeneAgent",
      "AnalystAgent",
      "DeepGenomeAgent",
      "InSilicoResearchAgent",
      "DigitalDesignAgent",
      "GeneNetworkAgent",
    ];

    expect(CANONICAL_AGENT_TOOLS).toEqual(releaseTools);
    expect(new Set(CANONICAL_AGENT_TOOLS).size).toBe(releaseTools.length);
    expect(CANONICAL_AGENT_DISPLAY_ORDER).toEqual([
      "ChatAgent",
      "KnowledgeAgent",
      "DataAgent",
      "AnalystAgent",
      "ReviewAgent",
      "InSilicoResearchAgent",
      "GeneNetworkAgent",
      "BriefGeneAgent",
      "DeepGenomeAgent",
      "DigitalDesignAgent",
    ]);
    for (const toolName of releaseTools) {
      expect(CANONICAL_AGENT_DISPLAY_NAMES[toolName]).toEqual(
        expect.any(String)
      );
      expect(CANONICAL_AGENT_ZH_NAMES[toolName]).toEqual(expect.any(String));
      expect(CANONICAL_AGENT_I18N_KEYS[toolName]).toEqual(expect.any(String));
      expect(CANONICAL_AGENT_LABEL_I18N_KEYS[toolName]).toEqual(
        expect.any(String)
      );
    }
  });

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

  it("has Chinese and English alt text for every workflow with media", () => {
    for (const toolName of CANONICAL_AGENT_DISPLAY_ORDER) {
      const workflow = CANONICAL_AGENT_PRESENTATIONS[toolName].workflow;
      if (!workflow) continue;
      expect(
        getMessage(zhCN, workflow.altKey),
        `${toolName} zh-CN alt`
      ).toEqual(expect.any(String));
      expect(
        getMessage(enUS, workflow.altKey),
        `${toolName} en-US alt`
      ).toEqual(expect.any(String));
    }

    expect(
      getMessage(zhCN, "chat.agentPresentation.briefGeneAgentAlt")
    ).toBeUndefined();
    expect(
      getMessage(enUS, "chat.agentPresentation.briefGeneAgentAlt")
    ).toBeUndefined();
  });

  it("keeps compact picker labels separate from long agent descriptions", () => {
    expect(Object.keys(CANONICAL_AGENT_LABEL_I18N_KEYS).sort()).toEqual(
      [...CANONICAL_AGENT_TOOLS].sort()
    );
    for (const toolName of CANONICAL_AGENT_TOOLS) {
      const labelKey = CANONICAL_AGENT_LABEL_I18N_KEYS[toolName];
      expect(labelKey).toBe(
        `chat.agentLabels.${toolName[0].toLowerCase()}${toolName.slice(1)}`
      );
      expect(getMessage(zhCN, labelKey), `${toolName} zh-CN label`).toEqual(
        expect.any(String)
      );
      expect(getMessage(enUS, labelKey), `${toolName} en-US label`).toEqual(
        expect.any(String)
      );
      expect(labelKey).not.toBe(CANONICAL_AGENT_I18N_KEYS[toolName]);
    }
  });

  it("keeps routed agent page titles aligned in Chinese and English", () => {
    for (const [toolName, titleKey] of Object.entries(
      CANONICAL_AGENT_PAGE_TITLE_KEYS
    )) {
      const canonicalTool =
        toolName as keyof typeof CANONICAL_AGENT_PAGE_TITLE_KEYS;
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
    expect(CANONICAL_AGENT_ZH_NAMES.DeepGenomeAgent).toBe("基因深度分析智能体");
    expect(CANONICAL_AGENT_ZH_NAMES.InSilicoResearchAgent).toBe(
      "虚拟研究智能体"
    );
  });

  it("keeps BriefGeneAgent Chinese copy on the gene-review meaning", () => {
    expect(
      getMessage(zhCN, CANONICAL_AGENT_I18N_KEYS.BriefGeneAgent)
    ).toContain("基因综述");
  });

  it("makes every granted canonical tool available to the picker", () => {
    const options = derivePickerOptions([...CANONICAL_AGENT_TOOLS]);
    expect(options.map((option) => option.tool)).toEqual([
      ...CANONICAL_AGENT_DISPLAY_ORDER,
    ]);
    for (const option of options) {
      expect(option.labelKey).toBe(
        CANONICAL_AGENT_LABEL_I18N_KEYS[option.tool]
      );
      expect(getMessage(enUS, option.labelKey)).toEqual(expect.any(String));
      expect(getMessage(zhCN, option.labelKey)).toEqual(expect.any(String));
      expect(option.displayName).toBe(
        CANONICAL_AGENT_DISPLAY_NAMES[option.tool]
      );
    }
  });

  it("does not keep legacy GeneFunction locale aliases in chat labels", () => {
    expect(getMessage(zhCN, "chat.agents.geneFunction")).toBeUndefined();
    expect(getMessage(enUS, "chat.agents.geneFunction")).toBeUndefined();
    expect(getMessage(zhCN, "chat.logs.openGeneFunctionAgent")).toBeUndefined();
    expect(getMessage(enUS, "chat.logs.openGeneFunctionAgent")).toBeUndefined();
  });
});
