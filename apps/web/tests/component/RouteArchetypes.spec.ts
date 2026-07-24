import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import {
  constantRoutes,
  dynamicRoutes,
  REMOTE_AGENT_LAZY_ROUTES,
} from "@/router";
import { REMOTE_AGENT_PRODUCT_REGISTRY } from "@/constants/agents";

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
    sourceMarkers: ['data-scroll-root="recovery"', "phy-recovery"],
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
    sourceMarkers: ['data-scroll-root="recovery"', "phy-recovery"],
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
    sourceMarkers: ["PhyWorkspaceShell", 'data-scroll-root="workspace"'],
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

const DESIGN_SYSTEM_SOURCE = readFileSync(
  resolve(__dirname, "../../../../docs/frontend-design-system.md"),
  "utf8"
);

const VISUAL_FIXTURE_REGISTRY_SOURCE = readFileSync(
  resolve(__dirname, "../visual/chat/fixture-registry.ts"),
  "utf8"
);

const RESPONSIVE_CONTINUITY_WIDTHS = [
  320, 390, 480, 768, 899, 900, 1024, 1199, 1279, 1280, 1366, 1920, 2560,
] as const;

const ROUTE_OWNERSHIP_CONTRACTS = [
  {
    paths: ["/login", "/register", "/forgot-password", "/change-password"],
    component: "components/shell/PhyAuthLayout.vue",
    ownerMarker: "phy-auth-layout",
    scrollMarker: "phy-auth-layout",
    footerMarker: "Footer",
  },
  {
    paths: ["/terms", "/privacy"],
    component: "views/legal/LegalView.vue",
    ownerMarker: "legal-page",
    scrollMarker: 'data-scroll-root="legal"',
    footerMarker: "Footer",
  },
  {
    paths: ["/401"],
    component: "views/error/UnauthorizedView.vue",
    ownerMarker: "phy-recovery-page",
    scrollMarker: 'data-scroll-root="recovery"',
    footerMarker: "Footer",
  },
  {
    paths: ["/:pathMatch(.*)*"],
    component: "views/error/NotFoundView.vue",
    ownerMarker: "phy-recovery-page",
    scrollMarker: 'data-scroll-root="recovery"',
    footerMarker: "Footer",
  },
  {
    paths: ["/chat"],
    component: "views/chat/ChatView.vue",
    ownerMarker: "PhyAdaptiveShell",
    scrollMarker: 'data-testid="chat-content-stack"',
    footerMarker: "",
  },
  {
    paths: [
      "/knowledge-agent",
      "/data-agent",
      "/analyst-agent",
      "/brief-gene-agent",
      "/cases/gene-network-agent",
      "/deep-genome-agent",
      "/cases/digital-design-agent",
      "/design",
    ],
    component: "components/demo/AgentDemoShell.vue",
    ownerMarker: "agent-demo-shell",
    scrollMarker: 'data-scroll-root="agent-demo"',
    footerMarker: "Footer",
  },
  {
    paths: [
      "/gene-display",
      "/log-list",
      "/user-list",
      "/permi-manage",
      "/favorites",
      "/history",
      "/profile",
      "/cloud-storage",
      "/feedback",
      "/task-management",
      "/global-config",
      "/admin-management",
    ],
    component: "components/shell/PhyWorkspaceShell.vue",
    ownerMarker: "phy-workspace-shell",
    scrollMarker: 'data-scroll-root="workspace"',
    footerMarker: "",
  },
  {
    paths: ["/gene-display/detail"],
    component: "views/gene-display/GeneDetailView.vue",
    ownerMarker: "gene-detail-route",
    scrollMarker: 'data-scroll-root="gene-detail"',
    footerMarker: "",
  },
  {
    paths: ["/research-agent"],
    component: "views/research-agent/ResearchAgentView.vue",
    ownerMarker: "research-agent-page",
    scrollMarker: 'data-scroll-root="research-agent"',
    footerMarker: "",
  },
  {
    paths: ["/gene-network-agent"],
    component: "views/gene-network-agent/GeneNetworkAgentView.vue",
    ownerMarker: "gene-network-page",
    scrollMarker: 'data-scroll-root="gene-network-agent"',
    footerMarker: "",
  },
  {
    paths: ["/digital-design-agent"],
    component: "views/digital-design-agent/DigitalDesignAgentView.vue",
    ownerMarker: "digital-design-page",
    scrollMarker: 'data-scroll-root="digital-design-agent"',
    footerMarker: "",
  },
] as const;

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

  it("keeps route owners and scroll roots source-backed", () => {
    const routeByPath = new Map(
      ROUTE_CONTRACTS.map((contract) => [contract.path, contract])
    );
    const activeOrLazyPaths = new Set([
      ...routeByPath.keys(),
      ...REMOTE_AGENT_LAZY_ROUTES.map((route) => route.path),
    ]);

    for (const ownership of ROUTE_OWNERSHIP_CONTRACTS) {
      const ownerSource = readSource(ownership.component);
      expect(ownerSource).toContain(ownership.ownerMarker);
      expect(ownerSource).toContain(ownership.scrollMarker);
      if (ownership.footerMarker) {
        expect(ownerSource).toContain(ownership.footerMarker);
      }
      for (const path of ownership.paths) {
        expect(
          activeOrLazyPaths.has(path),
          `${path} is missing from the inventory`
        ).toBe(true);
      }
    }

    const routerSource = readFileSync(
      resolve(__dirname, "../../src/router/index.ts"),
      "utf8"
    );
    expect(routerSource).toContain("REMOTE_AGENT_LAZY_ROUTES");
    expect(REMOTE_AGENT_LAZY_ROUTES.map((route) => route.path)).toContain(
      "/research-agent"
    );
  });

  it("documents the exact continuous-width review and CSS-pixel scaling", () => {
    for (const width of RESPONSIVE_CONTINUITY_WIDTHS) {
      expect(DESIGN_SYSTEM_SOURCE).toContain(`\`${width}\``);
    }
    expect(DESIGN_SYSTEM_SOURCE).toContain("2560x1440");
    expect(DESIGN_SYSTEM_SOURCE).toContain("4K@150% scaling");
  });

  it("keeps the fixed Agent order and permission-independent discovery contract", () => {
    const agentSource = readSource("constants/agents.ts");
    const sidebarSource = readSource("views/chat/ChatSidebar.vue");
    const sidebarNavSource = readSource(
      "views/chat/components/ChatSidebarNav.vue"
    );

    expect(agentSource).toContain("CANONICAL_AGENT_DISPLAY_ORDER");
    expect(agentSource).toContain("CANONICAL_AGENT_CASE_ROUTES");
    expect(agentSource).toContain("Permission-independent destinations");
    expect(sidebarSource).toContain(':can-explore-agents="true"');
    expect(sidebarSource).toContain("deriveCaseRouteOptions");
    expect(sidebarNavSource).toContain("canExploreAgents");
    expect(DESIGN_SYSTEM_SOURCE).toContain(
      "ChatAgent → KnowledgeAgent → DataAgent → AnalystAgent → ReviewAgent → InSilicoResearchAgent → GeneNetworkAgent → BriefGeneAgent → DeepGenomeAgent → DigitalDesignAgent"
    );
    expect(DESIGN_SYSTEM_SOURCE).toContain(
      "Cases remains permission-independent"
    );
    expect(DESIGN_SYSTEM_SOURCE).toContain("Explore Agents");
  });

  it("keeps visual history states and transfer/progress contracts explicit", () => {
    for (const state of [
      "history-title-only",
      "history-loading",
      "history-empty",
      "history-error",
    ]) {
      expect(VISUAL_FIXTURE_REGISTRY_SOURCE).toContain(`\"${state}\"`);
      expect(DESIGN_SYSTEM_SOURCE).toContain(state);
    }

    const chatSource = readSource("views/chat/ChatView.vue");
    const progressSource = readSource("views/chat/utils/agentProgress.ts");
    const appSource = readFileSync(
      resolve(__dirname, "../../src/App.vue"),
      "utf8"
    );
    expect(chatSource).toContain("uploadTransfer");
    expect(chatSource).toContain("<TransferProgress");
    expect(chatSource).toContain("<SendProgress");
    expect(progressSource).toContain("Math.min(98");
    expect(DESIGN_SYSTEM_SOURCE).toContain("reaches `100%` only");
    expect(DESIGN_SYSTEM_SOURCE).toContain(
      "upload byte progress lives in `chatStates[dialogueId].uploadTransfer`"
    );
    expect(DESIGN_SYSTEM_SOURCE).toContain(
      "download byte progress lives in the shared `download-transfers` map"
    );
    expect(appSource).toContain("<TransferProgressList />");
  });

  it("keeps capability-gated product pages separate from static cases", () => {
    const productRoutes = [
      "/research-agent",
      "/gene-network-agent",
      "/digital-design-agent",
    ];

    expect(STATIC_AGENT_DEMO_PATHS).not.toContain(
      "/gene-network-agent" as typeof STATIC_AGENT_DEMO_PATHS[number]
    );
    expect(STATIC_AGENT_DEMO_PATHS).not.toContain(
      "/digital-design-agent" as typeof STATIC_AGENT_DEMO_PATHS[number]
    );
    expect(
      Object.values(REMOTE_AGENT_PRODUCT_REGISTRY).every(
        (contract) => contract.live === false
      )
    ).toBe(true);
    for (const route of productRoutes) {
      expect(DESIGN_SYSTEM_SOURCE).toContain(route);
    }
    expect(DESIGN_SYSTEM_SOURCE).toContain("capability-gated");
    expect(DESIGN_SYSTEM_SOURCE).toContain(
      "Expert activation are still pending"
    );
    expect(DESIGN_SYSTEM_SOURCE).not.toContain("Bot deployment is complete");
    expect(DESIGN_SYSTEM_SOURCE).not.toContain("production acceptance passed");
  });
});
