/*
 * 组件注释
 * @Author: wuq-l
 * @Description: 路由守卫、权限以及动态获取路由（含 first-login enforcement）
 */
import NProgress from "nprogress";
import "nprogress/nprogress.css";
import router from "@/router";
import { userStore } from "@/stores";
import { getToken } from "@/utils";
import { WHITELIST, FIRST_LOGIN_ALLOWED_ROUTE_NAMES } from "@/router/whitelist";
import { safeRedirect } from "@/utils/authRedirect";
import { ElNotification } from "element-plus";
import type { NotificationHandle } from "element-plus";
import { i18n } from "@/locales";
import type { RouteRecordRaw } from "vue-router";

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
  } catch (err) {
    console.warn(
      'localStorage unavailable for login_status read; defaulting to "1"',
      err
    );
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

router.beforeEach((to, from, next) => {
  NProgress.start();
  document.title = "Phytomni";
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
      next({ name: "changePassword" });
      return;
    }
    if (to.path === "/") {
      next();
      NProgress.done();
    } else if (
      to.path === "/login" ||
      to.path === "/register" ||
      to.path === "/forgot-password"
    ) {
      next(safeRedirect(to.query.redirect, "/chat"));
    } else {
      const UserStore = userStore();
      UserStore.getUserTools()
        .then(() => {
          console.log("getUserTools success");
          next();
        })
        .catch((err) => {
          console.error("getUserTools failed:", err);
          // Stale-token break — clear token so the next beforeEach takes
          // the unauthed branch, restoring /login as terminal and breaking
          // the /chat ↔ /login redirect cycle.
          UserStore.FedLogOut().then(() => {
            next({ path: "/login", query: { redirect: to.fullPath } });
          });
        });
    }
  } else {
    /* unauth whitelist branch (TW-D7 SSOT) */
    if ((WHITELIST as readonly string[]).includes(to.path)) {
      next();
    } else {
      next(`/login?redirect=${to.fullPath}`);
      NProgress.done();
    }
  }
});

function setRoute(routes: RouteRecordRaw[], path?: string) {
  routes.forEach((item: RouteRecordRaw) => {
    if (path) {
      router.addRoute(path, item);
    } else {
      router.addRoute(item);
    }
    if (item.children?.length) {
      setRoute(item.children, item.path);
    }
  });
}

router.afterEach(() => {
  NProgress.done();
});
