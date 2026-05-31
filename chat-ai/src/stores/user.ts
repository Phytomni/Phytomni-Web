/*
 * 组件注释
 * @Author: wuq-l
 * @Date: 2022-09-01 09:29:17
 * @LastEditors: Machinst_wq
 * @LastEditTime: 2025-05-28 18:04:58
 * @Description: 用户信息
 * 人生无常！大肠包小肠......
 */

import { defineStore } from "pinia";
import {
  getToken,
  setToken,
  setExpiresIn,
  removeToken,
  removeExpiresIn,
} from "@/utils/auth";
import { getUserTool } from "@/api/chat";
import Cookies from "js-cookie";
interface IState {
  name?: string;
  avatar?: string;
  roles: any[];
  permissions: any[];
  permission_list: string[]; // 新增权限列表字段
  userType: string;
  token: string;
  permission: string;
  login_status: string; // 新增登录状态字段
  seen_tutorial: string; // UX-only flag, decoupled from password state
}

export default defineStore({
  id: "user",
  state: (): IState => ({
    name: localStorage.getItem("userName") || "",
    avatar: "",
    roles: [
      "ChatAgents",
      "KnowledgeAgents",
      "DatabaseAgents",
      "AnalysisAgents",
      "GeneFunctionAgents",
      "ReviewAgents",
    ],
    permissions: [],
    permission_list: [], // 权限列表
    userType: "",
    token: getToken(),
    permission: "",
    login_status: localStorage.getItem("loginStatus") || "1", // 默认非首次登录
    // Default '1' (assume seen) to avoid deploy-day tutorial spam on every
    // existing user. login.vue explicitly sets to '0' when server returns
    // login_status='0' (genuine first-login).
    seen_tutorial: localStorage.getItem("seenTutorial") || "1",
  }),
  getters: {},
  actions: {
    // addRoles() {
    //   this.roles = [1, 2, 3];
    // },
    // Login() {
    //   this.roles = [1, 2, 3];
    // },
    getUserTools() {
      return new Promise((resolve, reject) => {
        getUserTool()
          .then((res: any) => {
            if (res.code === 200) {
              this.SET_NAME(res.data.permission);
              this.SET_ROLES(res.data.tool_list);
              this.SET_PERMISSION_LIST(res.data.permission_list || []);
              resolve(true);
            } else {
              reject(new Error("Failed to get user tools"));
            }
          })
          .catch((error: unknown) => {
            reject(error);
          });
      });
    },
    // getInfo() {
    //   return new Promise((resolve, reject) => {
    //     resolve(true);
    //   });
    // },
    // 退出系统
    LogOut() {
      return new Promise((resolve, reject) => {
        // logout(state.token)
        //   .then(() => {
        //     commit("SET_ROLES", []);
        //     commit("SET_PERMISSIONS", []);
        //     removeToken();
        //     resolve();
        //   })
        //   .catch(error => {
        //     reject(error);
        //   });
      });
    },
    // 前端 登出
    FedLogOut() {
      return new Promise((resolve) => {
        this.SET_ROLES([]);
        this.SET_PERMISSIONS([]);
        removeToken();
        // 清除用户名
        this.name = "";
        localStorage.removeItem("userName");
        // 清除Cookie
        removeToken();
        removeExpiresIn();
        Object.keys(Cookies.get()).forEach((cookieName) => {
          Cookies.remove(cookieName);
        });

        // 清除localStorage
        localStorage.clear();

        // 清除sessionStorage
        sessionStorage.clear();
        // TODO 如无特殊要求这里可直接回到登录页(使用window.open)
        resolve(true);
      });
    },

    /* 同步更新数据 */
    // SET_TOKEN(token: string) {
    //   sessionStorage.setItem('currentBreadcrumbs', JSON.stringify([]));
    //   this.token = token;
    // },
    SET_NAME(permission: string) {
      this.permission = permission;
    },
    SET_USER_NAME(userName: string) {
      this.name = userName;
      localStorage.setItem("userName", userName);
    },
    SET_AVATAR(avatar: string) {
      this.avatar = avatar;
    },
    SET_USER_TYPE(userType: string) {
      this.userType = userType;
    },
    SET_ROLES(roles: any[]) {
      this.roles = roles;
    },
    SET_PERMISSIONS(permissions: any[]) {
      this.permissions = permissions;
    },
    SET_PERMISSION_LIST(permissionList: string[]) {
      this.permission_list = permissionList;
    },
    /**
     * Server-write-only by convention. Should be called ONLY from
     * views/login/index.vue when handling a successful login response.
     * Future grep-gate (in scripts/validate_web_local.sh) will enforce
     * this. Calling this from any other code path can bypass the
     * first-login enforcement guard in permission.ts.
     */
    SET_LOGIN_STATUS(loginStatus: string) {
      this.login_status = loginStatus;
      localStorage.setItem("loginStatus", loginStatus);
    },
    SET_SEEN_TUTORIAL(seenTutorial: string) {
      this.seen_tutorial = seenTutorial;
      localStorage.setItem("seenTutorial", seenTutorial);
    },
  },
});
