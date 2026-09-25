// Route guards, permissions, and dynamic route loading (incl. first-login enforcement).
import NProgress from "nprogress";
import "nprogress/nprogress.css";
import router from "@/router";
import { userStore } from "@/stores";
import { getToken } from "@/utils";
import { WHITELIST, FIRST_LOGIN_ALLOWED_ROUTE_NAMES } from "@/router/whitelist";
import { safeRedirect } from "@/utils/auth-redirect";
import { ElNotification } from "element-plus";
import type { NotificationHandle } from "element-plus";
import { i18n } from "@/locales";
import {
  REMOTE_AGENT_PRODUCT_REGISTRY,
  type RemoteAgentTool,
} from "@/constants/agents";
import type { RouteLocationNormalized } from "vue-router";

NProgress.configure({ showSpinner: false });

// Module-level state for ElNotification dedup. The Element Plus public API
// does NOT support an `id` option for deduplication. We track the live handle
// so subsequent triggers reuse the existing notification and we can close it
// explicitly when the user reaches /change-password (compliance) or /login
// (post-FedLogOut).
let firstLoginNotifHandle: NotificationHandle | null = null;

function readLoginStatusFromLocalStorage(): string {
  // localStorage direct read — cross-tab fresh and immune to per-tab Pinia
  // hydration races. Wrapped in try/catch for incognito / disabled-storage
  // edge cases. Fails OPEN to '1' = treat as already-changed, because the
  // alternative locks ALL legitimate users out when localStorage breaks.
  try {
    return localStorage.getItem("loginStatus") || "1";
  } catch {
    return "1";
  }
}

function showFirstLoginNotification(): void {
  if (firstLoginNotifHandle) return; // dedup — already showing
  firstLoginNotifHandle = ElNotification({
    title: i18n.global.t("login.firstLoginEnforceTitle") as string,
    message: i18n.global.t("login.firstLoginEnforceMessage") as string,
    type: "warning",
    duration: 0,
    position: "top-right",
    showClose: true,
    customClass: "first-login-enforce-notif",
    onClose: () => {
      firstLoginNotifHandle = null;
    },
  });
}

function closeFirstLoginNotification(): void {
  if (firstLoginNotifHandle) {
    firstLoginNotifHandle.close();
    firstLoginNotifHandle = null;
  }
}

type RemoteRouteStore = {
  roles: string[];
  hasRemoteAgentPermission?: (tool: RemoteAgentTool | string) => boolean;
};

function remoteToolForRoute(
  to: RouteLocationNormalized
): RemoteAgentTool | null {
  const routePath = to.path;
  const routeName = String(to.name ?? "");
  for (const product of Object.values(REMOTE_AGENT_PRODUCT_REGISTRY)) {
    if (product.route === routePath || product.routeName === routeName) {
      return product.tool;
    }
  }
  return null;
}

/**
 * Route navigation is a convenience gate only. The Go service remains the
 * authorization boundary for every query; this helper prevents a dark or
 * ungranted remote surface from being advertised by the browser router.
 */
export async function canEnterRemoteAgentRoute(
  to: RouteLocationNormalized,
  store: RemoteRouteStore
): Promise<boolean> {
  const tool = remoteToolForRoute(to);
  if (!tool) return true;

  const contract = REMOTE_AGENT_PRODUCT_REGISTRY[tool];
  const roleAllowed = store.hasRemoteAgentPermission
    ? store.hasRemoteAgentPermission(contract.requiredRole)
    : store.roles.includes(contract.requiredRole);
  if (!roleAllowed || contract.live !== true) return false;

  try {
    const { useBotCapabilities } =
      await import("@/views/chat/composables/useBotCapabilities");
    const capabilities = useBotCapabilities(`route:${tool}`);
    await capabilities.load();
    const capability = capabilities.byTool.value[tool];
    return (
      capability?.enabled === true &&
      capability.execution === contract.capability
    );
  } catch {
    // Capability fetch errors fail closed for navigation. Query authorization
    // remains server-side and is not weakened by this client-side fallback.
    return false;
  }
}

export async function beforeEachGuard(to: RouteLocationNormalized) {
  NProgress.start();
  // Brand title from locale packs (en Phytomni / zh brand string).
  document.title = i18n.global.t("chat.appTitle") as string;
  // Close stale first-login notification on /login transitions
  // (logout / post-FedLogOut). Runs unconditionally — even when
  // getToken() is false — so the FedLogOut + redirect-to-/login path
  // still clears it after the token cookie is gone. The changePassword
  // condition was removed because the guard's own redirect re-enters
  // beforeEach with to.name === 'changePassword' and would immediately
  // close the just-shown notification (~400ms flash-and-vanish).
  if (to.path === "/login") {
    closeFirstLoginNotification();
  }
  if (getToken()) {
    /* has token — first-login enforcement runs FIRST */
    const loginStatus = readLoginStatusFromLocalStorage();
    const targetName = String(to.name ?? "");
    if (
      loginStatus === "0" &&
      to.name !== "changePassword" &&
      !FIRST_LOGIN_ALLOWED_ROUTE_NAMES.has(targetName)
    ) {
      showFirstLoginNotification();
      return { name: "changePassword" };
    }
    // First-login users (login_status === "0") are gated server-side to
    // /api/v1/users/me/password only (apps/server/middleware/first_login_gate.go);
    // every other /api/v1/* returns 403. Probing getUserTools() for an allow-listed
    // destination (changePassword) would 403 → FedLogOut → bounce back to
    // /login, locking the user out of the only page that clears the flag.
    // Reach those routes directly, skipping the tools probe.
    if (
      loginStatus === "0" &&
      FIRST_LOGIN_ALLOWED_ROUTE_NAMES.has(targetName)
    ) {
      return;
    }
    if (to.path === "/") {
      NProgress.done();
      // Replace `/` instead of allowing the route redirect `/` → `/login` →
      // `/chat`. That extra hop is what Chrome marks as a skippable history
      // item on `/chat` when a session is already present.
      return { path: "/chat", replace: true };
    }
    if (
      to.path === "/login" ||
      to.path === "/register" ||
      to.path === "/forgot-password"
    ) {
      return safeRedirect(to.query.redirect, "/chat");
    }

    const UserStore = userStore();
    try {
      await UserStore.getUserTools();
      if (!(await canEnterRemoteAgentRoute(to, UserStore))) {
        return { name: "NotFound" };
      }
    } catch {
      // Stale-token break — clear token so the next beforeEach takes
      // the unauthed branch, restoring /login as terminal and breaking
      // the /chat ↔ /login redirect cycle.
      // Redirect even when FedLogOut fails, so the router never stays pending
      // with NProgress hung at 80% in a restricted storage environment.
      try {
        await UserStore.FedLogOut();
      } catch {
        // The redirect remains fail-closed when cleanup cannot complete.
      }
      return { path: "/login", query: { redirect: to.fullPath } };
    }
  } else {
    /* unauth whitelist branch (TW-D7 SSOT) */
    if ((WHITELIST as readonly string[]).includes(to.path)) {
      return;
    }
    NProgress.done();
    return `/login?redirect=${to.fullPath}`;
  }
}

router.beforeEach(beforeEachGuard);

router.afterEach(() => {
  NProgress.done();
});
