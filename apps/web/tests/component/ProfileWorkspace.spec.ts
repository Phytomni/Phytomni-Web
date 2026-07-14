import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { config, flushPromises, mount } from "@vue/test-utils";
import { createI18n } from "vue-i18n";
import {
  computed,
  defineComponent,
  h,
  inject,
  provide,
  ref,
  type InjectionKey,
  type Ref,
} from "vue";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import enUS from "@/locales/langs/en-US";
import zhCN from "@/locales/langs/zh-CN";
import { datetimeFormats } from "@/locales/datetime-formats";
import { formatDisplayDate } from "@/locales/format-display-date";

const mocks = vi.hoisted(() => ({
  getUserProfile: vi.fn(),
  changePassword: vi.fn(),
  replace: vi.fn(),
  FedLogOut: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
  warning: vi.fn(),
  store: {
    name: "researcher@example.test",
    permission: "vip_user",
    FedLogOut: vi.fn(),
  },
}));

vi.mock("@/api/auth", () => ({
  getUserProfile: mocks.getUserProfile,
  changePassword: mocks.changePassword,
}));
vi.mock("@/stores", () => ({ userStore: () => mocks.store }));
vi.mock("vue-router", () => ({
  useRouter: () => ({ replace: mocks.replace }),
}));
vi.mock("element-plus", () => ({
  ElMessage: {
    success: mocks.success,
    error: mocks.error,
    warning: mocks.warning,
  },
}));

import ProfileWorkspace from "@/views/profile/index.vue";

type Rule = {
  required?: boolean;
  message?: string | (() => string);
  validator?: (
    rule: unknown,
    value: string,
    callback: (error?: Error) => void
  ) => void;
};

const formErrorsKey: InjectionKey<Ref<Record<string, string>>> =
  Symbol("form-errors");

const ElButtonStub = defineComponent({
  name: "ElButton",
  inheritAttrs: false,
  emits: ["click"],
  setup(_, { attrs, emit, slots }) {
    return () =>
      h(
        "button",
        {
          ...attrs,
          type: "button",
          disabled: attrs.disabled === true || attrs.loading === true,
          "aria-busy": attrs.loading ? "true" : "false",
          onClick: (event: MouseEvent) => emit("click", event),
        },
        slots.default?.()
      );
  },
});

const ElDialogStub = defineComponent({
  name: "ElDialog",
  props: { modelValue: Boolean, title: String },
  setup(props, { slots }) {
    return () =>
      props.modelValue
        ? h("section", { class: "el-dialog", "data-title": props.title }, [
            slots.default?.(),
            slots.footer?.(),
          ])
        : null;
  },
});

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
      for (const [field, fieldRules] of Object.entries(props.rules)) {
        for (const rule of fieldRules as Rule[]) {
          const value = String(
            (props.model as Record<string, unknown>)[field] ?? ""
          );
          if (rule.required && !value) {
            nextErrors[field] =
              typeof rule.message === "function"
                ? rule.message()
                : rule.message ?? "Required";
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

    expose({ validate });
    return () => h("form", { class: "el-form" }, slots.default?.());
  },
});

const ElFormItemStub = defineComponent({
  name: "ElFormItem",
  props: { label: String, prop: String },
  setup(props, { slots }) {
    const errors = inject(
      formErrorsKey,
      computed(() => ({}))
    );
    return () =>
      h("section", { class: "el-form-item", "data-prop": props.prop }, [
        h("label", props.label),
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
        type: props.type,
        disabled: props.disabled,
        placeholder: props.placeholder,
        onInput: (event: Event) =>
          emit("update:modelValue", (event.target as HTMLInputElement).value),
      });
  },
});

const stubs = {
  ElButton: ElButtonStub,
  ElDialog: ElDialogStub,
  ElForm: ElFormStub,
  ElFormItem: ElFormItemStub,
  ElInput: ElInputStub,
  ElTag: {
    props: { type: String },
    template: '<span class="el-tag"><slot /></span>',
  },
  ElIcon: { template: "<span><slot /></span>" },
};

config.global.plugins = [];

const profile = {
  email: "researcher@example.test",
  phone: "010-5555-0101",
  organization: "CAAS BRI",
  position: "Scientist",
  dialogue_count: 12,
  last_login_at: "2026-07-12T08:30:45.000Z",
};

const makeI18n = () =>
  createI18n({
    legacy: false,
    locale: "en-US",
    fallbackLocale: "en-US",
    messages: { "en-US": enUS, "zh-CN": zhCN },
    datetimeFormats,
  });

