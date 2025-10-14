/*
 * 组件注释
 * @Author: machinist_wq
 * @Date: 2022-08-18 21:07:26
 * @LastEditors: error: git config user.name & please set dead value or install git
 * @LastEditTime: 2025-05-10 09:42:12
 * @Description:
 * 既往不恋！当下不杂！！未来不迎！！！
 */
import {
  createRouter,
  createWebHistory,
  createWebHashHistory,
} from 'vue-router';

export const dynamicRoutes = [
  {
    path: '/system/user-auth',
    // component: Layout,
    hidden: true,
    permissions: ['system:user:edit'],
    children: [
      {
        path: 'role/:userId(\\d+)',
        // component: () => import("@/views/system/user/authRole"),
        name: 'AuthRole',
        meta: { title: '分配角色', activeMenu: '/system/user' },
      },
    ],
  },
];

export const constantRoutes = [
  // 独立的路由（不需要布局）
  {
    path: '/login',
    name: 'login',
    component: () => import('@/views/login/index.vue'),
    meta: { title: '登录界面', layout: 'nolayout' },
  },
  {
    path: '/register',
    name: 'register',
    component: () => import('@/views/register/index.vue'),
    meta: { title: '注册界面', layout: 'nolayout' },
  },
  {
    path: '/forgot-password',
    name: 'forgotPassword',
    component: () => import('@/views/forgot-password/index.vue'),
    meta: { title: '忘记密码', layout: 'nolayout' },
  },
  {
    path: '/401',
    name: 'Unauthorized',
    component: () => import('@/views/error/401.vue'),
    meta: { title: '401错误', layout: 'nolayout' },
  },
  {
    path: '/:pathMatch(.*)*',
    name: 'NotFound',
    component: () => import('@/views/error/404.vue'),
    meta: { title: '404错误', layout: 'nolayout' },
  },
  // 需要布局的路由
  {
    path: '/',
    component: () => import('@/layout/index.vue'),
    redirect: '/login',
    children: [
      {
        path: '/gene-display',
        name: 'geneDisplay',
        component: () => import('@/views/gene-display/index.vue'),
        meta: { title: '基因展示' },
      },
      {
        path: '/knowledge-agent',
        name: 'knowledgeAgent',
        component: () => import('@/views/knowledge-agent/index.vue'),
        meta: { title: 'Knowledge Agent', layout: 'nolayout' },
      },
      {
        path: '/data-agent',
        name: 'dataAgent',
        component: () => import('@/views/data-agent/index.vue'),
        meta: { title: 'Data Agent', layout: 'nolayout' },
      },
      {
        path: '/analyst-agent',
        name: 'analystAgent',
        component: () => import('@/views/analyst-agent/index.vue'),
        meta: { title: 'Analyst Agent', layout: 'nolayout' },
      },
      {
        path: '/brief-review-agent',
        name: 'briefReviewAgent',
        component: () => import('@/views/brief-review-agent/index.vue'),
        meta: { title: 'Brief Review Agent', layout: 'nolayout' },
      },
      {
        path: '/gene-network-agent',
        name: 'geneNetworkAgent',
        component: () => import('@/views/gene-network-agent/index.vue'),
        meta: { title: 'Gene Network Agent', layout: 'nolayout' },
      },
      {
        path: '/deep-genome-agent',
        name: 'deepGenomeAgent',
        component: () => import('@/views/deep-genome-agent/index.vue'),
        meta: { title: 'Deep Genome Agent', layout: 'nolayout' },
      },
      {
        path: '/digital-design-agent',
        name: 'digitalDesignAgent',
        component: () => import('@/views/digital-design-agent/index.vue'),
        meta: { title: 'Digital Design Agent', layout: 'nolayout' },
      },
      {
        path: '/design',
        name: 'design',
        component: () => import('@/views/design/index.vue'),
        meta: { title: 'Design Agent', layout: 'nolayout' },
      },
      {
        path: '/gene-display/detail',
        name: 'geneDetail',
        component: () => import('@/views/gene-display/detail.vue'),
        meta: { title: '基因详情', layout: 'nolayout' },
      },
      {
        path: '/log-list',
        name: 'logList',
        component: () => import('@/views/log-list/index.vue'),
        meta: { title: '日志列表' },
      },
      {
        path: '/user-list',
        name: 'userList',
        component: () => import('@/views/user-list/index.vue'),
        meta: { title: '用户列表' },
      },
      {
        path: '/permi-manage',
        name: 'permi-manage',
        component: () => import('@/views/permi-manage/index.vue'),
        meta: { title: '权限管理' },
      },
      {
        path: '/change-password',
        name: 'changePassword',
        component: () => import('@/views/change-password/index.vue'),
        meta: { title: '修改密码', layout: 'nolayout' },
      },
      {
        path: '/chat',
        name: 'chat',
        component: () => import('@/views/chat/index.vue'),
        meta: { title: '聊天界面', layout: 'nolayout' },
      },
      {
        path: '/favorites',
        name: 'favorites',
        component: () => import('@/views/favorites/index.vue'),
        meta: { title: '收藏页面' },
      },
      {
        path: '/history',
        name: 'history',
        component: () => import('@/views/history/index.vue'),
        meta: { title: '历史记录' },
      },
      {
        path: '/profile',
        name: 'profile',
        component: () => import('@/views/profile/index.vue'),
        meta: { title: '个人资料管理' },
      },
      {
        path: '/cloud-storage',
        name: 'cloudStorage',
        component: () => import('@/views/cloud-storage/index.vue'),
        meta: { title: '网盘空间' },
      },
      {
        path: '/feedback',
        name: 'feedback',
        component: () => import('@/views/feedback/index.vue'),
        meta: { title: '用户反馈' },
      },
      {
        path: '/task-management',
        name: 'taskManagement',
        component: () => import('@/views/task-manager/index.vue'),
        meta: { title: '任务管理' },
      },
      {
        path: '/help',
        name: 'help',
        component: () => import('@/views/help/index.vue'),
        meta: { title: '帮助中心', layout: 'nolayout' },
      },
      {
        path: '/global-config',
        name: 'globalConfig',
        component: () => import('@/views/global-config/index.vue'),
        meta: { title: '全局策略配置' },
      },
      {
        path: '/admin-management',
        name: 'adminManagement',
        component: () => import('@/views/admin-management/index.vue'),
        meta: { title: '管理员管理' },
      },
    ],
  },
  /* --------------------------------------- */
  // {
  //   path: '/',
  //   component: () => import('@/layout/index.vue'),
  //   redirect: '/gene-display',
  //   children: [
  //     {
  //       path: 'gene-display',
  //       name: 'geneDisplay',
  //       component: () => import('@/views/gene-display/index.vue'),
  //       meta: { title: '基因展示' },
  //     },
  //     {
  //       path: 'gene-display/detail',
  //       name: 'geneDetail',
  //       component: () => import('@/views/gene-display/detail.vue'),
  //       meta: { title: '基因详情' },
  //     },
  //     {
  //       path: 'log-list',
  //       name: 'logList',
  //       component: () => import('@/views/log-list/index.vue'),
  //       meta: { title: '日志列表' },
  //     },
  //     {
  //       path: 'user-list',
  //       name: 'userList',
  //       component: () => import('@/views/user-list/index.vue'),
  //       meta: { title: '用户列表' },
  //     },
  //     {
  //       path: 'permi-manage',
  //       name: 'permi-manage',
  //       component: () => import('@/views/permi-manage/index.vue'),
  //       meta: { title: '权限管理' },
  //     },
  //   ],
  // },
  // {
  //   path: '/change-password',
  //   name: 'changePassword',
  //   component: () => import('@/views/change-password/index.vue'),
  //   meta: { title: '修改密码' },
  // },
  // {
  //   path: '/login',
  //   name: 'login',
  //   component: () => import('@/views/login/index.vue'),
  // },
  // {
  //   path: '/chat',
  //   name: 'chat',
  //   component: () => import('@/views/chat/index.vue'),
  //   meta: { title: '聊天界面' },
  // },
  // {
  //   path: '/401',
  //   name: 'Unauthorized',
  //   component: () => import('@/views/error/401.vue'),
  //   meta: { title: '401错误' },
  // },
  // {
  //   path: '/:pathMatch(.*)*',
  //   name: 'NotFound',
  //   component: () => import('@/views/error/404.vue'),
  //   meta: { title: '404错误' },
  // },
];

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  // history: createWebHashHistory(import.meta.env.BASE_URL),
  routes: constantRoutes,
});
/* // 防止连续点击多次路由报错
let routerPush = router.prototype.push;
Router.prototype.push = function push(location) {
  return routerPush.call(this, location).catch(err => err);
}; */
export default router;
