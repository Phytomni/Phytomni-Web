import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises } from "@vue/test-utils";
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
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  createTestAppContext,
  mountWithApp,
} from "../helpers/test-app-context";

const mocks = vi.hoisted(() => ({
  feedback: vi.fn(),
  go: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
}));

vi.mock("@/api/feedback", () => ({ feedback: mocks.feedback }));
vi.mock("vue-router", () => ({ useRouter: () => ({ go: mocks.go }) }));
vi.mock("element-plus", async () => {
  const actual =
    await vi.importActual<typeof import("element-plus")>("element-plus");
  return {
    ...actual,
    ElMessage: { success: mocks.success, error: mocks.error },
    ElMessageBox: {},
  };
});

import FeedbackWorkspace from "@/views/feedback/FeedbackView.vue";

const FEEDBACK_SOURCE = readFileSync(
  resolve(__dirname, "../../src/views/feedback/FeedbackView.vue"),
  "utf8"
);

type Rule = {
  required?: boolean;
  min?: number;
  max?: number;
  message?: string | (() => string);
  trigger?: string;
};

const formErrorsKey: InjectionKey<Ref<Record<string, string>>> =
  Symbol("form-errors");

const messageFor = (rule: Rule) =>
  typeof rule.message === "function"
    ? rule.message()
    : (rule.message ?? "Invalid");

const ElFormStub = defineComponent({
  name: "ElForm",
  props: {
    model: { type: Object, required: true },
    rules: { type: Object, default: () => ({}) },
  },
  setup(props, { expose, slots }) {
    const errors = ref<Record<string, string>>({});
    provide(formErrorsKey, errors);

    const validate = async () => {
      const nextErrors: Record<string, string> = {};
      for (const [field, fieldRules] of Object.entries(props.rules)) {
        const value = String(
          (props.model as Record<string, unknown>)[field] ?? ""
        );
        for (const rule of fieldRules as Rule[]) {
          if (rule.required && !value) {
            nextErrors[field] = messageFor(rule);
            break;
          }
          if (rule.min !== undefined && value.length < rule.min) {
            nextErrors[field] = messageFor(rule);
            break;
          }
          if (rule.max !== undefined && value.length > rule.max) {
            nextErrors[field] = messageFor(rule);
            break;
          }
        }
      }
      errors.value = nextErrors;
      return Object.keys(nextErrors).length === 0;
    };

    expose({ validate, resetFields: () => (errors.value = {}) });
    return () => h("form", { class: "el-form" }, slots.default?.());
  },
});

const ElFormItemStub = defineComponent({
  name: "ElFormItem",
  props: { prop: String },
  setup(props, { slots }) {
    const errors = inject(
      formErrorsKey,
      computed(() => ({}))
    );
    return () =>
      h("section", { class: "el-form-item", "data-prop": props.prop }, [
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
  props: { modelValue: String, type: String, placeholder: String },
  emits: ["update:modelValue"],
  setup(props, { attrs, emit }) {
    return () =>
      h(props.type === "textarea" ? "textarea" : "input", {
        ...attrs,
        value: props.modelValue,
        placeholder: props.placeholder,
        onInput: (event: Event) =>
          emit("update:modelValue", (event.target as HTMLInputElement).value),
      });
  },
});

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
          "aria-busy": attrs.loading ? "true" : "false",
          onClick: (event: MouseEvent) => emit("click", event),
        },
        slots.default?.()
      );
  },
});

const stubs = {
  ElForm: ElFormStub,
  ElFormItem: ElFormItemStub,
  ElInput: ElInputStub,
  ElButton: ElButtonStub,
};

const mountView = (locale?: "en-US" | "zh-CN") =>
  createTestAppContext({ locale }).mount(FeedbackWorkspace, {
    global: { stubs },
  });

const setContent = async (
  wrapper: ReturnType<typeof mountWithApp>,
  content: string
) => {
  await wrapper.get("textarea").setValue(content);
};

const submit = async (wrapper: ReturnType<typeof mountWithApp>) => {
  await wrapper.get(".feedback-submit").trigger("click");
  await flushPromises();
};

