import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import ConfirmWidget from "@/views/chat/components/blocks/a2ui/ConfirmWidget.vue";
import FormWidget from "@/views/chat/components/blocks/a2ui/FormWidget.vue";
import ChoiceWidget from "@/views/chat/components/blocks/a2ui/ChoiceWidget.vue";
import type { A2uiOpenSurface } from "@/views/chat/streaming/a2uiContract";

describe("ConfirmWidget", () => {
  const surface: Extract<A2uiOpenSurface, { widget: "confirm" }> = {
    catalog_version: "v1.0",
    surface_id: "confirm-surface",
    widget: "confirm",
    props: {
      title: "Go?",
      confirm_label: "Yes",
      cancel_label: "No",
    },
  };

  it("emits typed accepted true and false intents", async () => {
    const w = mount(ConfirmWidget, {
      props: { surface: surface.props, disabled: false },
    });
    const buttons = w.findAll("button");
    await buttons[buttons.length - 1].trigger("click");
    await buttons[0].trigger("click");
    expect(w.emitted("action")).toEqual([
      [{ widget: "confirm", payload: { accepted: true } }],
      [{ widget: "confirm", payload: { accepted: false } }],
    ]);
  });

  it("does not emit when disabled", async () => {
    const w = mount(ConfirmWidget, {
      props: { surface: surface.props, disabled: true },
    });
    const buttons = w.findAll("button");
    await buttons[0].trigger("click");
    await buttons[buttons.length - 1].trigger("click");
    expect(w.emitted("action")).toBeUndefined();
  });
});

describe("FormWidget", () => {
  const surface: Extract<A2uiOpenSurface, { widget: "form" }> = {
    catalog_version: "v1.0",
    surface_id: "form-surface",
    widget: "form",
    props: {
      title: "Gene",
      fields: [
        { name: "gene", label: "Gene ID", type: "text", required: true },
      ],
    },
  };

  it("emits a typed form intent on submit", async () => {
    const w = mount(FormWidget, {
      props: {
        surface: surface.props,
        disabled: false,
      },
    });
    const input = w.find("input");
    await input.setValue("Os01g0177400");
    await w.find("form").trigger("submit.prevent");
    expect(w.emitted("action")).toEqual([
      [{ widget: "form", payload: { fields: { gene: "Os01g0177400" } } }],
    ]);
  });

  it("renders a cancel button and emits cancellation without required fields", async () => {
    const w = mount(FormWidget, {
      props: { surface: surface.props, disabled: false },
    });

    await w.find("form").trigger("submit.prevent");
    expect(w.emitted("action")).toBeUndefined();

    const cancel = w.find('[data-test="a2ui-form-cancel"]');
    expect(cancel.exists()).toBe(true);
    await cancel.trigger("click");
    expect(w.emitted("action")).toEqual([
      [{ widget: "form", payload: { cancelled: true } }],
    ]);
  });

  it("does not emit submit or cancel when disabled", async () => {
    const w = mount(FormWidget, {
      props: { surface: surface.props, disabled: true },
    });

    await w.find("form").trigger("submit.prevent");
    await w.find('[data-test="a2ui-form-cancel"]').trigger("click");
    expect(w.emitted("action")).toBeUndefined();
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
