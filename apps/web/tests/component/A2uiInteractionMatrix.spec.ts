import { beforeEach, describe, expect, it } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { defineComponent, h, reactive } from "vue";
import StreamMessage from "@/views/chat/components/StreamMessage.vue";
import { useA2uiInteraction } from "@/views/chat/composables/useA2uiInteraction";
import { A2uiTransportError } from "@/views/chat/streaming/a2uiAction";
import type { A2uiSurfaceActionEvent } from "@/views/chat/composables/useA2uiInteraction";
import type { ChatMessage } from "@/views/chat/types";
import { buildA2uiScenario, type A2uiScenario } from "../helpers/a2uiScenario";

function mountScenario(scenario: A2uiScenario) {
  const message = reactive(scenario.message) as ChatMessage;
  const Harness = defineComponent({
    setup() {
      const { submitAction, retryAction } = useA2uiInteraction({
        buildActionId: () => `${message.id}-action`,
      });
      return () =>
        h(StreamMessage, {
          blocks: message.blocks ?? [],
          messageId: message.id,
          streaming: true,
          onA2uiAction: (event: A2uiSurfaceActionEvent) =>
            submitAction(message, event),
          onA2uiRetry: (surfaceId: string) => retryAction(message, surfaceId),
        });
    },
  });
  const wrapper = mount(Harness, {
    global: {
      stubs: { ChatActivity: true, CitationReferenceList: true },
    },
  });
  return { wrapper, message };
}

async function finish(scenario: A2uiScenario, answer = "Synthetic answer") {
  scenario.resolveSuccess({ answer });
  await flushPromises();
}

function latestEnvelope(scenario: A2uiScenario) {
  const envelope = scenario.calls.at(-1);
  if (!envelope) throw new Error("Expected an A2UI transport envelope");
  return envelope;
}

