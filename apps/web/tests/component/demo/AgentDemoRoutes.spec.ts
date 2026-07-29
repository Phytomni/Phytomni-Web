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
  shell?: "agent-demo";
  boundedContent?: string;
};

const DEMO_CONTRACTS: DemoContract[] = [
  {
    path: "/knowledge-agent",
    source: "views/knowledge-agent/KnowledgeAgentView.vue",
    required: ["AgentDemoShell", 'ns="kb"', "CitedAnswer", "router.back"],
    shell: "agent-demo",
    boundedContent: "agent-demo-result",
  },
  {
    path: "/brief-gene-agent",
    source: "views/brief-gene-agent/BriefGeneAgentView.vue",
    required: ["AgentDemoShell", 'ns="bg"', "CitedAnswer", "router.back"],
    shell: "agent-demo",
    boundedContent: "agent-demo-result",
  },
  {
    path: "/review-agent",
    source: "views/review-agent/ReviewAgentView.vue",
    required: ["AgentDemoShell", 'ns="review"', "CitedAnswer", "router.back"],
    shell: "agent-demo",
    boundedContent: "agent-demo-result",
  },
  {
    path: "/data-agent",
    source: "views/data-agent/DataAgentView.vue",
    required: [
      "AgentDemoShell",
      "data-agent-round",
      "MarkdownViewer",
      "router.back",
    ],
    shell: "agent-demo",
    boundedContent: "agent-demo-result",
  },
  {
    path: "/analyst-agent",
    source: "views/analyst-agent/AnalystAgentView.vue",
    required: ["AgentDemoShell", "analyst-download", "router.back"],
    shell: "agent-demo",
    boundedContent: "agent-demo-result",
  },
  {
    path: "/cases/gene-network-agent",
    source: "views/agent-cases/GeneNetworkCase.vue",
    required: ["AgentDemoShell", "gene-network-download", "router.back"],
    shell: "agent-demo",
    boundedContent: "agent-demo-result",
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
    path: "/cases/digital-design-agent",
    source: "views/agent-cases/DigitalDesignCase.vue",
    required: ["AgentDemoShell", "digital-design-download", "router.back"],
    shell: "agent-demo",
    boundedContent: "agent-demo-result",
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
    path: "/deep-genome-agent",
    source: "views/deep-genome-agent/DeepGenomeAgentView.vue",
    required: [
      "AgentDemoShell",
      "DeepGenomeArtifact",
      'ns="deep-genome-demo"',
      "router.back",
    ],
    shell: "agent-demo",
    boundedContent: "agent-demo-result",
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
      "/knowledge-agent",
      "/brief-gene-agent",
      "/review-agent",
      "/data-agent",
      "/analyst-agent",
      "/cases/gene-network-agent",
      "/gene-network-agent",
      "/cases/digital-design-agent",
      "/digital-design-agent",
      "/deep-genome-agent",
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

  it("keeps every static Agent route attached to the shared scroll and result owner", () => {
    const shell = readDemoSource("components/demo/AgentDemoShell.vue");
    const staticContracts = DEMO_CONTRACTS.filter(
      (contract) => contract.shell === "agent-demo"
    );

    expect(staticContracts.map((contract) => contract.path)).toEqual([
      "/knowledge-agent",
      "/brief-gene-agent",
      "/review-agent",
      "/data-agent",
      "/analyst-agent",
      "/cases/gene-network-agent",
      "/cases/digital-design-agent",
      "/deep-genome-agent",
    ]);
    expect(shell).toContain('data-scroll-root="agent-demo"');

    for (const contract of staticContracts) {
      expect(readDemoSource(contract.source)).toContain("AgentDemoShell");
      expect(shell).toContain(`data-test="${contract.boundedContent}"`);
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
      for (const marker of LEGACY_DEMO_MARKERS) {
        expect(
          source,
          `${contract.path} still contains ${marker}`
        ).not.toContain(marker);
      }
    }
  );
});
