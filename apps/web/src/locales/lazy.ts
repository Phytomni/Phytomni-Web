// Lazy loader for non-eager locale packs. en-US is bundled eagerly (it is the
// fallback locale and must always be present), so only zh-CN is deferred behind
// a dynamic import. The idempotency guard reads i18n's own availableLocales, so
// no module-level mutable state is needed.
import type { I18n } from "vue-i18n";

export type SupportedLocales = "zh-CN" | "en-US";

type LocaleLoader = () => Promise<Record<string, unknown>>;

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
export async function loadLocaleMessages(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  i18n: I18n<any, any, any, any, false>,
  lang: SupportedLocales,
  loaders: Partial<Record<SupportedLocales, LocaleLoader>> = lazyLoaders
): Promise<void> {
  if (i18n.global.availableLocales.includes(lang)) return;
  const loader = loaders[lang];
  if (!loader) return;
  const messages = await loader();
  i18n.global.setLocaleMessage(lang, messages);
}
