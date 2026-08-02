import { describe, expect, it } from "vitest";
import { mountWithApp } from "../helpers/test-app-context";
import AttachmentPurposeSelector from "@/views/chat/components/AttachmentPurposeSelector.vue";

describe("AttachmentPurposeSelector", () => {
  it("emits only enabled finite purpose values", async () => {
    const wrapper = mountWithApp(AttachmentPurposeSelector, {
      props: {
        modelValue: "document",
        allowedPurposes: ["document"],
      },
    });

    const radioGroup = wrapper.findComponent({ name: "ElRadioGroup" });

    await radioGroup.vm.$emit("change", "dataset");
    expect(wrapper.emitted("update:modelValue")).toBeUndefined();

    await radioGroup.vm.$emit("change", "document");
    expect(wrapper.emitted("update:modelValue")).toEqual([["document"]]);
  });
});