describe("Feedback workspace", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.feedback.mockResolvedValue({ code: 200 });
  });

  it("keeps the form and action row fluid inside the workspace shell", () => {
    expect(FEEDBACK_SOURCE).toContain("PhyWorkspaceShell");
    expect(FEEDBACK_SOURCE).toContain("min-width: 0;");
    expect(FEEDBACK_SOURCE).toContain("flex-wrap: wrap;");
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("uses the shared workspace shell with a keyboard-ordered Submit and Reset form, without Back", () => {
    const wrapper = mountView();

    expect(
      wrapper.find(".phy-workspace-shell.feedback-workspace").exists()
    ).toBe(true);
    expect(wrapper.findAll("button").map((button) => button.text())).toEqual([
      "Submit Feedback",
      "Reset",
    ]);
    expect(wrapper.text()).not.toContain("Back");
  });

  it.each([
    ["", "Please enter feedback content"],
    ["a".repeat(9), "Feedback must be at least 10 characters"],
    ["a".repeat(1001), "Feedback cannot exceed 1000 characters"],
  ])(
    "rejects feedback content outside its 10–1000 character boundary",
    async (content, error) => {
      const wrapper = mountView();

      await setContent(wrapper, content);
      await submit(wrapper);

      expect(wrapper.get(".el-form-item__error").text()).toBe(error);
      expect(mocks.feedback).not.toHaveBeenCalled();
      const rules = wrapper.findComponent(ElFormStub).props("rules") as Record<
        string,
        Rule[]
      >;
      expect(rules.feedback_content).toEqual([
        expect.objectContaining({ required: true, trigger: "blur" }),
        expect.objectContaining({ min: 10, trigger: "blur" }),
        expect.objectContaining({ max: 1000, trigger: "blur" }),
      ]);
    }
  );

  it.each([10, 1000])(
    "accepts feedback content at the %s-character boundary",
    async (length) => {
      vi.useFakeTimers();
      const wrapper = mountView();

      await setContent(wrapper, "a".repeat(length));
      await submit(wrapper);

      expect(mocks.feedback).toHaveBeenCalledTimes(1);
      expect(wrapper.find(".el-form-item__error").exists()).toBe(false);
      await vi.advanceTimersByTimeAsync(1500);
    }
  );

  it("resets the content and validation state", async () => {
    const wrapper = mountView();
    await setContent(wrapper, "too short");
    await submit(wrapper);

    await wrapper.get(".feedback-reset").trigger("click");

    expect((wrapper.get("textarea").element as HTMLTextAreaElement).value).toBe(
      ""
    );
    expect(wrapper.find(".el-form-item__error").exists()).toBe(false);
  });

  it("submits the exact FormData payload, resets on success, and navigates back after 1500ms", async () => {
    vi.useFakeTimers();
    const wrapper = mountView();
    await setContent(wrapper, "Useful feedback");

    await submit(wrapper);

    const formData = mocks.feedback.mock.calls[0][0] as FormData;
    expect(Array.from(formData.entries())).toEqual([
      ["feedback_type", "user_feedback"],
      ["feedback_content", "Useful feedback"],
    ]);
    expect(mocks.success).toHaveBeenCalledWith(
      "Feedback submitted successfully. Thank you for your valuable input!"
    );
    expect((wrapper.get("textarea").element as HTMLTextAreaElement).value).toBe(
      ""
    );
    expect(mocks.go).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1499);
    expect(mocks.go).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(mocks.go).toHaveBeenCalledWith(-1);
  });

  it("keeps content and reports the response message when submission fails", async () => {
    mocks.feedback.mockResolvedValueOnce({
      code: 500,
      message: "Service unavailable",
    });
    const wrapper = mountView();
    await setContent(wrapper, "Useful feedback");

    await submit(wrapper);

    expect(mocks.error).toHaveBeenCalledWith("Service unavailable");
    expect((wrapper.get("textarea").element as HTMLTextAreaElement).value).toBe(
      "Useful feedback"
    );
    expect(mocks.go).not.toHaveBeenCalled();
    expect(wrapper.get(".feedback-submit").attributes("aria-busy")).toBe(
      "false"
    );
  });

  it("prevents duplicate submissions while the submit control is loading", async () => {
    let resolveFeedback: (response: { code: number }) => void;
    mocks.feedback.mockImplementationOnce(
      () => new Promise((resolve) => (resolveFeedback = resolve))
    );
    const wrapper = mountView();
    await setContent(wrapper, "Useful feedback");

    await wrapper.get(".feedback-submit").trigger("click");
    await wrapper.get(".feedback-submit").trigger("click");

    expect(mocks.feedback).toHaveBeenCalledTimes(1);
    expect(wrapper.get(".feedback-submit").attributes("aria-busy")).toBe(
      "true"
    );
    if (!resolveFeedback) throw new Error("feedback resolver was not created");
    resolveFeedback({ code: 200 });
    await flushPromises();
  });

  it("reports rejected submissions without logging the payload or error object", async () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    mocks.feedback.mockRejectedValueOnce(new Error("network failure"));
    const wrapper = mountView();
    await setContent(wrapper, "Useful feedback");

    await submit(wrapper);

    expect(mocks.error).toHaveBeenCalledWith(
      "Submission failed, please try again"
    );
    expect(consoleError).not.toHaveBeenCalled();
  });

  it.each([
    ["en-US", "Please enter feedback content"],
    ["zh-CN", "请输入反馈内容"],
  ] as const)(
    "renders locale-owned validation copy for %s",
    async (locale, message) => {
      const wrapper = mountView(locale);

      await submit(wrapper);

      expect(wrapper.get(".el-form-item__error").text()).toBe(message);
    }
  );

  it("does not retain hard-coded Feedback validation copy in the view", () => {
    const source = readFileSync(
      resolve(__dirname, "../../src/views/feedback/FeedbackView.vue"),
      "utf8"
    );

    expect(source).not.toContain("Please enter feedback content");
    expect(source).not.toContain("Feedback must be at least 10 characters");
    expect(source).not.toContain("Feedback cannot exceed 1000 characters");
  });
});
