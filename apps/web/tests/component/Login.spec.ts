import { beforeEach, describe, expect, it, vi } from "vitest";
import { config, flushPromises, mount } from "@vue/test-utils";
import { defineComponent, h, nextTick } from "vue";
import { createI18n } from "vue-i18n";
import ElementPlus from "element-plus";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import enUS from "@/locales/langs/en-US";
import zhCN from "@/locales/langs/zh-CN";

const mocks = vi.hoisted(() => ({
  login: vi.fn(),
  register: vi.fn(),
  setToken: vi.fn(),
  safeRedirect: vi.fn(() => "/chat"),
  redirectIfAuthed: vi.fn(),
  push: vi.fn(),
  replace: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
  notification: vi.fn(),
  route: { query: {} as Record<string, unknown> },
  store: {
    SET_USER_NAME: vi.fn(),
    SET_LOGIN_STATUS: vi.fn(),
  },
}));

vi.mock("vue-router", () => ({
  useRouter: () => ({ push: mocks.push, replace: mocks.replace }),
  useRoute: () => mocks.route,
}));
vi.mock("@/api/login", () => ({ login: mocks.login }));
vi.mock("@/api/auth", () => ({ register: mocks.register }));
vi.mock("@/utils/auth", () => ({ setToken: mocks.setToken }));
vi.mock("@/utils/auth-redirect", () => ({
  redirectIfAuthed: mocks.redirectIfAuthed,
  safeRedirect: mocks.safeRedirect,
}));
vi.mock("@/stores", () => ({ userStore: () => mocks.store }));
vi.mock("element-plus", async () => {
  const actual = await vi.importActual<typeof import("element-plus")>(
    "element-plus"
  );
  return {
    ...actual,
    ElMessage: {
      success: mocks.success,
      error: mocks.error,
    },
    ElNotification: mocks.notification,
  };
});

import Login from "@/views/login/index.vue";

type Rule = {
  required?: boolean;
  type?: string;
  min?: number;
  max?: number;
  message?: string;
};

const ElFormStub = defineComponent({
  name: "ElForm",
  props: {
    model: { type: Object, required: true },
    rules: { type: Object, default: () => ({}) },
  },
  setup(props, { expose, slots }) {
    const validate = async (callback?: (valid: boolean) => void) => {
      let valid = true;
      for (const [field, rawRules] of Object.entries(props.rules)) {
        const value = String(
          (props.model as Record<string, unknown>)[field] ?? ""
        );
        for (const rule of rawRules as Rule[]) {
          if (rule.required && !value) {
            valid = false;
            break;
          }
          if (rule.type === "email" && !/^\S+@\S+\.\S+$/.test(value)) {
            valid = false;
            break;
          }
          if (rule.min && value.length < rule.min) {
            valid = false;
            break;
          }
          if (rule.max && value.length > rule.max) {
            valid = false;
            break;
          }
        }
      }
      callback?.(valid);
      return valid;
    };
    expose({ validate });
    return () => h("form", { class: "el-form" }, slots.default?.());
  },
});

const ElFormItemStub = defineComponent({
  name: "ElFormItem",
  setup(_props, { slots }) {
    return () => h("div", { class: "el-form-item" }, slots.default?.());
  },
});

const ElInputStub = defineComponent({
  name: "ElInput",
  inheritAttrs: false,
  props: {
    modelValue: String,
    type: String,
  },
  emits: ["update:modelValue"],
  setup(props, { attrs, emit }) {
    return () =>
      h("input", {
        ...attrs,
        value: props.modelValue,
        type: props.type ?? "text",
        onInput: (event: Event) =>
          emit("update:modelValue", (event.target as HTMLInputElement).value),
      });
  },
});

const ElButtonStub = defineComponent({
  name: "ElButton",
  inheritAttrs: false,
  props: {
    loading: Boolean,
  },
  emits: ["click"],
  setup(props, { attrs, emit, slots }) {
    return () =>
      h(
        "button",
        {
          ...attrs,
          type: "button",
          disabled: props.loading,
          "aria-busy": props.loading ? "true" : "false",
          onClick: (event: MouseEvent) => emit("click", event),
        },
        slots.default?.()
      );
  },
});

