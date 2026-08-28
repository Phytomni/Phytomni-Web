import {
  createRouter,
  type RouteLocationNormalized,
  type RouteLocationRaw,
} from "vue-router";
import { createAppWebHistory } from "./webHistory";
import {
  REMOTE_AGENT_PRODUCT_REGISTRY,
  type RemoteAgentTool,
} from "@/constants/agents";

/**
 * Capability-gated route contracts for remote product views. The live surfaces
 * remain dark until their respective `live` contracts are enabled.
 */
export const REMOTE_AGENT_ROUTE_CONTRACTS = REMOTE_AGENT_PRODUCT_REGISTRY;

export type RemoteAgentRouteAccess = {
  roles?: readonly string[];
  capabilities?: Readonly<
    Record<string, { enabled?: boolean; execution?: string } | undefined>
  >;
};

export function canActivateRemoteAgentRoute(
  tool: RemoteAgentTool,
  access: RemoteAgentRouteAccess
): boolean {
  const contract = REMOTE_AGENT_ROUTE_CONTRACTS[tool];
  if (!contract) return false;
  if (contract.live !== true) return false;
  const roles = access.roles ?? [];
  const capability = access.capabilities?.[tool];
  return (
    roles.includes(contract.requiredRole) &&
    capability?.enabled === true &&
    capability.execution === contract.capability
  );
}

export const isRemoteAgentRouteAllowed = canActivateRemoteAgentRoute;

/**
 * Route-level guard used by the lazy contract below and by the future live
 * Research view. Metadata access is useful for deterministic tests and future
 * server-provided route context; normal navigation loads the authenticated
 * role and Bot capability manifest here.
 */
export function remoteAgentRouteGuard(tool: RemoteAgentTool) {
  return async (
    to: RouteLocationNormalized
  ): Promise<true | RouteLocationRaw> => {
    const metadataAccess = to.meta.remoteAccess as
      RemoteAgentRouteAccess | undefined;
    if (metadataAccess) {
      return canActivateRemoteAgentRoute(tool, metadataAccess)
        ? true
        : { name: "NotFound" };
    }

    // Dynamic imports keep the chat capability/request graph out of router
    // initialization, which also runs before Pinia is mounted during boot.
    try {
      const [{ userStore }, { useBotCapabilities }] = await Promise.all([
        import("@/stores"),
        import("@/views/chat/composables/useBotCapabilities"),
      ]);
      const store = userStore();
      const capabilities = useBotCapabilities(`route:${tool}`);
      await capabilities.load();
      const access: RemoteAgentRouteAccess = {
        roles: store.roles,
        capabilities: { [tool]: capabilities.byTool.value[tool] },
      };
      return canActivateRemoteAgentRoute(tool, access)
        ? true
        : { name: "NotFound" };
    } catch {
      // A missing auth/capability context must fail closed. The 404 fallback
      // keeps a dark route from becoming a successful but non-functional UI.
      return { name: "NotFound" };
    }
  };
}

/**
 * The Research route is mounted separately from the static product-route
 * inventory. This keeps the existing visual-contract route list stable while
 * still giving the dark surface a real, guarded, lazy view.
 */
export const REMOTE_AGENT_LAZY_ROUTES = [
  {
    path: "/research-agent",
    name: "researchAgent",
    component: () => import("@/views/research-agent/ResearchAgentView.vue"),
    beforeEnter: remoteAgentRouteGuard("InSilicoResearchAgent"),
    meta: {
      title: "Research Agent",
      layout: "nolayout",
      remoteTool: "InSilicoResearchAgent",
    },
  },
] as const;

export const dynamicRoutes = [
  {
    path: "/system/user-auth",
    // component: Layout,
    hidden: true,
    permissions: ["system:user:edit"],
    children: [
      {
        path: "role/:userId(\\d+)",
        // component: () => import("@/views/system/user/authRole"),
        name: "AuthRole",
        meta: { title: "Assign role", activeMenu: "/system/user" },
      },
    ],
  },
];

