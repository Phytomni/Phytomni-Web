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
  token: string | undefined;
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
    // seen_tutorial: '0' = tutorial pending (first login or explicit replay request).
    // Single mutator is SET_SEEN_TUTORIAL below. Initial value comes from
    // localStorage; runtime mutations come from checkTutorialStatus on the
    // chat surface (auto-trigger on first login via sessionStorage hand-off
    // from change-password.vue) or from the sidebar's "开始教学" button
    // (replay path for returning users).
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
    // 前端 登出
    FedLogOut() {
      return new Promise((resolve, reject) => {
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

        const failures: string[] = [];
        try {
          localStorage.clear();
        } catch (err) {
          console.warn("FedLogOut: localStorage.clear failed", err);
          failures.push("localStorage");
        }
        try {
          sessionStorage.clear();
        } catch (err) {
          console.warn("FedLogOut: sessionStorage.clear failed", err);
          failures.push("sessionStorage");
        }
        // TODO 如无特殊要求这里可直接回到登录页(使用window.open)
        if (failures.length > 0) {
          reject(
            new Error(`FedLogOut storage clears failed: ${failures.join(", ")}`)
          );
        } else {
          resolve(true);
        }
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
     * Server-write-only by convention AND enforced by G11 in
     * scripts/validate_web_local.sh — only stores/user.ts (this file)
     * and views/login/index.vue may reference SET_LOGIN_STATUS.
     * Calling this from any other code path can bypass the first-login
     * enforcement guard in permission.ts.
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
