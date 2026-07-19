import { describe, expect, it, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { nextTick } from "vue";
import { createI18n } from "vue-i18n";
import ElementPlus from "element-plus";
import AgentSurfaceBlock from "@/views/chat/components/blocks/AgentSurfaceBlock.vue";
import type { ContentBlock } from "@/views/chat/types";
import enUS from "@/locales/langs/en-US";
import type {
  A2uiOpenSurface,
  A2uiSurfaceState,
} from "@/views/chat/streaming/a2uiContract";

const lifecycleCopy = {
  submitting: "Waiting for the action to finish.",
  submitted: "This action was submitted.",
  cancelled: "This action was cancelled.",
  rejected: "This action was rejected.",
  advanced: "This action was superseded.",
  temporarilyRejected: "This action can be retried.",
  expired: "This action is no longer active.",
  unknown: "This action has an unknown result.",
  protocolError: "This action could not be displayed.",
  notSent: "This action was not sent.",
};

function createLifecycleI18n() {
  return createI18n({
    legacy: false,
    locale: "en-US",
    messages: {
      "en-US": {
        ...enUS,
        chat: {
          ...enUS.chat,
          a2ui: {
            ...enUS.chat.a2ui,
            submitting: lifecycleCopy.submitting,
            submitted: lifecycleCopy.submitted,
            cancelled: lifecycleCopy.cancelled,
            rejected: lifecycleCopy.rejected,
            advanced: lifecycleCopy.advanced,
            temporarilyRejected: lifecycleCopy.temporarilyRejected,
            expired: lifecycleCopy.expired,
            unknown: lifecycleCopy.unknown,
            protocolError: lifecycleCopy.protocolError,
            retry: "Retry action",
          },
        },
      },
    },
  });
}

const openConfirmSurface: A2uiOpenSurface = {
  catalog_version: "v1.0",
  surface_id: "lifecycle-surface",
  widget: "confirm",
  props: {
    title: "Continue?",
    confirm_label: "Confirm",
    cancel_label: "Cancel",
  },
};

const submittingEnvelope = {
  surface_id: openConfirmSurface.surface_id,
  widget: openConfirmSurface.widget,
  action_id: "action-submitting",
  run_id: "run-lifecycle",
  payload: { accepted: true },
} as const;

function lifecycleBlock(state: A2uiSurfaceState): ContentBlock {
  return {
    type: "agent-surface",
    authority: "agent",
    interactive: true,
    a2ui: {
      surface: structuredClone(openConfirmSurface),
      state,
    },
  };
}

const lifecycleCases: Array<{
  name: string;
  state: A2uiSurfaceState;
  copyKey?: keyof typeof lifecycleCopy;
  retry: boolean;
}> = [
  {
    name: "ready",
    state: { status: "ready", round: 1, lastError: "not_sent" },
    copyKey: "notSent",
    retry: false,
  },
  {
    name: "submitting",
    state: { status: "submitting", round: 1, envelope: submittingEnvelope },
    copyKey: "submitting",
    retry: false,
  },
  ...(["submitted", "cancelled", "rejected", "advanced"] as const).map(
    (resolution) => ({
      name: `resolved/${resolution}`,
      state: {
        status: "resolved" as const,
        round: 1 as const,
        actionId: `action-${resolution}`,
        resolution,
      },
      copyKey: resolution,
      retry: false,
    })
  ),
  {
    name: "rejected",
    state: {
      status: "rejected",
      round: 1,
      actionId: "action-rejected",
      code: "a2ui_invalid_action",
    },
    copyKey: "rejected",
    retry: false,
  },
  {
    name: "temporarily_rejected",
    state: {
      status: "temporarily_rejected",
      round: 1,
      envelope: {
        ...submittingEnvelope,
        action_id: "action-temporary",
      },
      code: "a2ui_gateway_disabled",
    },
    copyKey: "temporarilyRejected",
    retry: true,
  },
  {
    name: "expired",
    state: {
      status: "expired",
      round: 1,
      actionId: "action-expired",
      code: "a2ui_not_found",
    },
    copyKey: "expired",
    retry: false,
  },
  {
    name: "unknown",
    state: {
      status: "unknown",
      round: 1,
      actionId: "action-unknown",
      code: "a2ui_upstream_invalid",
    },
    copyKey: "unknown",
    retry: false,
  },
  {
    name: "protocol_error",
    state: {
      status: "protocol_error",
      round: 1,
      actionId: "action-protocol",
      code: "a2ui_protocol_error",
    },
    copyKey: "protocolError",
    retry: false,
  },
];

describe("AgentSurfaceBlock", () => {
  it.each(lifecycleCases)(
    "renders the $name lifecycle state with safe controls",
    ({ name, state, copyKey, retry }) => {
      const w = mount(AgentSurfaceBlock, {
        props: { block: lifecycleBlock(state) },
        global: { plugins: [createLifecycleI18n(), ElementPlus] },
      });

      const widgetButtons = w.findAll(".a2ui-confirm button");
      expect(widgetButtons).toHaveLength(2);
      for (const button of widgetButtons) {
        if (name === "ready") {
          expect(button.attributes("disabled")).toBeUndefined();
        } else {
          expect(button.attributes("disabled")).toBeDefined();
        }
      }

      const status = w.find(".a2ui-status");
      if (copyKey) {
        expect(status.text()).toBe(lifecycleCopy[copyKey]);
        expect(status.text()).not.toContain("a2ui_gateway_disabled");
      } else {
        expect(status.exists()).toBe(false);
      }

      const retryButton = w.find('[data-test="a2ui-retry"]');
      expect(retryButton.exists()).toBe(retry);
      if (retry) {
        expect(retryButton.attributes("disabled")).toBeUndefined();
      }
    }
  );

  it("offers a single manual retry without changing the existing action id", async () => {
    const state: A2uiSurfaceState = {
      status: "temporarily_rejected",
      round: 1,
      envelope: { ...submittingEnvelope, action_id: "action-retry-original" },
      code: "a2ui_gateway_disabled",
    };
    const block = lifecycleBlock(state);
    const w = mount(AgentSurfaceBlock, {
      props: { block },
      global: { plugins: [createLifecycleI18n(), ElementPlus] },
    });

    const retryButton = w.find('[data-test="a2ui-retry"]');
    await retryButton.trigger("click");

    expect(w.emitted("retry")).toHaveLength(1);
    expect(
      (
        block.a2ui?.state as Extract<
          A2uiSurfaceState,
          { status: "temporarily_rejected" }
        >
      ).envelope.action_id
    ).toBe("action-retry-original");
    expect(w.emitted("action")).toBeUndefined();
  });

  it("keeps a resolved surface disabled after remount", () => {
    const state: A2uiSurfaceState = {
      status: "resolved",
      round: 1,
      actionId: "action-submitted",
      resolution: "submitted",
    };
    const w = mount(AgentSurfaceBlock, {
      props: { block: lifecycleBlock(state) },
      global: { plugins: [createLifecycleI18n(), ElementPlus] },
    });

    expect(
      w
        .findAll(".a2ui-confirm button")
        .every((button) => button.attributes("disabled") !== undefined)
    ).toBe(true);
    w.unmount();

    const remounted = mount(AgentSurfaceBlock, {
      props: { block: lifecycleBlock(state) },
      global: { plugins: [createLifecycleI18n(), ElementPlus] },
    });
    expect(
      remounted
        .findAll(".a2ui-confirm button")
        .every((button) => button.attributes("disabled") !== undefined)
    ).toBe(true);
  });

  it("keeps a ready surface disabled when the block is marked non-interactive", () => {
    const block = lifecycleBlock({ status: "ready", round: 1 });
    block.interactive = false;
    const w = mount(AgentSurfaceBlock, {
      props: { block },
      global: { plugins: [createLifecycleI18n(), ElementPlus] },
    });

    expect(
      w
        .findAll(".a2ui-confirm button")
        .every((button) => button.attributes("disabled") !== undefined)
    ).toBe(true);
    expect(w.find(".a2ui-status").exists()).toBe(false);
  });

  it("marks lifecycle announcements as atomic polite live regions", () => {
    const w = mount(AgentSurfaceBlock, {
      props: {
        block: lifecycleBlock({
          status: "submitting",
          round: 1,
          envelope: submittingEnvelope,
        }),
      },
      global: { plugins: [createLifecycleI18n(), ElementPlus] },
    });

    expect(w.find('[role="status"]').attributes("aria-live")).toBe("polite");
    expect(w.find('[role="status"]').attributes("aria-atomic")).toBe("true");
  });

  it("focuses a fresh round-2 root once without scrolling", async () => {
    const focusSpy = vi.spyOn(HTMLElement.prototype, "focus");
    const block = lifecycleBlock({ status: "ready", round: 2 });
    const w = mount(AgentSurfaceBlock, {
      props: { block },
      global: { plugins: [createLifecycleI18n(), ElementPlus] },
      attachTo: document.body,
    });
    await nextTick();
    await nextTick();

    const root = w.find(".agent-surface-block");
    expect(document.activeElement).toBe(root.element);
    expect(
      focusSpy.mock.calls.filter(
        ([options]) =>
          options &&
          typeof options === "object" &&
          "preventScroll" in options &&
          options.preventScroll === true
      )
    ).toHaveLength(1);

    await w.setProps({
      block: {
        ...block,
        a2ui: {
          ...block.a2ui!,
          state: {
            status: "submitting",
            round: 2,
            envelope: submittingEnvelope,
          },
        },
      },
    });
    await nextTick();
    expect(
      focusSpy.mock.calls.filter(
        ([options]) =>
          options &&
          typeof options === "object" &&
          "preventScroll" in options &&
          options.preventScroll === true
      )
    ).toHaveLength(1);

    w.unmount();
    focusSpy.mockRestore();
  });

  it("forwards a confirm intent without creating a transport envelope", async () => {
    const block: ContentBlock = {
      type: "agent-surface",
      authority: "agent",
      interactive: true,
      a2ui: {
        surface: {
          catalog_version: "v1.0",
          surface_id: "s1",
          widget: "confirm",
          props: {
            title: "Go?",
            confirm_label: "Yes",
            cancel_label: "No",
          },
        },
        state: { status: "ready", round: 1 },
      },
    };
    const w = mount(AgentSurfaceBlock, { props: { block } });
    const buttons = w.findAll("button");
    await buttons[buttons.length - 1].trigger("click");
    expect(w.emitted("action")).toEqual([
      [{ widget: "confirm", payload: { accepted: true } }],
    ]);
    expect(w.emitted("action")?.[0]?.[0]).not.toHaveProperty("surfaceId");
    expect(w.emitted("retry")).toBeUndefined();
  });

  it("forwards typed Choice intents from the decoded surface only", async () => {
    const block: ContentBlock = {
      type: "agent-surface",
      authority: "agent",
      interactive: true,
      a2ui: {
        surface: {
          catalog_version: "v1.0",
          surface_id: "choice-surface",
          widget: "choice",
          props: {
            title: "Decoded title",
            options: [{ id: "decoded", label: "Decoded option" }],
            multiple: false,
          },
        },
        state: { status: "ready", round: 1 },
      },
    };
    const w = mount(AgentSurfaceBlock, { props: { block } });
    expect(w.find(".a2ui-title").text()).toBe("Decoded title");
    const radioGroup = w.findComponent({ name: "ElRadioGroup" });
    await radioGroup.vm.$emit("update:modelValue", "decoded");
    await w.find('[data-test="a2ui-choice-submit"]').trigger("click");
    expect(w.emitted("action")).toEqual([
      [{ widget: "choice", payload: { selected: "decoded" } }],
    ]);

    await w.find('[data-test="a2ui-choice-cancel"]').trigger("click");
    expect(w.emitted("action")).toEqual([
      [{ widget: "choice", payload: { selected: "decoded" } }],
      [{ widget: "choice", payload: { cancelled: true } }],
    ]);
  });
});