function agentCaseChatRoute(
  path: string,
  name: string,
  demoKey:
    | "knowledge"
    | "data"
    | "analyst"
    | "review"
    | "network"
    | "brief-gene"
    | "deep-genome"
    | "design",
  title: string
) {
  return {
    path,
    name,
    component: () => import("@/views/chat/ChatView.vue"),
    meta: { title, layout: "nolayout" as const, demoKey },
  };
}

export const constantRoutes = [
  // standalone routes (no layout needed)
  {
    path: "/login",
    name: "login",
    component: () => import("@/views/login/LoginView.vue"),
    meta: { title: "Login", layout: "nolayout" },
  },
  {
    path: "/register",
    name: "register",
    component: () => import("@/views/register/RegisterView.vue"),
    meta: { title: "Register", layout: "nolayout" },
  },
  {
    path: "/forgot-password",
    name: "forgotPassword",
    component: () => import("@/views/forgot-password/ForgotPasswordView.vue"),
    meta: { title: "Forgot password", layout: "nolayout" },
  },
  {
    path: "/401",
    name: "Unauthorized",
    component: () => import("@/views/error/UnauthorizedView.vue"),
    meta: { title: "401 error", layout: "nolayout" },
  },
  {
    path: "/terms",
    name: "terms",
    component: () => import("@/views/legal/LegalView.vue"),
    meta: { title: "Terms of Service", layout: "nolayout", doc: "terms" },
  },
  {
    path: "/privacy",
    name: "privacy",
    component: () => import("@/views/legal/LegalView.vue"),
    meta: { title: "Privacy Policy", layout: "nolayout", doc: "privacy" },
  },
  {
    path: "/:pathMatch(.*)*",
    name: "NotFound",
    component: () => import("@/views/error/NotFoundView.vue"),
    meta: { title: "404 error", layout: "nolayout" },
  },
  // routes that need the layout
  {
    path: "/",
    component: () => import("@/layout/LayoutView.vue"),
    redirect: "/login",
    children: [
      {
        path: "/gene-display",
        name: "geneDisplay",
        component: () => import("@/views/gene-display/GeneDisplayView.vue"),
        meta: { title: "Gene display", hideSidebar: true },
      },
      {
        path: "/knowledge-agent",
        name: "knowledgeAgent",
        redirect: "/cases/knowledge-agent",
      },
      {
        path: "/data-agent",
        name: "dataAgent",
        redirect: "/cases/data-agent",
      },
      {
        path: "/analyst-agent",
        name: "analystAgent",
        component: () => import("@/views/analyst-agent/AnalystAgentView.vue"),
        beforeEnter: remoteAgentRouteGuard("AnalystAgent"),
        meta: { title: "Analyst Agent", layout: "nolayout" },
      },
      {
        path: "/review-agent",
        name: "reviewAgent",
        redirect: "/cases/review-agent",
      },
      {
        path: "/brief-gene-agent",
        name: "briefGeneAgent",
        redirect: "/cases/brief-gene-agent",
      },
      agentCaseChatRoute(
        "/cases/gene-network-agent",
        "geneNetworkAgentCase",
        "network",
        "Gene Network Agent Case"
      ),
      {
        path: "/gene-network-agent",
        name: "geneNetworkAgent",
        component: () =>
          import("@/views/gene-network-agent/GeneNetworkAgentView.vue"),
        meta: { title: "Gene Network Agent", layout: "nolayout" },
      },
      {
        path: "/deep-genome-agent",
        name: "deepGenomeAgent",
        redirect: "/cases/deep-genome-agent",
      },
      {
        path: "/digital-design-agent",
        name: "digitalDesignAgent",
        component: () =>
          import("@/views/digital-design-agent/DigitalDesignAgentView.vue"),
        meta: { title: "Digital Design Agent", layout: "nolayout" },
      },
      agentCaseChatRoute(
        "/cases/digital-design-agent",
        "digitalDesignAgentCase",
        "design",
        "Digital Design Agent Case"
      ),
      {
        path: "/design",
        name: "design",
        component: () => import("@/views/design/DesignView.vue"),
        meta: { title: "Design Agent", layout: "nolayout" },
      },
      {
        path: "/gene-display/detail",
        name: "geneDetail",
        component: () => import("@/views/gene-display/GeneDetailView.vue"),
        meta: { title: "Gene detail", layout: "nolayout" },
      },
      {
        path: "/log-list",
        name: "logList",
        component: () => import("@/views/log-list/LogListView.vue"),
        meta: { title: "Log list" },
      },
      {
        path: "/user-list",
        name: "userList",
        component: () => import("@/views/user-list/UserListView.vue"),
        meta: { title: "User list" },
      },
      {
        path: "/permi-manage",
        name: "permi-manage",
        component: () => import("@/views/permi-manage/PermiManageView.vue"),
        meta: { title: "Permission management" },
      },
      {
        path: "/change-password",
        name: "changePassword",
        component: () =>
          import("@/views/change-password/ChangePasswordView.vue"),
        meta: { title: "Change password", layout: "nolayout" },
      },
      {
        path: "/chat",
        name: "chat",
        component: () => import("@/views/chat/ChatView.vue"),
        meta: { title: "Chat", layout: "nolayout" },
      },
      agentCaseChatRoute(
        "/cases/knowledge-agent",
        "knowledgeAgentCase",
        "knowledge",
        "Knowledge Agent Case"
      ),
      agentCaseChatRoute(
        "/cases/data-agent",
        "dataAgentCase",
        "data",
        "Data Agent Case"
      ),
      agentCaseChatRoute(
        "/cases/analyst-agent",
        "analystAgentCase",
        "analyst",
        "Analyst Agent Case"
      ),
      agentCaseChatRoute(
        "/cases/review-agent",
        "reviewAgentCase",
        "review",
        "Review Agent Case"
      ),
      agentCaseChatRoute(
        "/cases/brief-gene-agent",
        "briefGeneAgentCase",
        "brief-gene",
        "Brief Gene Agent Case"
      ),
      agentCaseChatRoute(
        "/cases/deep-genome-agent",
        "deepGenomeAgentCase",
        "deep-genome",
        "Deep Genome Agent Case"
      ),
      {
        path: "/favorites",
        name: "favorites",
        component: () => import("@/views/favorites/FavoritesView.vue"),
        meta: { title: "Favorites" },
      },
      {
        path: "/history",
        name: "history",
        component: () => import("@/views/history/HistoryView.vue"),
        meta: { title: "History" },
      },
      {
        path: "/profile",
        name: "profile",
        component: () => import("@/views/profile/ProfileView.vue"),
        meta: { title: "Profile" },
      },
      {
        path: "/cloud-storage",
        name: "cloudStorage",
        component: () => import("@/views/cloud-storage/CloudStorageView.vue"),
        meta: { title: "Cloud storage" },
      },
      {
        path: "/feedback",
        name: "feedback",
        component: () => import("@/views/feedback/FeedbackView.vue"),
        meta: { title: "Feedback" },
      },
      {
        path: "/task-management",
        name: "taskManagement",
        component: () => import("@/views/task-manager/TaskManagerView.vue"),
        meta: { title: "Task management" },
      },
      {
        path: "/help",
        name: "help",
        component: () => import("@/views/help/HelpView.vue"),
        meta: { title: "Help center", layout: "nolayout" },
      },
      {
        path: "/global-config",
        name: "globalConfig",
        component: () => import("@/views/global-config/GlobalConfigView.vue"),
        meta: { title: "Global config" },
      },
      {
        path: "/admin-management",
        name: "adminManagement",
        component: () =>
          import("@/views/admin-management/AdminManagementView.vue"),
        meta: { title: "Admin management" },
      },
    ],
  },
];

const router = createRouter({
  history: createAppWebHistory(import.meta.env.BASE_URL),
  routes: constantRoutes,
});

for (const route of REMOTE_AGENT_LAZY_ROUTES) {
  router.addRoute(route);
}

export default router;
