import { describe, it, expect, vi, beforeEach } from "vitest";
import LangSwitch from "@/components/LangSwitch.vue";
import { useAppStore } from "@/stores";
import enUS from "@/locales/langs/en-US";
import { createTestAppContext } from "../helpers/test-app-context";

// Each test holds one pinia: setActivePinia uses it for direct useAppStore() reads,
// and it is also passed to the component as mount()'s global plugin — both sides
// share the same store.
let context: ReturnType<typeof createTestAppContext>;

const mountSwitch = () => context.mount(LangSwitch);

vi.mock("@/locales", async () => {
  const actual = await vi.importActual<typeof import("@/locales")>("@/locales");
  return {
    ...actual,
    setLanguage: vi.fn(),
  };
});
import { setLanguage } from "@/locales";

describe("LangSwitch.vue", () => {
  beforeEach(() => {
    context = createTestAppContext();
    vi.clearAllMocks();
  });

  it("renders the Chinese label when store language is zh-CN", () => {
    const store = useAppStore();
    store.language = "zh-CN";
    const wrapper = mountSwitch();
    expect(wrapper.text()).toContain(enUS.common.languageChinese);
  });

  it("renders the English label when store language is en-US", () => {
    const store = useAppStore();
    store.language = "en-US";
    const wrapper = mountSwitch();
    expect(wrapper.text()).toContain(enUS.common.languageEnglish);
  });

  it("delegates to setLanguage on dropdown command without mutating the store directly", async () => {
    const store = useAppStore();
    store.language = "zh-CN";
    const wrapper = mountSwitch();
    // Drive via the component's exposed handler — invoking the dropdown's
    // command event directly avoids depending on Element Plus internals.
    const dropdown = wrapper.findComponent({ name: "ElDropdown" });
    await dropdown.vm.$emit("command", "en-US");
    expect(setLanguage).toHaveBeenCalledWith("en-US");
    // Store should NOT be mutated inline — persistence belongs to setLanguage.
    expect(store.language).toBe("zh-CN");
  });

  it("disables the dropdown item that matches the current language", () => {
    const store = useAppStore();
    store.language = "zh-CN";
    const wrapper = mountSwitch();
    const items = wrapper.findAllComponents({ name: "ElDropdownItem" });
    const zh = items.find((it) => it.props("command") === "zh-CN");
    const en = items.find((it) => it.props("command") === "en-US");
    expect(zh?.props("disabled")).toBe(true);
    expect(en?.props("disabled")).toBe(false);
  });

  it("uses a semantic trigger with a compact mobile language label", () => {
    const store = useAppStore();
    store.language = "en-US";
    const wrapper = mountSwitch();
    const trigger = wrapper.get("button.lang-dropdown-link");

    expect(trigger.attributes("type")).toBe("button");
    expect(trigger.attributes("aria-label")).toBe(enUS.common.languageSelector);
    expect(wrapper.get(".lang-label-full").text()).toBe(
      enUS.common.languageEnglish
    );
    expect(wrapper.get(".lang-label-compact").text()).toBe(
      enUS.common.languageEnglishCompact
    );
  });
});
