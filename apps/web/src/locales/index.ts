// i18n configuration entry point.
import { createI18n } from "vue-i18n";
import enUS from "./langs/en-US";
import zhCN from "./langs/zh-CN";
import elementEnLocale from "element-plus/es/locale/lang/en";
import elementZhLocale from "element-plus/es/locale/lang/zh-cn";
import { useAppStore } from "@/stores";

// Supported locales
type SupportedLocales = "zh-CN" | "en-US";

// Message bundles
const messages = {
  "en-US": {
    ...enUS,
    ...elementEnLocale,
  },
  "zh-CN": {
    ...zhCN,
    ...elementZhLocale,
  },
};

// Create the vue-i18n instance
export const i18n = createI18n({
  legacy: false, // use the composition API
  locale: localStorage.getItem("language") || "en-US", // default locale
  fallbackLocale: "en-US", // fallback locale
  messages,

  // Debug-oriented warning config
  missingWarn: true,
  fallbackWarn: true,
  silentTranslationWarn: false,
});

// Switch language
export function setLanguage(lang: SupportedLocales) {
  try {
    if (i18n.mode === "legacy") {
      (i18n.global.locale as any) = lang;
    } else {
      (i18n.global.locale as any).value = lang;
    }

    // Update the language in the store
    const appStore = useAppStore();
    appStore.setLanguage(lang);

    // Set the Element Plus locale
    const htmlEl = document.documentElement;
    htmlEl.setAttribute("lang", lang);

    // Debug logging
    console.log("Language changed:", {
      lang,
      localStorage: localStorage.getItem("language"),
      i18nLocale: i18n.global.locale,
      availableMessages: Object.keys(i18n.global.messages),
    });

    return lang;
  } catch (error) {
    console.error("Failed to change language:", error);
    return lang;
  }
}

// Get current locale
export function getLanguage(): SupportedLocales {
  return (i18n.global.locale as any).value as SupportedLocales;
}

export default i18n;