describe("A2UI interaction matrix", () => {
  beforeEach(() => setActivePinia(createPinia()));

  it.each([
    ["confirm accept", "confirm", true],
    ["confirm reject", "confirm", false],
  ] as const)(
    "routes %s to one terminal action",
    async (_name, widget, accepted) => {
      const scenario = buildA2uiScenario(widget);
      const { wrapper, message } = mountScenario(scenario);
      const buttons = wrapper.findAll(".a2ui-confirm button");
      await buttons[accepted ? 1 : 0].trigger("click");
      expect(scenario.calls).toHaveLength(1);
      expect(latestEnvelope(scenario)).toMatchObject({
        surface_id: "sfc-contract-1",
        widget: "confirm",
        payload: { accepted },
      });
      await finish(scenario);
      expect(scenario.calls).toHaveLength(1);
      expect(message.blocks?.[0].a2ui?.state).toMatchObject({
        status: "resolved",
        resolution: accepted ? "submitted" : "rejected",
      });
      expect(message.blocks?.some((block) => block.sourceActionId)).toBe(true);
      expect(wrapper.find(".md-block").text()).toContain("Synthetic answer");
      expect(wrapper.text()).not.toContain("A2UI action request failed");
      wrapper.unmount();
    }
  );

  it.each([
    ["form submit", { fields: { gene_id: "AT1G01010" } }],
    ["form cancel", { cancelled: true }],
  ] as const)("routes %s with bounded payload", async (_name, payload) => {
    const scenario = buildA2uiScenario("form");
    const { wrapper, message } = mountScenario(scenario);
    if ("fields" in payload) {
      await wrapper.find("input").setValue("AT1G01010");
      await wrapper.find("form").trigger("submit.prevent");
    } else {
      await wrapper.find('[data-test="a2ui-form-cancel"]').trigger("click");
    }
    expect(scenario.calls).toHaveLength(1);
    expect(latestEnvelope(scenario).payload).toEqual(payload);
    await finish(scenario);
    expect(message.blocks?.[0].a2ui?.state.status).toBe("resolved");
    expect(wrapper.find(".md-block").text()).toContain("Synthetic answer");
    wrapper.unmount();
  });

  it.each([
    ["choice single", false, "a"],
    ["choice multiple", true, ["a", "b"]],
  ] as const)(
    "routes %s with typed selection",
    async (_name, multiple, selected) => {
      const scenario = buildA2uiScenario("choice", { multiple });
      const { wrapper, message } = mountScenario(scenario);
      const group = wrapper.findComponent({
        name: multiple ? "ElCheckboxGroup" : "ElRadioGroup",
      });
      await group.vm.$emit("update:modelValue", selected);
      await wrapper.find('[data-test="a2ui-choice-submit"]').trigger("click");
      expect(scenario.calls).toHaveLength(1);
      expect(latestEnvelope(scenario).payload).toEqual({ selected });
      await finish(scenario);
      expect(message.blocks?.[0].a2ui?.state.status).toBe("resolved");
      expect(wrapper.find(".md-block").text()).toContain("Synthetic answer");
      wrapper.unmount();
    }
  );

  it("routes choice cancellation without requiring a selection", async () => {
    const scenario = buildA2uiScenario("choice");
    const { wrapper, message } = mountScenario(scenario);
    await wrapper.find('[data-test="a2ui-choice-cancel"]').trigger("click");
    expect(scenario.calls).toHaveLength(1);
    expect(latestEnvelope(scenario).payload).toEqual({ cancelled: true });
    await finish(scenario);
    expect(message.blocks?.[0].a2ui?.state).toMatchObject({
      status: "resolved",
      resolution: "cancelled",
    });
    expect(wrapper.find(".md-block").text()).toContain("Synthetic answer");
    wrapper.unmount();
  });

  it("advances review round one exactly once and opens round two", async () => {
    const scenario = buildA2uiScenario("confirm", {
      dialogueId: "review-dialogue",
      messageId: "review-message",
      runId: "run-contract-1",
    });
    const { wrapper, message } = mountScenario(scenario);
    await wrapper.findAll(".a2ui-confirm button")[1].trigger("click");
    expect(scenario.calls).toHaveLength(1);
    scenario.resolveInputRequired();
    await flushPromises();
    expect(scenario.calls).toHaveLength(1);
    expect(message.blocks).toHaveLength(2);
    expect(message.blocks?.[0].a2ui?.state).toMatchObject({
      status: "resolved",
      resolution: "advanced",
    });
    expect(message.blocks?.[1].a2ui?.surface.surface_id).toBe("sfc-contract-2");
    expect(message.blocks?.[1].a2ui?.state).toMatchObject({
      status: "ready",
      round: 2,
    });
    wrapper.unmount();
  });

  it("terminates round two without opening a third round", async () => {
    const scenario = buildA2uiScenario("confirm", { runId: "run-contract-1" });
    const { wrapper, message } = mountScenario(scenario);
    await wrapper.findAll(".a2ui-confirm button")[1].trigger("click");
    scenario.resolveInputRequired();
    await flushPromises();
    const roundTwo = wrapper.findAll(".a2ui-choice")[0];
    await roundTwo
      .findComponent({ name: "ElRadioGroup" })
      .vm.$emit("update:modelValue", "a");
    await roundTwo.find('[data-test="a2ui-choice-submit"]').trigger("click");
    expect(scenario.calls).toHaveLength(2);
    expect(latestEnvelope(scenario)).toMatchObject({
      surface_id: "sfc-contract-2",
      widget: "choice",
      run_id: "run-contract-1",
    });
    await finish(scenario);
    expect(scenario.calls).toHaveLength(2);
    expect(message.blocks).toHaveLength(3);
    expect(message.blocks?.filter((block) => block.a2ui).length).toBe(2);
    expect(message.blocks?.[1].a2ui?.state.status).toBe("resolved");
    wrapper.unmount();
  });

  it.each([
    ["409", "expired", "a2ui_http_409", 409],
    ["network", "unknown", "network_error", undefined],
    ["502", "unknown", "a2ui_invalid_upstream", 502],
    ["504", "unknown", "a2ui_timeout", 504],
  ] as const)(
    "closes %s without retry",
    async (_name, expected, code, status) => {
      const scenario = buildA2uiScenario("confirm");
      const { wrapper, message } = mountScenario(scenario);
      await wrapper.findAll(".a2ui-confirm button")[1].trigger("click");
      scenario.rejectWith(
        new A2uiTransportError(
          expected === "expired" ? "expired" : "unknown",
          code,
          status,
          true,
          false
        )
      );
      await flushPromises();
      expect(scenario.calls).toHaveLength(1);
      expect(message.blocks?.[0].a2ui?.state.status).toBe(expected);
      expect(wrapper.find('[data-test="a2ui-retry"]').exists()).toBe(false);
      expect(wrapper.text()).not.toContain(code);
      wrapper.unmount();
    }
  );

  it("permits one manual retry only for proven pre-dispatch rejection and reuses the envelope", async () => {
    const scenario = buildA2uiScenario("confirm");
    const { wrapper, message } = mountScenario(scenario);
    await wrapper.findAll(".a2ui-confirm button")[1].trigger("click");
    const firstEnvelope = latestEnvelope(scenario);
    scenario.rejectWith(
      new A2uiTransportError(
        "temporarily_rejected",
        "gateway_disabled",
        503,
        false,
        true
      )
    );
    await flushPromises();
    expect(message.blocks?.[0].a2ui?.state.status).toBe("temporarily_rejected");
    const retry = wrapper.find('[data-test="a2ui-retry"]');
    expect(retry.exists()).toBe(true);
    await retry.trigger("click");
    expect(scenario.calls).toHaveLength(2);
    expect(latestEnvelope(scenario)).toEqual(firstEnvelope);
    await finish(scenario);
    expect(scenario.calls).toHaveLength(2);
    expect(wrapper.find('[data-test="a2ui-retry"]').exists()).toBe(false);
    wrapper.unmount();
  });

  it("does not auto-retry a transport rejection", async () => {
    const scenario = buildA2uiScenario("confirm");
    const { wrapper } = mountScenario(scenario);
    await wrapper.findAll(".a2ui-confirm button")[1].trigger("click");
    scenario.rejectWith(
      new A2uiTransportError("unknown", "network_error", undefined, true, false)
    );
    await flushPromises();
    expect(scenario.calls).toHaveLength(1);
    wrapper.unmount();
  });

  it("keeps action, answer, surface, and message identities stable", async () => {
    const scenario = buildA2uiScenario("confirm", {
      dialogueId: "stable-dialogue",
      messageId: "stable-message",
      runId: "stable-run",
      surfaceId: "stable-surface",
    });
    const { wrapper, message } = mountScenario(scenario);
    await wrapper.findAll(".a2ui-confirm button")[1].trigger("click");
    const envelope = latestEnvelope(scenario);
    await finish(scenario, "Stable formatted answer");
    const answer = message.blocks?.find(
      (block) => block.sourceActionId === envelope.action_id
    );
    expect(answer?.type).toBe("markdown");
    expect(answer?.sourceActionId).toBe(envelope.action_id);
    expect(message.id).toBe("stable-message");
    expect(message.a2uiRuntime?.dialogueId).toBe("stable-dialogue");
    expect(message.a2uiRuntime?.messageId).toBe("stable-message");
    expect(message.a2uiRuntime?.runId).toBe("stable-run");
    expect(wrapper.find(".md-block").text()).toContain(
      "Stable formatted answer"
    );
    wrapper.unmount();
  });
});