const i18n = createI18n({
  legacy: false,
  locale: "en-US",
  fallbackLocale: "en-US",
  messages: { "en-US": enUS, "zh-CN": zhCN },
});

config.global.plugins = [i18n, ElementPlus];

const stubs = {
  ElForm: ElFormStub,
  ElFormItem: ElFormItemStub,
  ElInput: ElInputStub,
  ElButton: ElButtonStub,
  LangSwitch: { template: "<div data-test=lang-switch />" },
};

const mountView = (query: Record<string, unknown> = {}) => {
  mocks.route.query = query;
  return mount(Login, { global: { stubs } });
};

const fillCredentials = async (
  wrapper: ReturnType<typeof mount>,
  email = "researcher@example.test",
  password = "Secure1!"
) => {
  const inputs = wrapper.findAll("input");
  await inputs[0].setValue(email);
  await inputs[1].setValue(password);
};

describe("Login auth surface", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    i18n.global.locale.value = "en-US";
    mocks.route.query = {};
    mocks.safeRedirect.mockReturnValue("/chat");
    mocks.login.mockResolvedValue({
      code: 200,
      data: {
        token: "token",
        user_name: "researcher",
        login_status: "1",
        password_warning: "Rotate your password soon",
      },
    });
  });

  it("mounts one login form on the horizon auth shell with the production logo", () => {
    const wrapper = mountView();

    expect(wrapper.find(".phy-auth-layout").classes()).toContain(
      "phy-auth-layout--horizon"
    );
    expect(wrapper.find('.phy-auth-brand img[src="/logo.png"]').exists()).toBe(
      true
    );
    expect(wrapper.findAll(".el-form")).toHaveLength(1);
    expect(wrapper.findAll(".login-button")).toHaveLength(1);
    expect(wrapper.find(".login-button").attributes("type")).toBe("button");
  });

  it("runs the authenticated reverse guard on mount", () => {
    const wrapper = mountView({ redirect: "/history" });
    expect(mocks.redirectIfAuthed).toHaveBeenCalledTimes(1);
    expect(mocks.redirectIfAuthed).toHaveBeenCalledWith(
      mocks.route,
      expect.objectContaining({ replace: mocks.replace })
    );
    wrapper.unmount();
  });

  it("keeps agreement destinations and route actions explicit", async () => {
    const wrapper = mountView();
    const terms = wrapper.get('a[href="/terms"]');
    const privacy = wrapper.get('a[href="/privacy"]');
    expect(terms.attributes("target")).toBe("_blank");
    expect(terms.attributes("rel")).toBe("noopener noreferrer");
    expect(privacy.attributes("target")).toBe("_blank");
    expect(privacy.attributes("rel")).toBe("noopener noreferrer");
    expect(terms.text()).toBe("Terms of Service");

    i18n.global.locale.value = "zh-CN";
    await nextTick();
    expect(wrapper.get('a[href="/terms"]').text()).toBe("服务条款");

    await wrapper.get('a[href="/forgot-password"]').trigger("click");
    await wrapper.get('a[href="/register"]').trigger("click");
    expect(mocks.push).toHaveBeenNthCalledWith(1, "/forgot-password");
    expect(mocks.push).toHaveBeenNthCalledWith(2, "/register");
  });

  it("blocks invalid credentials before creating a request", async () => {
    const wrapper = mountView();
    await wrapper.get(".login-button").trigger("click");
    await flushPromises();
    expect(mocks.login).not.toHaveBeenCalled();
    expect(mocks.setToken).not.toHaveBeenCalled();
  });

  it("preserves FormData, token/store order, warning, and safe redirect on success", async () => {
    mocks.safeRedirect.mockReturnValue("/history?tab=recent");
    const wrapper = mountView({ redirect: "/history" });
    await fillCredentials(wrapper);
    await wrapper.get(".login-button").trigger("click");
    await flushPromises();

    expect([...mocks.login.mock.calls[0][0].entries()]).toEqual([
      ["email", "researcher@example.test"],
      ["password", "Secure1!"],
    ]);
    expect(mocks.setToken).toHaveBeenCalledWith("token");
    expect(mocks.store.SET_USER_NAME).toHaveBeenCalledWith("researcher");
    expect(mocks.store.SET_LOGIN_STATUS).toHaveBeenCalledWith("1");
    expect(mocks.safeRedirect).toHaveBeenCalledWith("/history", "/chat");
    expect(mocks.replace).toHaveBeenCalledWith("/history?tab=recent");
    expect(mocks.success).toHaveBeenCalledWith("Login successful");
    expect(mocks.notification).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Password Security Notice",
        message: "Rotate your password soon",
      })
    );
    expect(mocks.setToken.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.store.SET_USER_NAME.mock.invocationCallOrder[0]
    );
    expect(mocks.store.SET_USER_NAME.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.store.SET_LOGIN_STATUS.mock.invocationCallOrder[0]
    );
  });

  it("notifies first-login users and replaces to password change before redirect", async () => {
    mocks.login.mockResolvedValueOnce({
      code: 200,
      data: {
        token: "first-login-token",
        user_name: "new-user",
        login_status: "0",
      },
    });
    const wrapper = mountView();
    await fillCredentials(wrapper);
    await wrapper.get(".login-button").trigger("click");
    await flushPromises();

    expect(mocks.store.SET_LOGIN_STATUS).toHaveBeenCalledTimes(1);
    expect(mocks.notification).toHaveBeenCalledWith(
      expect.objectContaining({ title: "First Login Notice" })
    );
    expect(mocks.replace).toHaveBeenCalledWith("/change-password");
    expect(mocks.safeRedirect).not.toHaveBeenCalled();
  });

  it("handles locked responses and rejected requests while resetting loading", async () => {
    let resolveLogin!: (value: unknown) => void;
    mocks.login.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveLogin = resolve;
      })
    );
    const wrapper = mountView();
    await fillCredentials(wrapper);
    await wrapper.get(".login-button").trigger("click");
    await flushPromises();
    expect(wrapper.get(".login-button").attributes("aria-busy")).toBe("true");
    resolveLogin({ code: 401, data: { locked: true }, message: "Locked" });
    await flushPromises();
    expect(mocks.notification).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Account Locked", message: "Locked" })
    );
    expect(wrapper.get(".login-button").attributes("aria-busy")).toBe("false");

    mocks.login.mockRejectedValueOnce({
      response: { data: { locked: true, message: "Rejected lock" } },
    });
    await wrapper.get(".login-button").trigger("click");
    await flushPromises();
    expect(mocks.notification).toHaveBeenLastCalledWith(
      expect.objectContaining({
        title: "Account Locked",
        message: "Rejected lock",
      })
    );
    expect(wrapper.get(".login-button").attributes("aria-busy")).toBe("false");
  });

  it("uses the normal error toast for non-locked responses and rejections", async () => {
    mocks.login.mockResolvedValueOnce({
      code: 401,
      message: "Invalid credentials",
    });
    const wrapper = mountView();
    await fillCredentials(wrapper);
    await wrapper.get(".login-button").trigger("click");
    await flushPromises();
    expect(mocks.error).toHaveBeenCalledWith("Invalid credentials");

    mocks.login.mockRejectedValueOnce({ message: "Network unavailable" });
    await wrapper.get(".login-button").trigger("click");
    await flushPromises();
    expect(mocks.error).toHaveBeenLastCalledWith("Network unavailable");
  });

  it("keeps the dormant registration branch unreachable and auth-safe", async () => {
    const wrapper = mountView();
    expect(wrapper.find(".register-container").exists()).toBe(true);
    expect(wrapper.findAll(".login-button")).toHaveLength(1);
    const source = readFileSync(
      resolve(__dirname, "../../src/views/login/index.vue"),
      "utf8"
    );
    expect(source).toContain("isLogin");
    expect(source).toContain("handleRegister");
    expect(source).not.toMatch(/console\.(?:log|info|debug|warn|error)\s*\(/);
    expect(source).not.toContain("height: 100vh");
    expect(source).not.toContain("overflow-y:");
  });
});
