/*
 * 组件注释
 * @Author: wuq-l
 * @Date: 2022-08-18 21:07:26
 * @LastEditors: error: git config user.name & please set dead value or install git
 * @LastEditTime: 2025-05-15 11:37:53
 * @Description: main 文件入口
 * 人生无常！大肠包小肠......
 */
import { createApp } from 'vue';
import { createPinia } from 'pinia';
import ElementPlus from 'element-plus';
import enElementLocale from 'element-plus/es/locale/lang/en';
import zhElementLocale from 'element-plus/es/locale/lang/zh-cn';
import i18n, { setLanguage } from './locales'; // 导入国际化配置
import { useAppStore, useThemeStore } from '@/stores';

import App from './App.vue';
import router from './router';
import directive from './directive';
// 注册指令
// @ts-ignore
import plugins from './plugins'; // plugins
// @ts-ignore
import { download } from '@/utils/request';
import 'element-plus/dist/index.css';
import './assets/main.css'; // 全局样式
import './assets/theme.css'; // 主题样式
import './permission'; // permission control

const app = createApp(App);

// 初始化
const pinia = createPinia();
app.use(pinia);

// 初始化 store
const appStore = useAppStore();
const themeStore = useThemeStore();

// 确保在使用 i18n 之前已经正确加载了语言包
const currentLang =
  appStore.language || localStorage.getItem('language') || 'en-US';

// 初始化 i18n
app.use(i18n);

// 设置语言
setLanguage(currentLang);

// 初始化主题
themeStore.initTheme();

// 添加调试信息
console.log('Theme initialized:', {
  theme: themeStore.theme,
  currentTheme: themeStore.currentTheme,
  systemTheme: (themeStore as any).systemTheme
});

// 全局方法挂载
app.config.globalProperties.download = download;

app.use(router);
app.use(plugins);
app.use(directive);

// 使用element-plus 并且设置全局的大小
app.use(ElementPlus, {
  locale: currentLang === 'zh-CN' ? zhElementLocale : enElementLocale,
  // 支持 large、default、small
  size: 'default',
});

app.mount('#app');

// 页面卸载时清理主题监听器
window.addEventListener('beforeunload', () => {
  themeStore.cleanup();
});
