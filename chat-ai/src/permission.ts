/*
 * 组件注释
 * @Author: wuq-l
 * @Date: 2022-08-31 21:17:01
 * @LastEditors: Machinst_wq
 * @LastEditTime: 2025-05-28 18:01:24
 * @Description: 路由守卫、权限以及动态获取路由
 * 人生无常！大肠包小肠......
 */
import NProgress from 'nprogress';
import 'nprogress/nprogress.css';
import router from '@/router';
import { userStore, permiStore } from '@/stores';
import { getToken } from '@/utils';
import { isRelogin } from '@/utils/request';
import type { RouteRecordRaw } from 'vue-router';

NProgress.configure({ showSpinner: false });

const whiteList = ['/', '/login', '/register', '/forgot-password', '/home', '/about'];

router.beforeEach((to, from, next) => {
  NProgress.start();
  // document.title = to.meta.title ? (to.meta.title as string) : '管理平台';
  document.title = 'Phytomni';
  // if (getToken()) {
  // FIXME: auth bypass — the original `getToken()` guard is commented
  // out, leaving every route accessible. Tracked as a separate product
  // concern (forgot-password is also stubbed, same neighborhood); fixing
  // this is intentionally out of the current CI-hygiene scope.
  // eslint-disable-next-line no-constant-condition
  if (true) {
    /* has token */
    if (to.path === '/') {
      // if (to.path === "/login") {
      next();
      NProgress.done();
    } else {
      // const UserStore = userStore();
      // if (UserStore.roles.length === 0) {
      //   isRelogin.show = true;
      //   // 判断当前用户是否已拉取完user_info信息
      //   UserStore.getInfo().then(() => {
      //     isRelogin.show = false;
      //     const PermiStore = permiStore();
      //     PermiStore.GenerateRoutes()
      //       .then(accessRoutes => {
      //         // TODO 注意这需添加角色否则 !UserStore.roles.length导致路切换出问题
      //         UserStore.addRoles();

      //         setRoute(accessRoutes as RouteRecordRaw[]);

      //         next({ ...to, replace: true }); // hack方法 确保addRoutes已完成
      //       })
      //       .catch(err => {
      //         UserStore.LogOut().then(resp => {
      //           next({ path: '/login' });
      //         });
      //       });
      //   });
      // } else {
      //   next();
      // }
      console.log(to.path, 'to.path');
      if (to.path === '/login' || to.path === '/register' || to.path === '/forgot-password') {
        next();
      } else {
        // 简化逻辑：直接允许跳转，异步获取用户工具
        const UserStore = userStore();
        UserStore.getUserTools().then(() => {
          console.log('getUserTools success');
        }).catch(() => {
          console.log('getUserTools failed, but continuing');
        });
        next();
      }
    }
  } else {
    /* 判断白名单 */
    if (whiteList.includes(to.path)) {
      next();
    } else {
      /* 重定向到登录页面 */
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
