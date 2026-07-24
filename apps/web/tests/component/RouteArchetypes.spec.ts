import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { constantRoutes, dynamicRoutes } from "@/router";

type RouteRecord = {
  path: string;
  component?: unknown;
  children?: RouteRecord[];
};

type ProductLayout =
  | "auth"
  | "conversation"
  | "demo"
  | "document"
  | "standalone"
  | "workspace";

type RouteContract = {
  path: string;
  component: string;
  productLayout: ProductLayout;
  migrationTask: string;
  behaviorTest: string;
  sourceMarkers: string[];
};

const ROUTE_CONTRACTS: RouteContract[] = [
  {
    path: "/login",
    component: "views/login/LoginView.vue",
    productLayout: "auth",
    migrationTask: "auth shell",
    behaviorTest: "tests/component/shell/PhyAuthLayout.spec.ts",
    sourceMarkers: ["PhyAuthLayout"],
  },
  {
    path: "/register",
    component: "views/register/RegisterView.vue",
    productLayout: "auth",
    migrationTask: "auth shell",
    behaviorTest: "tests/component/shell/PhyAuthLayout.spec.ts",
    sourceMarkers: ["PhyAuthLayout"],
  },
  {
    path: "/forgot-password",
    component: "views/forgot-password/ForgotPasswordView.vue",
    productLayout: "auth",
    migrationTask: "auth shell",
    behaviorTest: "tests/component/shell/PhyAuthLayout.spec.ts",
    sourceMarkers: ["PhyAuthLayout"],
  },
  {
    path: "/401",
    component: "views/error/UnauthorizedView.vue",
    productLayout: "standalone",
    migrationTask: "recovery surface",
    behaviorTest: "tests/component/ErrorRecoveryPages.spec.ts",
    sourceMarkers: ["phy-recovery"],
  },
  {
    path: "/terms",
    component: "views/legal/LegalView.vue",
    productLayout: "document",
    migrationTask: "legal document shell",
    behaviorTest: "tests/component/LegalPage.spec.ts",
    sourceMarkers: ['data-scroll-root="legal"', "Footer"],
  },
  {
    path: "/privacy",
    component: "views/legal/LegalView.vue",
    productLayout: "document",
    migrationTask: "legal document shell",
    behaviorTest: "tests/component/LegalPage.spec.ts",
    sourceMarkers: ['data-scroll-root="legal"', "Footer"],
  },
  {
    path: "/:pathMatch(.*)*",
    component: "views/error/NotFoundView.vue",
    productLayout: "standalone",
    migrationTask: "recovery surface",
    behaviorTest: "tests/component/ErrorRecoveryPages.spec.ts",
    sourceMarkers: ["phy-recovery"],
  },
  {
    path: "/gene-display",
    component: "views/gene-display/GeneDisplayView.vue",
    productLayout: "workspace",
    migrationTask: "workspace shell",
    behaviorTest: "tests/component/WorkspaceLayout.spec.ts",
    sourceMarkers: ["PhyWorkspaceShell"],
  },
  {
    path: "/knowledge-agent",
    component: "views/knowledge-agent/KnowledgeAgentView.vue",
    productLayout: "demo",
    migrationTask: "agent demo shell",
    behaviorTest: "tests/component/demo/AgentDemoRoutes.spec.ts",
    sourceMarkers: ["AgentDemoShell"],
  },
  {
    path: "/data-agent",
    component: "views/data-agent/DataAgentView.vue",
    productLayout: "demo",
    migrationTask: "agent demo shell",
    behaviorTest: "tests/component/demo/AgentDemoRoutes.spec.ts",
    sourceMarkers: ["AgentDemoShell"],
  },
  {
    path: "/analyst-agent",
    component: "views/analyst-agent/AnalystAgentView.vue",
    productLayout: "demo",
    migrationTask: "agent demo shell",
    behaviorTest: "tests/component/demo/AgentDemoRoutes.spec.ts",
    sourceMarkers: ["AgentDemoShell"],
  },
  {
    path: "/brief-gene-agent",
    component: "views/brief-gene-agent/BriefGeneAgentView.vue",
    productLayout: "demo",
    migrationTask: "agent demo shell",
    behaviorTest: "tests/component/demo/AgentDemoRoutes.spec.ts",
    sourceMarkers: ["AgentDemoShell"],
  },
  {
    path: "/cases/gene-network-agent",
    component: "views/agent-cases/GeneNetworkCase.vue",
    productLayout: "demo",
    migrationTask: "agent case shell",
    behaviorTest: "tests/component/demo/AgentDemoRoutes.spec.ts",
    sourceMarkers: ["AgentDemoShell", "gene-network-download"],
  },
  {
    path: "/gene-network-agent",
    component: "views/gene-network-agent/GeneNetworkAgentView.vue",
    productLayout: "standalone",
    migrationTask: "capability-gated remote agent surface",
    behaviorTest: "tests/component/GeneNetworkAgentView.spec.ts",
    sourceMarkers: [
      "useBotRemoteAgentRun",
      'tool: "GeneNetworkAgent"',
      "ResearchArtifactShell",
    ],
  },
  {
    path: "/deep-genome-agent",
    component: "views/deep-genome-agent/DeepGenomeAgentView.vue",
    productLayout: "demo",
    migrationTask: "agent demo shell",
    behaviorTest: "tests/component/demo/AgentDemoRoutes.spec.ts",
    sourceMarkers: ["AgentDemoShell"],
  },
  {
    path: "/cases/digital-design-agent",
    component: "views/agent-cases/DigitalDesignCase.vue",
    productLayout: "demo",
    migrationTask: "agent case shell",
    behaviorTest: "tests/component/demo/AgentDemoRoutes.spec.ts",
    sourceMarkers: ["AgentDemoShell", "digital-design-download"],
  },
  {
    path: "/digital-design-agent",
    component: "views/digital-design-agent/DigitalDesignAgentView.vue",
    productLayout: "standalone",
    migrationTask: "capability-gated remote agent surface",
    behaviorTest: "tests/component/DigitalDesignAgentView.spec.ts",
    sourceMarkers: [
      "useBotRemoteAgentRun",
      'tool: "DigitalDesignAgent"',
      "ResearchArtifactShell",
    ],
  },
  {
    path: "/design",
    component: "views/design/DesignView.vue",
    productLayout: "demo",
    migrationTask: "agent demo shell",
    behaviorTest: "tests/component/demo/AgentDemoRoutes.spec.ts",
    sourceMarkers: ["AgentDemoShell"],
  },
  {
    path: "/gene-display/detail",
    component: "views/gene-display/GeneDetailView.vue",
    productLayout: "workspace",
    migrationTask: "workspace shell",
    behaviorTest: "tests/component/WorkspaceLayout.spec.ts",
    sourceMarkers: ['data-scroll-root="gene-detail"'],
  },
  {
    path: "/log-list",
    component: "views/log-list/LogListView.vue",
    productLayout: "workspace",
    migrationTask: "workspace shell",
    behaviorTest: "tests/component/WorkspaceLayout.spec.ts",
    sourceMarkers: ["log-list"],
  },
  {
    path: "/user-list",
    component: "views/user-list/UserListView.vue",
    productLayout: "workspace",
    migrationTask: "workspace shell",
    behaviorTest: "tests/component/WorkspaceLayout.spec.ts",
    sourceMarkers: ["PhyWorkspaceShell", "PhyTableFrame"],
  },
  {
    path: "/permi-manage",
    component: "views/permi-manage/PermiManageView.vue",
    productLayout: "workspace",
    migrationTask: "workspace shell",
    behaviorTest: "tests/component/WorkspaceLayout.spec.ts",
    sourceMarkers: ["log-list"],
  },
  {
    path: "/change-password",
    component: "views/change-password/ChangePasswordView.vue",
    productLayout: "auth",
    migrationTask: "auth shell",
    behaviorTest: "tests/component/shell/PhyAuthLayout.spec.ts",
    sourceMarkers: ["PhyAuthLayout"],
  },
  {
    path: "/chat",
    component: "views/chat/ChatView.vue",
    productLayout: "conversation",
    migrationTask: "adaptive conversation shell",
    behaviorTest: "tests/component/ChatShellIntegration.spec.ts",
    sourceMarkers: ["PhyAdaptiveShell"],
  },
  {
    path: "/favorites",
    component: "views/favorites/FavoritesView.vue",
    productLayout: "workspace",
    migrationTask: "workspace shell",
    behaviorTest: "tests/component/WorkspaceLayout.spec.ts",
    sourceMarkers: ["PhyWorkspaceShell"],
  },
  {
    path: "/history",
    component: "views/history/HistoryView.vue",
    productLayout: "workspace",
    migrationTask: "workspace shell",
    behaviorTest: "tests/component/WorkspaceLayout.spec.ts",
    sourceMarkers: ["PhyWorkspaceShell"],
  },
  {
    path: "/profile",
    component: "views/profile/ProfileView.vue",
    productLayout: "workspace",
    migrationTask: "workspace shell",
    behaviorTest: "tests/component/WorkspaceLayout.spec.ts",
    sourceMarkers: ["PhyWorkspaceShell"],
  },
  {
    path: "/cloud-storage",
    component: "views/cloud-storage/CloudStorageView.vue",
    productLayout: "workspace",
    migrationTask: "workspace shell",
    behaviorTest: "tests/component/WorkspaceLayout.spec.ts",
    sourceMarkers: ["cloud-storage"],
  },
  {
    path: "/feedback",
    component: "views/feedback/FeedbackView.vue",
    productLayout: "workspace",
    migrationTask: "workspace shell",
    behaviorTest: "tests/component/WorkspaceLayout.spec.ts",
    sourceMarkers: ["PhyWorkspaceShell"],
  },
  {
    path: "/task-management",
    component: "views/task-manager/TaskManagerView.vue",
    productLayout: "workspace",
    migrationTask: "workspace shell",
    behaviorTest: "tests/component/WorkspaceLayout.spec.ts",
    sourceMarkers: ["PhyWorkspaceShell", "PhyTableFrame"],
  },
  {
    path: "/help",
    component: "views/help/HelpView.vue",
    productLayout: "document",
    migrationTask: "help document shell",
    behaviorTest: "tests/component/HelpPage.spec.ts",
    sourceMarkers: ['data-scroll-root="help"', "PhyDocLayout", "Footer"],
  },
  {
    path: "/global-config",
    component: "views/global-config/GlobalConfigView.vue",
    productLayout: "workspace",
    migrationTask: "workspace shell",
    behaviorTest: "tests/component/WorkspaceLayout.spec.ts",
    sourceMarkers: ["global-config-container"],
  },
  {
    path: "/admin-management",
    component: "views/admin-management/AdminManagementView.vue",
    productLayout: "workspace",
    migrationTask: "workspace shell",
    behaviorTest: "tests/component/WorkspaceLayout.spec.ts",
    sourceMarkers: ["admin-management-container"],
  },
];

