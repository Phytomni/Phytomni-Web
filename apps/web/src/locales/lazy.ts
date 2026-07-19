// Lazy loader for non-eager locale packs. en-US is bundled eagerly (it is the
// fallback locale and must always be present), so only zh-CN is deferred behind
// a dynamic import. The idempotency guard reads i18n's own availableLocales, so
// no module-level mutable state is needed.
import type { I18n, LocaleMessageValue, VueMessageType } from "vue-i18n";

export type SupportedLocales = "zh-CN" | "en-US";

type LocalePack = Record<string, LocaleMessageValue<VueMessageType>>;
type LocaleLoader = () => Promise<LocalePack>;

// Loaders for packs that are NOT eagerly bundled. en-US is intentionally absent.
const lazyLoaders: Partial<Record<SupportedLocales, LocaleLoader>> = {
  "zh-CN": async () => {
    const [{ default: zhCN }, { default: elementZhLocale }] = await Promise.all(
      [import("./langs/zh-CN"), import("element-plus/es/locale/lang/zh-cn")]
    );
    return { ...zhCN, ...elementZhLocale };
  },
};

// Load `lang`'s messages into `i18n` if not already present. Idempotent: once a
// locale is in availableLocales, subsequent calls are a no-op.
export async function loadLocaleMessages<
  Messages extends Record<string, unknown>,
  DateTimeFormats extends Record<string, unknown>,
  NumberFormats extends Record<string, unknown>,
  OptionLocale extends string
>(
  i18n: I18n<Messages, DateTimeFormats, NumberFormats, OptionLocale, false>,
  lang: SupportedLocales,
  loaders: Partial<Record<SupportedLocales, LocaleLoader>> = lazyLoaders
): Promise<void> {
  if (i18n.global.availableLocales.some((locale) => String(locale) === lang)) {
    return;
  }
  const loader = loaders[lang];
  if (!loader) return;
  const messages = await loader();
  i18n.global.setLocaleMessage<LocalePack, string>(lang, messages);
}
