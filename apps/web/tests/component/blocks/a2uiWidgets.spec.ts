import { describe, it, expect } from "vitest";
import ConfirmWidget from "@/views/chat/components/blocks/a2ui/ConfirmWidget.vue";
import FormWidget from "@/views/chat/components/blocks/a2ui/FormWidget.vue";
import ChoiceWidget from "@/views/chat/components/blocks/a2ui/ChoiceWidget.vue";
import type { A2uiOpenSurface } from "@/views/chat/streaming/a2uiContract";
import { mountWithApp } from "../../helpers/test-app-context";

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
    const w = mountWithApp(ConfirmWidget, {
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
    const w = mountWithApp(ConfirmWidget, {
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
    const w = mountWithApp(FormWidget, {
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
    const w = mountWithApp(FormWidget, {
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
    const w = mountWithApp(FormWidget, {
      props: { surface: surface.props, disabled: true },
    });

    await w.find("form").trigger("submit.prevent");
    await w.find('[data-test="a2ui-form-cancel"]').trigger("click");
    expect(w.emitted("action")).toBeUndefined();
  });
});

describe("ChoiceWidget", () => {
  const surface: Extract<A2uiOpenSurface, { widget: "choice" }> = {
    catalog_version: "v1.0",
    surface_id: "choice-surface",
    widget: "choice",
    props: {
      title: "Pick",
      multiple: false,
      options: [
        { id: "a", label: "Alpha" },
        { id: "b", label: "Beta" },
      ],
    },
  };

  it("emits selected id for single choice", async () => {
    const w = mountWithApp(ChoiceWidget, {
      props: {
        surface: surface.props,
        disabled: false,
      },
    });
    const radioGroup = w.findComponent({ name: "ElRadioGroup" });
    await radioGroup.vm.$emit("update:modelValue", "a");
    const submit = w.find("[data-test=a2ui-choice-submit]");
    await submit.trigger("click");
    expect(w.emitted("action")).toEqual([
      [{ widget: "choice", payload: { selected: "a" } }],
    ]);
  });

  it("emits a copied string array for multiple choice", async () => {
    const multipleSurface: Extract<A2uiOpenSurface, { widget: "choice" }> = {
      ...surface,
      props: { ...surface.props, multiple: true },
    };
    const w = mountWithApp(ChoiceWidget, {
      props: { surface: multipleSurface.props, disabled: false },
    });
    const selected = ["a", "b"];
    const checkboxGroup = w.findComponent({ name: "ElCheckboxGroup" });
    await checkboxGroup.vm.$emit("update:modelValue", selected);
    await w.find("[data-test=a2ui-choice-submit]").trigger("click");

    const emitted = w.emitted("action")?.[0]?.[0] as {
      payload: { selected: string[] };
    };
    expect(emitted.payload.selected).toEqual(["a", "b"]);
    expect(emitted.payload.selected).not.toBe(selected);
  });

  it("emits cancellation without requiring a selection", async () => {
    const w = mountWithApp(ChoiceWidget, {
      props: { surface: surface.props, disabled: false },
    });
    await w.find('[data-test="a2ui-choice-cancel"]').trigger("click");
    expect(w.emitted("action")).toEqual([
      [{ widget: "choice", payload: { cancelled: true } }],
    ]);
  });

  it("does not submit or cancel when disabled", async () => {
    const w = mountWithApp(ChoiceWidget, {
      props: { surface: surface.props, disabled: true },
    });
    const radioGroup = w.findComponent({ name: "ElRadioGroup" });
    await radioGroup.vm.$emit("update:modelValue", "a");
    await w.find("[data-test=a2ui-choice-submit]").trigger("click");
    await w.find('[data-test="a2ui-choice-cancel"]').trigger("click");
    expect(w.emitted("action")).toBeUndefined();
  });

  it("disables submit for zero selection but leaves cancel enabled", () => {
    const w = mountWithApp(ChoiceWidget, {
      props: { surface: surface.props, disabled: false },
    });
    const submit = w.find("[data-test=a2ui-choice-submit]");
    const cancel = w.find('[data-test="a2ui-choice-cancel"]');
    expect(submit.attributes("disabled")).toBeDefined();
    expect(cancel.attributes("disabled")).toBeUndefined();
  });

  it("passes option ids as control values instead of labels", () => {
    const single = mountWithApp(ChoiceWidget, {
      props: { surface: surface.props, disabled: false },
    });
    const radios = single.findAllComponents({ name: "ElRadio" });
    expect(radios.map((radio) => radio.props("value"))).toEqual(["a", "b"]);
    expect(radios.every((radio) => radio.props("label") === undefined)).toBe(
      true
    );

    const multipleSurface: Extract<A2uiOpenSurface, { widget: "choice" }> = {
      ...surface,
      props: { ...surface.props, multiple: true },
    };
    const multiple = mountWithApp(ChoiceWidget, {
      props: { surface: multipleSurface.props, disabled: false },
    });
    const checkboxes = multiple.findAllComponents({ name: "ElCheckbox" });
    expect(checkboxes.map((checkbox) => checkbox.props("value"))).toEqual([
      "a",
      "b",
    ]);
    expect(
      checkboxes.every((checkbox) => checkbox.props("label") === undefined)
    ).toBe(true);
  });
});
