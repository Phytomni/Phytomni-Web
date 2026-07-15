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

const DEMO_CONTRACTS: DemoContract[] = [
  {
    path: "/knowledge-agent",
    source: "views/knowledge-agent/index.vue",
    required: ["AgentDemoShell", 'ns="kb"', "CitedAnswer", "router.back"],
  },
  {
    path: "/brief-gene-agent",
    source: "views/brief-gene-agent/index.vue",
    required: ["AgentDemoShell", 'ns="bg"', "CitedAnswer", "router.back"],
  },
  {
    path: "/data-agent",
    source: "views/data-agent/index.vue",
    required: [
      "AgentDemoShell",
      "data-agent-round",
      "MarkdownViewer",
      "router.back",
    ],
  },
  {
    path: "/analyst-agent",
    source: "views/analyst-agent/index.vue",
    required: ["AgentDemoShell", "analyst-download", "router.back"],
  },
  {
    path: "/gene-network-agent",
    source: "views/gene-network-agent/index.vue",
    required: ["AgentDemoShell", "gene-network-download", "router.back"],
  },
  {
    path: "/digital-design-agent",
    source: "views/digital-design-agent/index.vue",
    required: ["AgentDemoShell", "digital-design-download", "router.back"],
  },
  {
    path: "/deep-genome-agent",
    source: "views/deep-genome-agent/index.vue",
    required: [
      "AgentDemoShell",
      "DeepGenomeArtifact",
      'ns="deep-genome-demo"',
      "router.back",
    ],
  },
  {
    path: "/design",
    source: "views/design/index.vue",
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
  it("keeps exactly the eight active agent/demo routes in the constant router", () => {
    const activePaths = new Set(
      flattenRoutes(constantRoutes).map((route) => route.path)
    );

    expect(DEMO_CONTRACTS.map((contract) => contract.path)).toEqual([
      "/knowledge-agent",
      "/brief-gene-agent",
      "/data-agent",
      "/analyst-agent",
      "/gene-network-agent",
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
