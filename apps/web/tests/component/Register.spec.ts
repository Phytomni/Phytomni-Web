import { beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises } from "@vue/test-utils";
import { defineComponent, h, nextTick } from "vue";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  createTestAppContext,
  mountWithApp,
} from "../helpers/test-app-context";

const mocks = vi.hoisted(() => ({
  register: vi.fn(),
  redirectIfAuthed: vi.fn(),
  push: vi.fn(),
  replace: vi.fn(),
  success: vi.fn(),
  warning: vi.fn(),
  error: vi.fn(),
  formValidateReject: false,
  validateFieldReject: false,
  route: { query: {} as Record<string, unknown> },
}));

vi.mock("vue-router", () => ({
  useRouter: () => ({ push: mocks.push, replace: mocks.replace }),
  useRoute: () => mocks.route,
}));
vi.mock("@/api/auth", () => ({ register: mocks.register }));
vi.mock("@/utils/auth-redirect", () => ({
  redirectIfAuthed: mocks.redirectIfAuthed,
}));
vi.mock("element-plus", async () => {
  const actual = await vi.importActual<typeof import("element-plus")>(
    "element-plus"
  );
  return {
    ...actual,
    ElMessage: {
      success: mocks.success,
      warning: mocks.warning,
      error: mocks.error,
    },
  };
});

import Register from "@/views/register/RegisterView.vue";

const SOURCE = readFileSync(
  resolve(__dirname, "../../src/views/register/RegisterView.vue"),
  "utf8"
);

type Rule = {
  required?: boolean;
  type?: string;
  min?: number;
  max?: number;
  validator?: (
    rule: unknown,
    value: string,
    callback: (error?: Error) => void
  ) => void;
};

const ElFormStub = defineComponent({
  name: "ElForm",
  props: {
    model: { type: Object, required: true },
    rules: { type: Object, default: () => ({}) },
  },
  setup(props, { expose, slots }) {
    const validate = async (callback?: (valid: boolean) => void) => {
      if (mocks.formValidateReject) {
        throw new Error("validation unavailable");
      }
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
          if (rule.validator) {
            let error: Error | undefined;
            rule.validator({}, value, (validationError) => {
              error = validationError;
            });
            if (error) {
              valid = false;
              break;
            }
          }
        }
      }
      callback?.(valid);
      return valid;
    };

    const validateField = async () => {
      if (mocks.validateFieldReject) {
        throw new Error("field validation unavailable");
      }
    };
    expose({ validate, validateField });
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

const ElCheckboxStub = defineComponent({
  name: "ElCheckbox",
  props: { modelValue: Boolean },
  emits: ["update:modelValue"],
  setup(props, { emit, slots }) {
    return () =>
      h("label", { class: "el-checkbox" }, [
        h("input", {
          type: "checkbox",
          checked: props.modelValue,
          onChange: (event: Event) =>
            emit(
              "update:modelValue",
              (event.target as HTMLInputElement).checked
            ),
        }),
        slots.default?.(),
      ]);
  },
});

const ElButtonStub = defineComponent({
  name: "ElButton",
  inheritAttrs: false,
  props: {
    loading: Boolean,
    disabled: Boolean,
  },
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
        slots.default?.()
      );
  },
});

let context: ReturnType<typeof createTestAppContext>;

const stubs = {
  ElForm: ElFormStub,
  ElFormItem: ElFormItemStub,
  ElInput: ElInputStub,
  ElCheckbox: ElCheckboxStub,
  ElButton: ElButtonStub,
  LangSwitch: { template: "<div data-test=lang-switch />" },
};

const mountView = () => context.mount(Register, { global: { stubs } });

const fillRegistration = async (
  wrapper: ReturnType<typeof mountWithApp>,
  email = "researcher@example.test",
  password = "Secure1!"
) => {
  const inputs = wrapper.findAll("input");
  await inputs[0].setValue(email);
  await inputs[1].setValue(password);
  await inputs[2].setValue(password);
};

