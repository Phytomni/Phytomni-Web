import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import ConfirmWidget from "@/views/chat/components/blocks/a2ui/ConfirmWidget.vue";
import FormWidget from "@/views/chat/components/blocks/a2ui/FormWidget.vue";
import ChoiceWidget from "@/views/chat/components/blocks/a2ui/ChoiceWidget.vue";

describe("ConfirmWidget", () => {
  it("emits accepted true on confirm", async () => {
    const w = mount(ConfirmWidget, {
      props: { props: { title: "Go?" }, disabled: false },
    });
    const buttons = w.findAll("button");
    await buttons[buttons.length - 1].trigger("click");
    expect(w.emitted("submit")?.[0]?.[0]).toEqual({
      payload: { accepted: true },
    });
  });
});

describe("FormWidget", () => {
  it("emits field values on submit", async () => {
    const w = mount(FormWidget, {
      props: {
        props: {
          title: "Gene",
          fields: [{ name: "gene", label: "Gene ID", type: "text", required: true }],
        },
        disabled: false,
      },
    });
    const input = w.find("input");
    await input.setValue("Os01g0177400");
    await w.find("form").trigger("submit.prevent");
    expect(w.emitted("submit")?.[0]?.[0]).toEqual({
      payload: { fields: { gene: "Os01g0177400" } },
    });
  });
});

describe("ChoiceWidget", () => {
  it("emits selected id for single choice", async () => {
    const w = mount(ChoiceWidget, {
      props: {
        props: {
          title: "Pick",
          multiple: false,
          options: [
            { id: "a", label: "Alpha" },
            { id: "b", label: "Beta" },
          ],
        },
        disabled: false,
      },
    });
    const radioGroup = w.findComponent({ name: "ElRadioGroup" });
    await radioGroup.vm.$emit("update:modelValue", "a");
    const submit = w.find("[data-test=a2ui-choice-submit]");
    await submit.trigger("click");
    const emitted = w.emitted("submit")?.[0]?.[0] as {
      payload: { selected: string };
    };
    expect(emitted.payload.selected).toBe("a");
  });
});
