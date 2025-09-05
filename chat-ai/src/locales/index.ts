/*
 * 组件注释
 * @Author: AI Assistant
 * @Date: 2024-06-17
 * @Description: 国际化配置入口文件
 * 既往不恋！当下不杂！！未来不迎！！！
 */
import { createI18n } from 'vue-i18n';
import enUS from './langs/en-US';
import zhCN from './langs/zh-CN';
import elementEnLocale from 'element-plus/es/locale/lang/en';
import elementZhLocale from 'element-plus/es/locale/lang/zh-cn';
import { useAppStore } from '@/stores';

// 定义支持的语言类型
type SupportedLocales = 'zh-CN' | 'en-US';

// 语言包
const messages = {
  'en-US': {
    ...enUS,
    ...elementEnLocale,
  },
  'zh-CN': {
    ...zhCN,
    ...elementZhLocale,
  },
};

// 创建 i18n 实例vue-i18n
export const i18n = createI18n({
  legacy: false, // 使用组合式API
  locale: localStorage.getItem('language') || 'en-US', // 默认语言
  fallbackLocale: 'en-US', // 回退语言
  messages,
  // silentTranslationWarn: true, // 禁用翻译警告
  // missingWarn: false, // 禁用缺失警告
  // silentFallbackWarn: true, // 禁用回退警告

  // 添加以下配置用于调试
  missingWarn: true,
  fallbackWarn: true,
  silentTranslationWarn: false,
});

// 切换语言方法
export function setLanguage(lang: SupportedLocales) {
  try {
    if (i18n.mode === 'legacy') {
      (i18n.global.locale as any) = lang;
    } else {
      (i18n.global.locale as any).value = lang;
    }

    // 更新store中的语言设置
    const appStore = useAppStore();
    appStore.setLanguage(lang);

    // 设置Element Plus的语言
    const htmlEl = document.documentElement;
    htmlEl.setAttribute('lang', lang);

    // 添加调试信息
    console.log('Language changed:', {
      lang,
      localStorage: localStorage.getItem('language'),
      i18nLocale: i18n.global.locale,
      availableMessages: Object.keys(i18n.global.messages),
    });

    return lang;
  } catch (error) {
    console.error('Failed to change language:', error);
    return lang;
  }
}

// 获取当前语言
export function getLanguage(): SupportedLocales {
  return (i18n.global.locale as any).value as SupportedLocales;
}

export default i18n;
