import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import router, { constantRoutes, dynamicRoutes } from "@/router";

type RouteRecord = {
  path: string;
  children?: RouteRecord[];
};

type DemoContract = {
  path: string;
  source: string;
  required: string[];
};

const CASE_CHAT_SOURCE = "views/chat/ChatView.vue";
const CASE_CHAT_REQUIRED = ["PhyAdaptiveShell", "ChatCases"];

const CASE_DEMO_CONTRACTS: DemoContract[] = [
  {
    path: "/cases/knowledge-agent",
    source: CASE_CHAT_SOURCE,
    required: CASE_CHAT_REQUIRED,
  },
  {
    path: "/cases/data-agent",
    source: CASE_CHAT_SOURCE,
    required: CASE_CHAT_REQUIRED,
  },
  {
    path: "/cases/analyst-agent",
    source: CASE_CHAT_SOURCE,
    required: CASE_CHAT_REQUIRED,
  },
  {
    path: "/cases/review-agent",
    source: CASE_CHAT_SOURCE,
    required: CASE_CHAT_REQUIRED,
  },
  {
    path: "/cases/gene-network-agent",
    source: CASE_CHAT_SOURCE,
    required: CASE_CHAT_REQUIRED,
  },
  {
    path: "/cases/brief-gene-agent",
    source: CASE_CHAT_SOURCE,
    required: CASE_CHAT_REQUIRED,
  },
  {
    path: "/cases/deep-genome-agent",
    source: CASE_CHAT_SOURCE,
    required: CASE_CHAT_REQUIRED,
  },
  {
    path: "/cases/digital-design-agent",
    source: CASE_CHAT_SOURCE,
    required: CASE_CHAT_REQUIRED,
  },
];

const DEMO_CONTRACTS: DemoContract[] = [
  ...CASE_DEMO_CONTRACTS,
  {
    path: "/analyst-agent",
    source: "views/analyst-agent/AnalystAgentView.vue",
    required: [
      "RemoteAnalysisAgentWorkspace",
      'tool="AnalystAgent"',
      'locale-prefix="agents.analyst"',
      ':state="state"',
    ],
  },
  {
    path: "/gene-network-agent",
    source: "views/gene-network-agent/GeneNetworkAgentView.vue",
    required: [
      "useBotRemoteAgentRun",
      'tool: "GeneNetworkAgent"',
      "network-submit",
      "network-unavailable",
      "ResearchArtifactShell",
      "BotReportState",
      "BotArtifactList",
      "router.back",
      'data-scroll-root="gene-network-agent"',
      'data-test="network-artifact"',
      "width: min(100%, 1080px);",
    ],
  },
  {
    path: "/digital-design-agent",
    source: "views/digital-design-agent/DigitalDesignAgentView.vue",
    required: [
      "useBotRemoteAgentRun",
      'tool: "DigitalDesignAgent"',
      "design-submit",
      "design-unavailable",
      "ResearchArtifactShell",
      "BotReportState",
      "BotArtifactList",
      "router.back",
      'data-scroll-root="digital-design-agent"',
      'data-test="design-artifact"',
      "width: min(100%, 1080px);",
    ],
  },
  {
    path: "/design",
    source: "views/design/DesignView.vue",
    required: [
      "AgentDemoShell",
      "design-unavailable",
      "agents.design.unavailableTitle",
      "agents.design.unavailableMessage",
      "router.back",
    ],
  },
];

const LEGACY_DEMO_MARKERS = [
  ".chat-header",
  ".chat-messages",
  ".message-avatar",
  ".message-content",
  "message-fotter",
];

function flattenRoutes(routes: RouteRecord[]): RouteRecord[] {
  return routes.flatMap((route) => [
    route,
    ...(route.children ? flattenRoutes(route.children) : []),
  ]);
}

function readDemoSource(source: string): string {
  return readFileSync(resolve(__dirname, "../../../src", source), "utf8");
}

