import { beforeEach, describe, expect, it, vi } from "vitest";
import { config, flushPromises, mount } from "@vue/test-utils";
import { computed, defineComponent, h, reactive, ref, inject, provide } from "vue";
import { createI18n } from "vue-i18n";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import ElementPlus from "element-plus";
import enUS from "@/locales/langs/en-US";
import zhCN from "@/locales/langs/zh-CN";

const mocks = vi.hoisted(() => ({
  changePassword: vi.fn(),
  back: vi.fn(),
  replace: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
  warning: vi.fn(),
  store: undefined as
    | {
        name: string;
        login_status: string;
        isFirstLogin: boolean | { readonly value: boolean };
        FedLogOut: ReturnType<typeof vi.fn>;
      }
    | undefined,
}));

vi.mock("@/api/auth", () => ({ changePassword: mocks.changePassword }));
vi.mock("@/stores", () => ({ userStore: () => mocks.store }));
vi.mock("vue-router", () => ({
  useRouter: () => ({ back: mocks.back, replace: mocks.replace }),
}));
vi.mock("element-plus", async () => {
  const actual = await vi.importActual<typeof import("element-plus")>(
    "element-plus",
  );
  return {
    ...actual,
    ElMessage: {
      success: mocks.success,
      error: mocks.error,
      warning: mocks.warning,
    },
  };
});

import ChangePassword from "@/views/change-password/index.vue";

type Rule = {
  required?: boolean;
  min?: number;
  message?: string;
  validator?: (
    rule: unknown,
    value: string,
    callback: (error?: Error) => void,
  ) => void;
};

const formErrorsKey = Symbol("change-password-errors");

const ElFormStub = defineComponent({
  name: "ElForm",
  props: {
    model: { type: Object, required: true },
    rules: { type: Object, default: () => ({}) },
  },
  setup(props, { expose, slots }) {
    const errors = ref<Record<string, string>>({});
    provide(formErrorsKey, errors);
    const validate = async (callback?: (valid: boolean) => void) => {
      const nextErrors: Record<string, string> = {};
      for (const [field, rawRules] of Object.entries(props.rules)) {
        const value = String(
          (props.model as Record<string, unknown>)[field] ?? "",
        );
        for (const rule of rawRules as Rule[]) {
          if (rule.required && !value) {
            nextErrors[field] = rule.message ?? "Required";
            break;
          }
          if (rule.min && value.length < rule.min) {
            nextErrors[field] = rule.message ?? `Minimum ${rule.min}`;
            break;
          }
          if (rule.validator) {
            await new Promise<void>((done) => {
              rule.validator?.({}, value, (error) => {
                if (error) nextErrors[field] = error.message;
                done();
              });
            });
            if (nextErrors[field]) break;
          }
        }
      }
      errors.value = nextErrors;
      const valid = Object.keys(nextErrors).length === 0;
      callback?.(valid);
      return valid;
    };
    const validateField = async (field: string) => {
      const rawRules = (props.rules as Record<string, Rule[]>)[field] ?? [];
      const value = String(
        (props.model as Record<string, unknown>)[field] ?? "",
      );
      for (const rule of rawRules) {
        if (rule.validator) {
          await new Promise<void>((done) => {
            rule.validator?.({}, value, () => done());
          });
        }
      }
    };
    expose({ validate, validateField, resetFields: vi.fn() });
    return () => h("form", { class: "el-form" }, slots.default?.());
  },
});

const ElFormItemStub = defineComponent({
  name: "ElFormItem",
  props: { label: String, prop: String },
  setup(props, { slots }) {
    const errors = inject(
      formErrorsKey,
      computed(() => ({} as Record<string, string>)),
    );
    return () =>
      h("section", { class: "el-form-item", "data-prop": props.prop }, [
        props.label ? h("label", props.label) : null,
        slots.default?.(),
        props.prop && errors.value[props.prop]
          ? h("p", { class: "el-form-item__error" }, errors.value[props.prop])
          : null,
      ]);
  },
});

const ElInputStub = defineComponent({
  name: "ElInput",
  inheritAttrs: false,
  props: {
    modelValue: String,
    type: String,
    disabled: Boolean,
    placeholder: String,
  },
  emits: ["update:modelValue"],
  setup(props, { attrs, emit }) {
    return () =>
      h("input", {
        ...attrs,
        value: props.modelValue,
        type: props.type ?? "text",
        disabled: props.disabled,
        placeholder: props.placeholder,
        onInput: (event: Event) =>
          emit("update:modelValue", (event.target as HTMLInputElement).value),
      });
  },
});

const ElButtonStub = defineComponent({
  name: "ElButton",
  inheritAttrs: false,
  props: { loading: Boolean, disabled: Boolean },
  emits: ["click"],
  setup(props, { attrs, emit, slots }) {
    return () =>
      h(
        "button",
        {
          ...attrs,
          type: "button",
          disabled: props.disabled || props.loading,
          "aria-busy": props.loading ? "true" : "false",
          onClick: (event: MouseEvent) => emit("click", event),
        },
        slots.default?.(),
      );
  },
});

const stubs = {
  ElForm: ElFormStub,
  ElFormItem: ElFormItemStub,
  ElInput: ElInputStub,
  ElButton: ElButtonStub,
  ElIcon: { template: "<span><slot /></span>" },
  LangSwitch: { template: "<div data-test=lang-switch />" },
};

const makeStore = (loginStatus = "0") => {
  return reactive({
    name: "researcher@example.test",
    login_status: loginStatus,
    isFirstLogin: computed(() => loginStatus === "0"),
    FedLogOut: vi.fn(),
  });
};

