/*
 * 组件注释
 * @Author: AI Assistant
 * @Date: 2024-06-17
 * @Description: 应用全局状态管理
 * 既往不恋！当下不杂！！未来不迎！！！
 */
import { defineStore } from 'pinia';
import Cookies from 'js-cookie';

export const useAppStore = defineStore('app', {
  state: () => ({
    language: Cookies.get('language') || 'en-US',
  }),
  actions: {
    setLanguage(lang: string) {
      this.language = lang;
      Cookies.set('language', lang);
    },
  },
});
