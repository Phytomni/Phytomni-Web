/*
 * 组件注释
 * @Author: wuq-l
 * @Date: 2022-09-01 09:22:57
 * @LastEditors: error: git config user.name & please set dead value or install git
 * @LastEditTime: 2025-05-13 10:58:23
 * @Description: 动态路由
 * 人生无常！大肠包小肠......
 */
import { defineStore } from 'pinia';
import router, { constantRoutes, dynamicRoutes } from '@/router';
import type { RouteRecordRaw } from 'vue-router';

// 匹配views里面所有的.vue文件
const modules = import.meta.glob('@/views/**/**.vue');

interface IRoute {
  children?: IRoute[];
  meta?: {
    title: string;
  };
  hidden?: boolean;
  path: string;
  redirect?: string;
  component?: string | ((resolve: any) => any);
}
interface IState {
  routes: IRoute[];
  sidebarRouters: IRoute[];
  counter: number;
}
// const data: IRoute[] = [
//   {
//     meta: {
//       title: "home",
//     },
//     path: "/home",
//     component: "home",
//     children: [
//       {
//         meta: {
//           title: "about",
//         },
//         path: "/about",
//         component: "about",
//       },
//     ],
//   },
// ];
const data: IRoute[] = [
  {
    meta: {
      title: 'home',
    },
    path: '/',
    component: 'HomeView',
  },
  {
    meta: {
      title: 'about',
    },
    path: '/about',
    component: 'AboutView',
  },
];
export default defineStore({
  id: 'permission',
  state: (): IState => ({
    routes: [],
    sidebarRouters: [],
    counter: 0,
  }),
  actions: {
    GenerateRoutes() {
      return new Promise(resolve => {
        const sdata: IRoute[] = JSON.parse(JSON.stringify(data));
        const rdata: IRoute[] = JSON.parse(JSON.stringify(data));
        const sidebarRoutes = filterAsyncRouter(sdata);
        const rewriteRoutes = filterAsyncRouter(rdata, true);
        // const asyncRoutes = filterDynamicRoutes(dynamicRoutes);
        // rewriteRoutes.push({ path: "*", redirect: "/404", hidden: true });

        // router.addRoute(asyncRoutes);
        this.sidebarRouters = sidebarRoutes;
        this.routes = rewriteRoutes;
        this.counter++;
        resolve(rewriteRoutes);
      });
    },
  },
});

// 遍历后台传来的路由字符串，转换为组件对象
function filterAsyncRouter(asyncRouterMap: IRoute[], type = false) {
  return asyncRouterMap.filter((route: IRoute) => {
    if (type && route.children) {
      route.children = filterChildren(route.children);
    }
    if (route.component) {
      // 组件特殊处理
      if (route.component === 'Layout') {
      } else {
        route.component = loadView(route.component);
      }
    }
    if (route.children != null && route?.children?.length) {
      route.children = filterAsyncRouter(route.children, type);
    } else {
      delete route['children'];
      delete route['redirect'];
    }
    return true;
  });
}

function filterChildren(childrenMap: IRoute[], lastRouter?: IRoute | boolean) {
  var children: IRoute[] = [];
  childrenMap.forEach((el: IRoute) => {
    if (el.children && el.children.length) {
      if (el.component === 'ParentView' && !lastRouter) {
        el.children.forEach((c: IRoute) => {
          c.path = el.path + '/' + c.path;
          if (c.children && c.children.length) {
            children = children.concat(filterChildren(c.children, c));
            return;
          }
          children.push(c);
        });
        return;
      }
    }
    if (lastRouter) {
      el.path = (lastRouter as IRoute).path + '/' + el.path;
    }
    children = children.concat(el);
  });
  return children;
}

// 动态路由遍历，验证是否具备权限
export function filterDynamicRoutes(routes: any[]): RouteRecordRaw {
  const res: any[] = [];
  routes.forEach((route: { permissions: string[]; roles: any }) => {
    if (route.permissions) {
      // if (auth.hasPermiOr(route.permissions)) {
      //   res.push(route);
      // }
    } else if (route.roles) {
      // if (auth.hasRoleOr(route.roles)) {
      //   res.push(route);
      // }
    }
  });
  return res as unknown as RouteRecordRaw;
}

export const loadView = (view: any) => {
  let res;
  for (const path in modules) {
    const dir = path.split('views/')[1].split('.vue')[0];
    if (dir === view) {
      res = () => modules[path]();
    }
  }
  return res;
};