const mountView = () => {
  const i18n = makeI18n();
  return {
    i18n,
    wrapper: mount(ProfileWorkspace, { global: { plugins: [i18n], stubs } }),
  };
};

const openPasswordDialog = async (wrapper: ReturnType<typeof mount>) => {
  await wrapper.get(".profile-password-action").trigger("click");
};

const setPassword = async (
  wrapper: ReturnType<typeof mount>,
  oldPassword: string,
  newPassword: string,
  confirmPassword = newPassword
) => {
  const fields = wrapper.findAll(".profile-password-form input");
  await fields[0].setValue(oldPassword);
  await fields[1].setValue(newPassword);
  await fields[2].setValue(confirmPassword);
};

const submitPassword = async (wrapper: ReturnType<typeof mount>) => {
  await wrapper.get(".profile-password-submit").trigger("click");
  await flushPromises();
};

const findLoginStatusWriters = (directory: string): string[] =>
  readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) return findLoginStatusWriters(path);
    if (!entry.isFile() || !/\.(?:ts|vue)$/.test(path)) return [];
    return readFileSync(path, "utf8").includes("SET_LOGIN_STATUS")
      ? [path]
      : [];
  });

describe("Profile workspace", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.store.name = "researcher@example.test";
    mocks.store.permission = "vip_user";
    mocks.store.FedLogOut = mocks.FedLogOut;
    mocks.getUserProfile.mockResolvedValue({ code: 200, data: { ...profile } });
    mocks.changePassword.mockResolvedValue({ code: 200 });
    mocks.FedLogOut.mockResolvedValue(undefined);
  });

  afterEach(() => vi.restoreAllMocks());

  it("shows shared loading, ready, and retryable error states while preserving the current-user request", async () => {
    let resolveProfile: (value: { code: number; data: typeof profile }) => void;
    mocks.getUserProfile.mockImplementationOnce(
      () => new Promise((resolve) => (resolveProfile = resolve))
    );
    const { wrapper } = mountView();
    await wrapper.vm.$nextTick();

    expect(
      wrapper.find(".phy-workspace-shell.profile-workspace").exists()
    ).toBe(true);
    expect(wrapper.find(".phy-async-state--loading").exists()).toBe(true);
    expect(mocks.getUserProfile).toHaveBeenCalledWith(
      "researcher@example.test"
    );

    if (!resolveProfile) throw new Error("profile resolver was not created");
    resolveProfile({ code: 200, data: { ...profile } });
    await flushPromises();

    expect(wrapper.find(".phy-async-state--ready").exists()).toBe(true);
    expect(wrapper.get(".profile-identity__email").text()).toBe(profile.email);
    expect(
      wrapper.get(".profile-readonly-field input").attributes("disabled")
    ).toBeDefined();

    mocks.getUserProfile.mockRejectedValueOnce(new Error("offline"));
    const failed = mountView().wrapper;
    await flushPromises();
    expect(failed.find(".phy-async-state--error").exists()).toBe(true);
    await failed.get(".phy-error-state__retry").trigger("click");
    await flushPromises();
    expect(mocks.getUserProfile).toHaveBeenCalledTimes(3);
    expect(mocks.error).toHaveBeenCalledWith(
      "Failed to fetch user information"
    );
  });

  it("retains raw last-login data so it reformats immediately when the locale changes", async () => {
    const { i18n, wrapper } = mountView();
    await flushPromises();
    const englishDate = wrapper.get(".profile-last-login").text();
    expect(englishDate).toBe(
      formatDisplayDate(i18n.global.d, profile.last_login_at, "datetime")
    );

    i18n.global.locale.value = "zh-CN";
    await wrapper.vm.$nextTick();
    expect(wrapper.get(".profile-last-login").text()).toBe(
      formatDisplayDate(i18n.global.d, profile.last_login_at, "datetime")
    );
    expect(wrapper.get(".profile-last-login").text()).not.toBe(englishDate);
  });

  it.each([
    [
      "requires the current password",
      "",
      "Secure1!",
      "Please enter old password",
    ],
    ["requires a new password", "Current1!", "", "Please enter password"],
    [
      "rejects new passwords shorter than eight characters",
      "Current1!",
      "Short1!",
      "Password must be at least 8 characters",
    ],
    [
      "rejects new passwords longer than sixteen characters",
      "Current1!",
      "LongPassword12345!",
      "Password must not exceed 16 characters",
    ],
    [
      "requires an uppercase letter",
      "Current1!",
      "secure1!",
      "Password must contain uppercase letters",
    ],
    [
      "requires a lowercase letter",
      "Current1!",
      "SECURE1!",
      "Password must contain lowercase letters",
    ],
    [
      "requires a number",
      "Current1!",
      "Secure!!",
      "Password must contain numbers",
    ],
    [
      "requires a special character",
      "Current1!",
      "Secure12",
      "Password must contain special characters",
    ],
    [
      "requires confirmation",
      "Current1!",
      "Secure1!",
      "Passwords do not match",
      "",
    ],
    [
      "requires matching confirmation",
      "Current1!",
      "Secure1!",
      "Passwords do not match",
      "Another1!",
    ],
  ])(
    "%s",
    async (
      _name,
      oldPassword,
      newPassword,
      expectedError,
      confirmation = newPassword
    ) => {
      const { wrapper } = mountView();
      await flushPromises();
      await openPasswordDialog(wrapper);
      await setPassword(wrapper, oldPassword, newPassword, confirmation);
      await submitPassword(wrapper);

      expect(wrapper.text()).toContain(expectedError);
      expect(mocks.changePassword).not.toHaveBeenCalled();
    }
  );

  it("uses the unchanged FormData payload, stays busy, then forces logout before /login without a tutorial write", async () => {
    let resolvePassword: (value: { code: number }) => void;
    let resolveLogout: () => void;
    mocks.changePassword.mockImplementationOnce(
      () => new Promise((resolve) => (resolvePassword = resolve))
    );
    mocks.FedLogOut.mockImplementationOnce(
      () => new Promise<void>((resolve) => (resolveLogout = resolve))
    );
    const tutorialSet = vi.spyOn(Storage.prototype, "setItem");
    const { wrapper } = mountView();
    await flushPromises();
    await openPasswordDialog(wrapper);
    await setPassword(wrapper, "Current1!", "Secure1!");
    await wrapper.get(".profile-password-submit").trigger("click");

    expect(
      wrapper.get(".profile-password-submit").attributes("aria-busy")
    ).toBe("true");
    expect(
      wrapper.get(".profile-password-submit").attributes("disabled")
    ).toBeDefined();
    if (!resolvePassword) throw new Error("password resolver was not created");
    resolvePassword({ code: 200 });
    await flushPromises();

    const payload = mocks.changePassword.mock.calls[0][0] as FormData;
    expect([...payload.entries()]).toEqual([
      ["password", "Current1!"],
      ["new_password", "Secure1!"],
    ]);
    expect(mocks.FedLogOut).toHaveBeenCalledTimes(1);
    expect(mocks.replace).not.toHaveBeenCalled();
    expect(tutorialSet).not.toHaveBeenCalledWith("tutorial_pending", "1");

    if (!resolveLogout) throw new Error("logout resolver was not created");
    resolveLogout();
    await flushPromises();
    expect(mocks.replace).toHaveBeenCalledWith("/login");
  });

  it("keeps the password dialog open and avoids logout/navigation after failed responses or requests", async () => {
    mocks.changePassword.mockResolvedValueOnce({
      code: 500,
      message: "Change rejected",
    });
    const { wrapper } = mountView();
    await flushPromises();
    await openPasswordDialog(wrapper);
    await setPassword(wrapper, "Current1!", "Secure1!");
    await submitPassword(wrapper);
    expect(wrapper.find(".el-dialog").exists()).toBe(true);
    expect(mocks.error).toHaveBeenCalledWith(
      "Failed to change password, please try again"
    );
    expect(mocks.FedLogOut).not.toHaveBeenCalled();
    expect(mocks.replace).not.toHaveBeenCalled();

    mocks.changePassword.mockRejectedValueOnce({
      response: { data: { message: "server detail" } },
    });
    await submitPassword(wrapper);
    expect(mocks.warning).toHaveBeenCalledWith(
      "Failed to change password, please try again"
    );
    expect(mocks.FedLogOut).not.toHaveBeenCalled();
    expect(mocks.replace).not.toHaveBeenCalled();
  });

  it("keeps profile free of sensitive logs and preserves the approved login-status writer boundary", () => {
    const profileSource = readFileSync(
      resolve(__dirname, "../../src/views/profile/index.vue"),
      "utf8"
    );
    expect(profileSource).not.toMatch(
      /console\.(?:log|info|debug|warn|error)\s*\(/
    );
    expect(profileSource).not.toContain("tutorial_pending");
    expect(profileSource).not.toContain("SET_LOGIN_STATUS");

    const srcDirectory = resolve(__dirname, "../../src");
    const writers = findLoginStatusWriters(srcDirectory)
      .map((file) => file.replace(`${srcDirectory}/`, ""))
      .sort();
    expect(writers).toEqual(["stores/user.ts", "views/login/index.vue"]);
  });
});
