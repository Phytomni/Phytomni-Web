// User info store.
import { defineStore } from "pinia";
import {
  getToken,
  setToken,
  setExpiresIn,
  removeToken,
  removeExpiresIn,
} from "@/utils/auth";
import { getUserTool } from "@/api/chat";
import {
  CANONICAL_AT_ABLE_TOOLS,
  type RemoteAgentTool,
} from "@/constants/agents";
import Cookies from "js-cookie";
interface UserToolResponse {
  code: number;
  message?: string;
  data: {
    permission: string;
    tool_list: string[];
    permission_list?: string[];
    expert_enabled?: boolean;
  };
}

interface IState {
  name?: string;
  avatar?: string;
  roles: string[];
  permissions: string[];
  permission_list: string[]; // permission list field
  userType: string;
  token: string | undefined;
  permission: string;
  login_status: string; // login status field
  seen_tutorial: string; // UX-only flag, decoupled from password state
  expertEnabled: boolean; // Expert routing dark-launch flag (server-delivered)
}

export default defineStore({
  id: "user",
  state: (): IState => ({
    name: localStorage.getItem("userName") || "",
    avatar: "",
    roles: [...CANONICAL_AT_ABLE_TOOLS],
    permissions: [],
    permission_list: [], // permission list
    userType: "",
    token: getToken(),
    permission: "",
    login_status: localStorage.getItem("loginStatus") || "1", // default: not first login
    // seen_tutorial: '0' = tutorial pending (first login or explicit replay request).
    // Single mutator is SET_SEEN_TUTORIAL below. Initial value comes from
    // localStorage; runtime mutations come from checkTutorialStatus on the
    // chat surface (auto-trigger on first login via sessionStorage hand-off
    // from change-password.vue) or from the sidebar's "Start Tutorial" button
    // (replay path for returning users).
    seen_tutorial: localStorage.getItem("seenTutorial") || "1",
    expertEnabled: false,
  }),
  getters: {
    isFirstLogin: (state): boolean => state.login_status === "0",
    hasRemoteAgentPermission:
      (state) => (tool: RemoteAgentTool | string): boolean =>
        state.roles.includes(tool),
  },
  actions: {
    getUserTools() {
      return new Promise((resolve, reject) => {
        getUserTool()
          .then((res: UserToolResponse) => {
            if (res.code === 200) {
              this.$patch({
                permission: res.data.permission,
                roles: res.data.tool_list,
                permission_list: res.data.permission_list || [],
                expertEnabled: res.data.expert_enabled ?? false,
              });
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
    // frontend logout
    FedLogOut() {
      return new Promise((resolve, reject) => {
        this.SET_ROLES([]);
        this.SET_PERMISSIONS([]);
        removeToken();
        // clear the username
        this.name = "";
        localStorage.removeItem("userName");
        // clear cookies
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
        if (failures.length > 0) {
          reject(
            new Error(`FedLogOut storage clears failed: ${failures.join(", ")}`)
          );
        } else {
          resolve(true);
        }
      });
    },

    /* synchronous state updates */
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
    SET_ROLES(roles: string[]) {
      this.roles = roles;
    },
    SET_PERMISSIONS(permissions: string[]) {
      this.permissions = permissions;
    },
    SET_PERMISSION_LIST(permissionList: string[]) {
      this.permission_list = permissionList;
    },
    SET_EXPERT_ENABLED(enabled: boolean) {
      this.expertEnabled = enabled;
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
