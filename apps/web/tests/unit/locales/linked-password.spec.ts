import { describe, it, expect } from "vitest";
import { createI18n } from "vue-i18n";
import enUS from "@/locales/langs/en-US";

describe("linked password messages", () => {
  it("resolves register validation links to changePassword literals", () => {
    const i18n = createI18n({
      legacy: false,
      locale: "en-US",
      messages: { "en-US": enUS },
    });
    const t = i18n.global.t;
    expect(t("register.validation.passwordMinLength8")).toBe(
      "Password must be at least 8 characters",
    );
    expect(t("user.validation.passwordNeedUppercase")).toBe(
      "Password must contain uppercase letters",
    );
    expect(t("profile.security.confirmPassword")).toBe("Confirm Password");
  });
});