const mountView = (loginStatus = "0") => {
  const store = makeStore(loginStatus);
  mocks.store = store;
  const i18n = createI18n({
    legacy: false,
    locale: "en-US",
    fallbackLocale: "en-US",
    messages: { "en-US": enUS, "zh-CN": zhCN },
  });
  return mount(ChangePassword, {
    global: { plugins: [i18n, ElementPlus], stubs },
  });
};

const fillForm = async (
  wrapper: ReturnType<typeof mount>,
  oldPassword = "Current1!",
  newPassword = "Secure1!",
  confirmPassword = newPassword,
) => {
  const inputs = wrapper.findAll("input");
  await inputs[1].setValue(oldPassword);
  await inputs[2].setValue(newPassword);
  await inputs[3].setValue(confirmPassword);
};

describe("Change Password surface", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.changePassword.mockResolvedValue({ code: 200 });
    mocks.store = undefined;
    sessionStorage.clear();
  });

  it("uses the auth shell with one bounded form and hides Back for first login", () => {
    const wrapper = mountView("0");
    expect(wrapper.findComponent({ name: "PhyAuthLayout" }).exists()).toBe(true);
    expect(wrapper.find(".change-password-page").exists()).toBe(false);
    expect(wrapper.find(".change-password-back").exists()).toBe(false);
    expect(wrapper.find(".change-password-form").exists()).toBe(true);
    expect(wrapper.findAll("input")).toHaveLength(4);
  });

  it("shows Back for returning users and uses router.back", async () => {
    const wrapper = mountView("1");
    const back = wrapper.find(".change-password-back");
    expect(back.exists()).toBe(true);
    await back.trigger("click");
    expect(mocks.back).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["old password is required", "", "Secure1!", "Please enter old password"],
    ["new password is required", "Current1!", "", "Please enter new password"],
    ["new password needs eight characters", "Current1!", "Short1!", "Password must be at least 8 characters"],
    ["new password needs an uppercase letter", "Current1!", "secure1!", "Password must contain uppercase letters"],
    ["new password needs a lowercase letter", "Current1!", "SECURE1!", "Password must contain lowercase letters"],
    ["new password needs a number", "Current1!", "Secure!!", "Password must contain numbers"],
    ["new password needs a special character", "Current1!", "Secure12", "Password must contain special characters"],
    ["new password cannot equal old password", "Current1!", "Current1!", "New password cannot be the same as old password"],
    ["confirmation must match", "Current1!", "Secure1!", "Passwords do not match", "Another1!"],
  ])("rejects %s", async (_name, oldPassword, newPassword, message, confirmation) => {
    const wrapper = mountView("1");
    await fillForm(wrapper, oldPassword, newPassword, confirmation);
    await wrapper.get(".change-password-submit").trigger("click");
    await flushPromises();
    expect(wrapper.text()).toContain(message);
    expect(mocks.changePassword).not.toHaveBeenCalled();
  });

  it("preserves the FormData payload and writes tutorial state before /login when logout resolves", async () => {
    const store = makeStore("0");
    const logout = vi.fn().mockResolvedValue(undefined);
    store.FedLogOut = logout;
    mocks.store = store;
    const wrapper = mountView("0");
    (mocks.store as typeof store).FedLogOut = logout;
    await fillForm(wrapper);
    await wrapper.get(".change-password-submit").trigger("click");
    await flushPromises();
    expect([...mocks.changePassword.mock.calls[0][0].entries()]).toEqual([
      ["password", "Current1!"],
      ["new_password", "Secure1!"],
    ]);
    expect(logout).toHaveBeenCalledTimes(1);
    expect(sessionStorage.getItem("tutorial_pending")).toBe("1");
    expect(mocks.replace).toHaveBeenCalledWith("/login");
  });

  it("runs the same tutorial hand-off and /login replacement when logout rejects", async () => {
    const store = makeStore("1");
    const logout = vi.fn().mockRejectedValue(new Error("storage unavailable"));
    store.FedLogOut = logout;
    mocks.store = store;
    const wrapper = mountView("1");
    (mocks.store as typeof store).FedLogOut = logout;
    await fillForm(wrapper);
    await wrapper.get(".change-password-submit").trigger("click");
    await flushPromises();
    expect(sessionStorage.getItem("tutorial_pending")).toBe("1");
    expect(mocks.replace).toHaveBeenCalledWith("/login");
  });

  it("reports server failures without logout or navigation", async () => {
    mocks.changePassword.mockResolvedValueOnce({
      code: 400,
      message: "Rejected",
    });
    const wrapper = mountView("1");
    await fillForm(wrapper);
    await wrapper.get(".change-password-submit").trigger("click");
    await flushPromises();
    expect(mocks.error).toHaveBeenCalledWith("Rejected");
    expect(mocks.store?.FedLogOut).not.toHaveBeenCalled();
    expect(mocks.replace).not.toHaveBeenCalled();

    mocks.changePassword.mockRejectedValueOnce({ response: { data: {} } });
    await wrapper.get(".change-password-submit").trigger("click");
    await flushPromises();
    expect(mocks.warning).toHaveBeenCalledWith(
      "Failed to change password, please try again later",
    );
  });

  it("has no sensitive logging or status writer and keeps 48px shell controls", () => {
    const source = readFileSync(
      resolve(__dirname, "../../src/views/change-password/index.vue"),
      "utf8",
    );
    expect(source).not.toMatch(/console\.(?:log|info|debug|warn|error)\s*\(/);
    expect(source).not.toContain("SET_LOGIN_STATUS");
    expect(source).toContain("PhyAuthLayout");
    expect(source).toContain("--phy-control-height-primary");
    expect(source).not.toContain("height: 100vh");
  });
});
