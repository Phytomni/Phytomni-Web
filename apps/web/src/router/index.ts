import {
  createRouter,
  createWebHistory,
  createWebHashHistory,
} from "vue-router";

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

export const constantRoutes = [
  // standalone routes (no layout needed)
  {
    path: "/login",
    name: "login",
    component: () => import("@/views/login/index.vue"),
    meta: { title: "Login", layout: "nolayout" },
  },
  {
    path: "/register",
    name: "register",
    component: () => import("@/views/register/index.vue"),
    meta: { title: "Register", layout: "nolayout" },
  },
  {
    path: "/forgot-password",
    name: "forgotPassword",
    component: () => import("@/views/forgot-password/index.vue"),
    meta: { title: "Forgot password", layout: "nolayout" },
  },
  {
    path: "/401",
    name: "Unauthorized",
    component: () => import("@/views/error/401.vue"),
    meta: { title: "401 error", layout: "nolayout" },
  },
  {
    path: "/:pathMatch(.*)*",
    name: "NotFound",
    component: () => import("@/views/error/404.vue"),
    meta: { title: "404 error", layout: "nolayout" },
  },
  // routes that need the layout
  {
    path: "/",
    component: () => import("@/layout/index.vue"),
    redirect: "/login",
    children: [
      {
        path: "/gene-display",
        name: "geneDisplay",
        component: () => import("@/views/gene-display/index.vue"),
        meta: { title: "Gene display", hideSidebar: true },
      },
      {
        path: "/knowledge-agent",
        name: "knowledgeAgent",
        component: () => import("@/views/knowledge-agent/index.vue"),
        meta: { title: "Knowledge Agent", layout: "nolayout" },
      },
      {
        path: "/data-agent",
        name: "dataAgent",
        component: () => import("@/views/data-agent/index.vue"),
        meta: { title: "Data Agent", layout: "nolayout" },
      },
      {
        path: "/analyst-agent",
        name: "analystAgent",
        component: () => import("@/views/analyst-agent/index.vue"),
        meta: { title: "Analyst Agent", layout: "nolayout" },
      },
      {
        path: "/brief-gene-agent",
        name: "briefGeneAgent",
        component: () => import("@/views/brief-gene-agent/index.vue"),
        meta: { title: "Brief Gene Agent", layout: "nolayout" },
      },
      {
        path: "/gene-network-agent",
        name: "geneNetworkAgent",
        component: () => import("@/views/gene-network-agent/index.vue"),
        meta: { title: "Gene Network Agent", layout: "nolayout" },
      },
      {
        path: "/deep-genome-agent",
        name: "deepGenomeAgent",
        component: () => import("@/views/deep-genome-agent/index.vue"),
        meta: { title: "Deep Genome Agent", layout: "nolayout" },
      },
      {
        path: "/digital-design-agent",
        name: "digitalDesignAgent",
        component: () => import("@/views/digital-design-agent/index.vue"),
        meta: { title: "Digital Design Agent", layout: "nolayout" },
      },
      {
        path: "/design",
        name: "design",
        component: () => import("@/views/design/index.vue"),
        meta: { title: "Design Agent", layout: "nolayout" },
      },
      {
        path: "/gene-display/detail",
        name: "geneDetail",
        component: () => import("@/views/gene-display/detail.vue"),
        meta: { title: "Gene detail", layout: "nolayout" },
      },
      {
        path: "/log-list",
        name: "logList",
        component: () => import("@/views/log-list/index.vue"),
        meta: { title: "Log list" },
      },
      {
        path: "/user-list",
        name: "userList",
        component: () => import("@/views/user-list/index.vue"),
        meta: { title: "User list" },
      },
      {
        path: "/permi-manage",
        name: "permi-manage",
        component: () => import("@/views/permi-manage/index.vue"),
        meta: { title: "Permission management" },
      },
      {
        path: "/change-password",
        name: "changePassword",
        component: () => import("@/views/change-password/index.vue"),
        meta: { title: "Change password", layout: "nolayout" },
      },
      {
        path: "/chat",
        name: "chat",
        component: () => import("@/views/chat/index.vue"),
        meta: { title: "Chat", layout: "nolayout" },
      },
      {
        path: "/favorites",
        name: "favorites",
        component: () => import("@/views/favorites/index.vue"),
        meta: { title: "Favorites" },
      },
      {
        path: "/history",
        name: "history",
        component: () => import("@/views/history/index.vue"),
        meta: { title: "History" },
      },
      {
        path: "/profile",
        name: "profile",
        component: () => import("@/views/profile/index.vue"),
        meta: { title: "Profile" },
      },
      {
        path: "/cloud-storage",
        name: "cloudStorage",
        component: () => import("@/views/cloud-storage/index.vue"),
        meta: { title: "Cloud storage" },
      },
      {
        path: "/feedback",
        name: "feedback",
        component: () => import("@/views/feedback/index.vue"),
        meta: { title: "Feedback" },
      },
      {
        path: "/task-management",
        name: "taskManagement",
        component: () => import("@/views/task-manager/index.vue"),
        meta: { title: "Task management" },
      },
      {
        path: "/help",
        name: "help",
        component: () => import("@/views/help/index.vue"),
        meta: { title: "Help center", layout: "nolayout" },
      },
      {
        path: "/global-config",
        name: "globalConfig",
        component: () => import("@/views/global-config/index.vue"),
        meta: { title: "Global config" },
      },
      {
        path: "/admin-management",
        name: "adminManagement",
        component: () => import("@/views/admin-management/index.vue"),
        meta: { title: "Admin management" },
      },
    ],
  },
];

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  // history: createWebHashHistory(import.meta.env.BASE_URL),
  routes: constantRoutes,
});
export default router;