describe("routed agent demonstration inventory", () => {
  it("keeps all example and live agent routes in the constant router", () => {
    const activePaths = new Set(
      flattenRoutes(constantRoutes).map((route) => route.path)
    );

    expect(DEMO_CONTRACTS.map((contract) => contract.path)).toEqual([
      "/cases/knowledge-agent",
      "/cases/data-agent",
      "/cases/analyst-agent",
      "/cases/review-agent",
      "/cases/gene-network-agent",
      "/cases/brief-gene-agent",
      "/cases/deep-genome-agent",
      "/cases/digital-design-agent",
      "/analyst-agent",
      "/gene-network-agent",
      "/digital-design-agent",
      "/design",
    ]);
    expect(
      DEMO_CONTRACTS.every((contract) => activePaths.has(contract.path))
    ).toBe(true);
    expect(
      DEMO_CONTRACTS.every(
        (contract) => router.resolve(contract.path).matched.length > 0
      )
    ).toBe(true);
  });

  it("keeps the Analyst route capability-guarded instead of serving static artifacts", () => {
    const analyst = readDemoSource("views/analyst-agent/AnalystAgentView.vue");
    const workspace = readDemoSource(
      "views/analysis-agent/RemoteAnalysisAgentWorkspace.vue"
    );

    expect(analyst).toContain("RemoteAnalysisAgentWorkspace");
    expect(workspace).toContain("REMOTE_AGENT_PRODUCT_REGISTRY");
    expect(workspace).toContain("product.value.live === true");
    expect(workspace).toContain("capability?.enabled === true");
    expect(workspace).toContain("`${agentKey}-unavailable`");
    expect(analyst).not.toContain("/static/downloads/");
  });

  it("keeps dormant dynamic routes separate from shipped demonstrations", () => {
    expect(dynamicRoutes).toHaveLength(1);
    expect(dynamicRoutes[0]).toMatchObject({
      path: "/system/user-auth",
      hidden: true,
    });
    expect(DEMO_CONTRACTS.map((contract) => contract.path)).not.toContain(
      dynamicRoutes[0].path
    );
  });

  it("routes static demonstrations through the shared fluid container shell", () => {
    const shell = readDemoSource("components/demo/AgentDemoShell.vue");

    expect(shell).toContain('data-scroll-root="agent-demo"');
    expect(shell).toContain('data-test="agent-demo-result"');
    expect(shell).toContain("container-type: inline-size;");
    expect(shell).toContain(
      "width: min(100%, var(--phy-layout-document-max-width));"
    );
    expect(shell).not.toContain("width: min(100%, clamp(1160px");
  });

  it("routes /design through AgentDemoShell and eight /cases records through ChatView", () => {
    const design = DEMO_CONTRACTS.find(
      (contract) => contract.path === "/design"
    );
    const caseContracts = DEMO_CONTRACTS.filter((contract) =>
      contract.path.startsWith("/cases/")
    );

    expect(design?.source).toBe("views/design/DesignView.vue");
    expect(design?.required).toContain("AgentDemoShell");
    expect(readDemoSource("views/design/DesignView.vue")).toContain(
      "AgentDemoShell"
    );

    expect(caseContracts.map((contract) => contract.path)).toEqual([
      "/cases/knowledge-agent",
      "/cases/data-agent",
      "/cases/analyst-agent",
      "/cases/review-agent",
      "/cases/gene-network-agent",
      "/cases/brief-gene-agent",
      "/cases/deep-genome-agent",
      "/cases/digital-design-agent",
    ]);

    for (const contract of caseContracts) {
      expect(contract.source).toBe(CASE_CHAT_SOURCE);
      expect(contract.required).toEqual(CASE_CHAT_REQUIRED);
      expect(contract.required).not.toContain("AgentDemoShell");
      expect(contract.required).not.toContain("ChatDemoAskCta");
      expect(readDemoSource(contract.source)).toContain("PhyAdaptiveShell");
      expect(readDemoSource(contract.source)).toContain("ChatCases");
      expect(readDemoSource(contract.source)).not.toContain("AgentDemoShell");
      expect(router.resolve(contract.path).path).toBe(contract.path);
    }
  });

  it.each(DEMO_CONTRACTS)(
    "locks the $path shell, state, and behavior contract",
    (contract) => {
      const source = readDemoSource(contract.source);

      for (const marker of contract.required) {
        expect(source, `${contract.path} is missing ${marker}`).toContain(
          marker
        );
      }
      if (contract.source !== CASE_CHAT_SOURCE) {
        for (const marker of LEGACY_DEMO_MARKERS) {
          expect(
            source,
            `${contract.path} still contains ${marker}`
          ).not.toContain(marker);
        }
      }
    }
  );
});