function flattenLeafRoutes(records: RouteRecord[]): RouteRecord[] {
  return records.flatMap((record) =>
    record.children?.length
      ? flattenLeafRoutes(record.children)
      : record.component
      ? [record]
      : []
  );
}

const activeLeafRoutes = flattenLeafRoutes(
  constantRoutes as unknown as RouteRecord[]
);

const STATIC_AGENT_DEMO_PATHS = [
  "/knowledge-agent",
  "/data-agent",
  "/analyst-agent",
  "/brief-gene-agent",
  "/cases/gene-network-agent",
  "/deep-genome-agent",
  "/cases/digital-design-agent",
] as const;

function readSource(relativePath: string): string {
  return readFileSync(resolve(__dirname, "../../src", relativePath), "utf8");
}

describe("routed visual archetypes", () => {
  it("enumerates every component-bearing constant leaf exactly once", () => {
    const actualPaths = activeLeafRoutes.map((route) => route.path).sort();
    const contractPaths = ROUTE_CONTRACTS.map((route) => route.path).sort();

    expect(contractPaths).toHaveLength(33);
    expect(new Set(contractPaths).size).toBe(contractPaths.length);
    expect(actualPaths).toEqual(contractPaths);
  });

  it.each(ROUTE_CONTRACTS)(
    "$path records its component, product layout, migration task, and behavior test",
    (contract) => {
      const source = readSource(contract.component);

      expect(source).toBeTruthy();
      expect(contract.productLayout).toMatch(
        /^(auth|conversation|demo|document|standalone|workspace)$/
      );
      expect(contract.migrationTask.trim()).not.toBe("");
      expect(
        existsSync(resolve(__dirname, "../../", contract.behaviorTest))
      ).toBe(true);
      for (const marker of contract.sourceMarkers) {
        expect(source, `${contract.path} is missing ${marker}`).toContain(
          marker
        );
      }
    }
  );

  it("keeps dormant dynamic routes separate from active route inventory", () => {
    expect(dynamicRoutes).toEqual([
      expect.objectContaining({ path: "/system/user-auth", hidden: true }),
    ]);
    expect(dynamicRoutes).toHaveLength(1);
    expect(ROUTE_CONTRACTS.map((route) => route.path)).not.toContain(
      "/system/user-auth"
    );
  });

  it("keeps shell and scroll ownership structural for representative archetypes", () => {
    const representatives = [
      ROUTE_CONTRACTS.find((route) => route.productLayout === "conversation"),
      ROUTE_CONTRACTS.find((route) => route.productLayout === "workspace"),
      ROUTE_CONTRACTS.find((route) => route.productLayout === "auth"),
      ROUTE_CONTRACTS.find((route) => route.productLayout === "document"),
      ROUTE_CONTRACTS.find((route) => route.productLayout === "standalone"),
      ROUTE_CONTRACTS.find((route) => route.productLayout === "demo"),
    ];

    expect(representatives).not.toContain(undefined);
    expect(representatives.map((route) => route?.productLayout)).toEqual([
      "conversation",
      "workspace",
      "auth",
      "document",
      "standalone",
      "demo",
    ]);
  });

  it("keeps static Agent routes connected to their one scroll and content owner", () => {
    const shell = readSource("components/demo/AgentDemoShell.vue");
    const staticDemoRoutes = ROUTE_CONTRACTS.filter((route) =>
      STATIC_AGENT_DEMO_PATHS.includes(
        route.path as typeof STATIC_AGENT_DEMO_PATHS[number]
      )
    );

    expect(staticDemoRoutes.map((route) => route.path)).toEqual(
      STATIC_AGENT_DEMO_PATHS
    );
    for (const route of staticDemoRoutes) {
      expect(readSource(route.component)).toContain("AgentDemoShell");
    }
    expect(shell).toContain('data-scroll-root="agent-demo"');
    expect(shell).toContain('data-test="agent-demo-result"');
    expect(shell).toContain(
      "width: min(100%, var(--phy-layout-artifact-wide-max-width));"
    );
  });
});