describe("Registration auth surface", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    context = createTestAppContext({ locale: "en-US" });
    mocks.route.query = {};
    mocks.formValidateReject = false;
    mocks.validateFieldReject = false;
    mocks.register.mockResolvedValue({ code: 200 });
  });

  it("uses the auth shell title, description, and production logo", () => {
    const wrapper = mountView();

    expect(wrapper.find(".phy-auth-layout").exists()).toBe(true);
    expect(wrapper.find('.phy-auth-brand img[src="/logo.png"]').exists()).toBe(
      true
    );
    expect(wrapper.find(".register-title").element.tagName).toBe("H1");
    expect(wrapper.find(".register-subtitle").element.tagName).toBe("P");
    expect(wrapper.findAll('.phy-auth-brand img[src="/logo.png"]')).toHaveLength(
      1
    );
    expect(wrapper.findAll("h1")).toHaveLength(1);
    expect(wrapper.get(".register-title").text()).toBe("Create Account");
    expect(wrapper.get(".register-subtitle").text()).toBe(
      "Create your Phytomni account"
    );
    expect(wrapper.findAll(".el-form")).toHaveLength(1);
    expect(wrapper.find(".phy-auth-footer").exists()).toBe(true);
  });

  it("runs the authenticated reverse guard on mount", () => {
    const wrapper = mountView();

    expect(mocks.redirectIfAuthed).toHaveBeenCalledTimes(1);
    expect(mocks.redirectIfAuthed).toHaveBeenCalledWith(
      mocks.route,
      expect.objectContaining({ replace: mocks.replace })
    );
    wrapper.unmount();
  });

  it("keeps consent unchecked, gates submit, and isolates legal links", async () => {
    const wrapper = mountView();
    const checkbox = wrapper.get('input[type="checkbox"]');
    const button = wrapper.get(".register-button");

    expect((checkbox.element as HTMLInputElement).checked).toBe(false);
    expect(button.attributes("disabled")).toBeDefined();
    for (const selector of ['a[href="/terms"]', 'a[href="/privacy"]']) {
      const event = new MouseEvent("click", {
        bubbles: true,
        cancelable: true,
      });
      event.preventDefault();
      wrapper.get(selector).element.dispatchEvent(event);
    }
    expect((checkbox.element as HTMLInputElement).checked).toBe(false);

    await checkbox.setValue(true);
    expect(button.attributes("disabled")).toBeUndefined();
    expect(wrapper.get('a[href="/terms"]').attributes()).toMatchObject({
      target: "_blank",
      rel: "noopener noreferrer",
    });
    expect(wrapper.get('a[href="/privacy"]').attributes()).toMatchObject({
      target: "_blank",
      rel: "noopener noreferrer",
    });
  });

  it("renders one explicit consent copy and one link set in both locales", async () => {
    const wrapper = mountView();
    const assertConsent = (consent: string, terms: string, privacy: string) => {
      const agreement = wrapper.get(".register-agreement").text();
      expect(
        wrapper.get(".register-agreement").findAll('input[type="checkbox"]')
      ).toHaveLength(1);
      expect(
        wrapper.get(".register-agreement").findAll('a[href="/terms"]')
      ).toHaveLength(1);
      expect(
        wrapper.get(".register-agreement").findAll('a[href="/privacy"]')
      ).toHaveLength(1);
      expect(agreement).toContain(consent);
      expect(agreement.split(terms).length - 1).toBe(1);
      expect(agreement.split(privacy).length - 1).toBe(1);
    };

    assertConsent(
      "I have read and agree to the legal documents below",
      "Terms of Service",
      "Privacy Policy"
    );
    context.i18n.global.locale.value = "zh-CN";
    await nextTick();
    assertConsent("我已阅读并同意以下法律文件", "服务条款", "隐私政策");
  });

  it("uses the active locale for registration presentation copy", async () => {
    const wrapper = mountView();
    context.i18n.global.locale.value = "zh-CN";
    await nextTick();

    expect(wrapper.get(".register-title").text()).toBe("注册账户");
    expect(wrapper.get(".register-subtitle").text()).toBe(
      "创建您的农科发现大模型账户"
    );
  });

  it("wraps consent text inside the narrow auth card", () => {
    expect(SOURCE).toMatch(
      /\.register-agreement :deep\(\.el-checkbox__label\)[\s\S]*?overflow-wrap:\s*anywhere;[\s\S]*?white-space:\s*normal;/
    );
  });

  it("rejects every password rule and confirmation mismatch before a request", async () => {
    const wrapper = mountView();
    await wrapper.get('input[type="checkbox"]').setValue(true);
    const inputs = wrapper.findAll("input");
    await inputs[0].setValue("researcher@example.test");

    const invalidPasswords = [
      "Short1!", // fewer than 8 characters
      "ThisPasswordIsTooLong1!", // more than 16 characters
      "lowercase1!", // no uppercase
      "UPPERCASE1!", // no lowercase
      "NoNumber!", // no number
      "NoSpecial1", // no special character
    ];
    for (const password of invalidPasswords) {
      await inputs[1].setValue(password);
      await inputs[2].setValue(password);
      await wrapper.get(".register-button").trigger("click");
    }
    await inputs[1].setValue("Secure1!");
    await inputs[2].setValue("Secure2!");
    await wrapper.get(".register-button").trigger("click");
    await flushPromises();

    expect(mocks.register).not.toHaveBeenCalled();
  });

  it("keeps a rejected form validation from becoming an unhandled promise", async () => {
    mocks.formValidateReject = true;
    const wrapper = mountView();
    await wrapper.get('input[type="checkbox"]').setValue(true);
    await fillRegistration(wrapper);

    await wrapper.get(".register-button").trigger("click");
    await flushPromises();

    expect(mocks.register).not.toHaveBeenCalled();
    expect(wrapper.get(".register-button").attributes("aria-busy")).toBe(
      "false"
    );
  });

  it("keeps password revalidation best-effort when its promise rejects", async () => {
    mocks.validateFieldReject = true;
    const wrapper = mountView();
    await wrapper.get('input[type="checkbox"]').setValue(true);
    await fillRegistration(wrapper);

    await wrapper.get(".register-button").trigger("click");
    await flushPromises();

    expect(mocks.register).toHaveBeenCalledTimes(1);
  });

  it("preserves the exact FormData, success destination, and loading reset", async () => {
    const wrapper = mountView();
    await fillRegistration(wrapper);
    await wrapper.get('input[type="checkbox"]').setValue(true);
    await wrapper.get(".register-button").trigger("click");
    await flushPromises();

    expect([...mocks.register.mock.calls[0][0].entries()]).toEqual([
      ["email", "researcher@example.test"],
      ["password", "Secure1!"],
    ]);
    expect(mocks.replace).toHaveBeenCalledWith("/login");
    expect(wrapper.get(".register-button").attributes("aria-busy")).toBe(
      "false"
    );
  });

  it("surfaces a rejected post-registration redirect through the registration error path", async () => {
    mocks.replace.mockRejectedValueOnce(new Error("redirect unavailable"));
    const wrapper = mountView();
    await fillRegistration(wrapper);
    await wrapper.get('input[type="checkbox"]').setValue(true);
    await wrapper.get(".register-button").trigger("click");
    await flushPromises();

    expect(mocks.error).toHaveBeenCalledWith("redirect unavailable");
    expect(wrapper.get(".register-button").attributes("aria-busy")).toBe(
      "false"
    );
  });

  it("resets loading and surfaces backend failures without logging", async () => {
    mocks.register.mockResolvedValueOnce({
      code: 400,
      message: "Registration failed",
    });
    const wrapper = mountView();
    await fillRegistration(wrapper);
    await wrapper.get('input[type="checkbox"]').setValue(true);
    await wrapper.get(".register-button").trigger("click");
    await flushPromises();

    expect(mocks.error).toHaveBeenCalledWith("Registration failed");
    expect(wrapper.get(".register-button").attributes("aria-busy")).toBe(
      "false"
    );
  });

  it("resets loading and surfaces transport failures without logging", async () => {
    mocks.register.mockRejectedValueOnce(new Error("Network unavailable"));
    const wrapper = mountView();
    await fillRegistration(wrapper);
    await wrapper.get('input[type="checkbox"]').setValue(true);
    await wrapper.get(".register-button").trigger("click");
    await flushPromises();

    expect(mocks.error).toHaveBeenCalledWith("Network unavailable");
    expect(wrapper.get(".register-button").attributes("aria-busy")).toBe(
      "false"
    );
  });

  it("does not log registration requests, responses, errors, or payloads", () => {
    expect(SOURCE.match(/<PhyAuthBrand/g)).toHaveLength(1);
    expect(SOURCE.match(/<h1/g)).toHaveLength(1);
    expect(SOURCE).not.toMatch(/console\./);
  });
});
