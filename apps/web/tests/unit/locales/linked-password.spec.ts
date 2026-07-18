import { describe, it, expect } from "vitest";
import { createI18n } from "vue-i18n";
import enUS from "@/locales/langs/en-US";
import zhCN from "@/locales/langs/zh-CN";

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
    expect(t("profile.security.confirmPasswordPlaceholder")).toBe(
      "Please confirm new password",
    );
  });

  it("keeps profile confirmPassword as an independent literal in zh-CN", () => {
    const i18n = createI18n({
      legacy: false,
      locale: "zh-CN",
      messages: { "zh-CN": zhCN },
    });
    const t = i18n.global.t;
    expect(t("profile.security.confirmPassword")).toBe("确认密码");
    expect(t("changePassword.confirmPassword")).toBe("确认新密码");
  });
});
