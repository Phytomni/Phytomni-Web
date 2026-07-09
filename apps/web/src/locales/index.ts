// i18n configuration entry point.
import { createI18n } from "vue-i18n";
import enUS from "./langs/en-US";
import elementEnLocale from "element-plus/es/locale/lang/en";
import { useAppStore } from "@/stores";
import { loadLocaleMessages, type SupportedLocales } from "./lazy";
import { datetimeFormats } from "./datetime-formats";

// Message bundles — en-US is eager (fallback locale, must always be present);
// zh-CN is deferred behind a dynamic import in ./lazy.
const messages = {
  "en-US": {
    ...enUS,
    ...elementEnLocale,
  },
};

// Create the vue-i18n instance
export const i18n = createI18n({
  legacy: false, // use the composition API
  locale: localStorage.getItem("language") || "en-US", // default locale
  fallbackLocale: "en-US", // fallback locale
  messages,
  datetimeFormats,

  // Debug-oriented warning config
  missingWarn: true,
  fallbackWarn: true,
  silentTranslationWarn: false,
});

// Switch language (loads the target pack on demand before switching).
export async function setLanguage(lang: SupportedLocales): Promise<SupportedLocales> {
  try {
    await loadLocaleMessages(i18n, lang);

    if (i18n.mode === "legacy") {
      (i18n.global.locale as any) = lang;
    } else {
      (i18n.global.locale as any).value = lang;
    }

    // Update the language in the store
    const appStore = useAppStore();
    appStore.setLanguage(lang);

    // Set the document language attribute
    const htmlEl = document.documentElement;
    htmlEl.setAttribute("lang", lang);

    // Keep the browser tab title in sync with the locale pack
    // (en Phytomni / zh brand string from chat.appTitle).
    document.title = i18n.global.t("chat.appTitle") as string;

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
