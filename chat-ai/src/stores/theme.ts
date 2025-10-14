/*
 * 组件注释
 * @Author: AI Assistant
 * @Date: 2024-12-19
 * @Description: 主题管理
 * 既往不恋！当下不杂！！未来不迎！！！
 */
import { defineStore } from 'pinia';
import Cookies from 'js-cookie';

export type ThemeType = 'light' | 'dark' | 'system';

export const useThemeStore = defineStore('theme', {
  state: () => ({
    theme: (Cookies.get('theme') as ThemeType) || 'system',
    mediaQuery: null as MediaQueryList | null,
    mediaQueryListener: null as ((e: MediaQueryListEvent) => void) | null,
    // 添加一个内部状态来跟踪实际的系统主题
    systemTheme: (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light') as 'light' | 'dark',
  }),
  
  getters: {
    // 获取当前实际应用的主题
    currentTheme: (state): 'light' | 'dark' => {
      if (state.theme === 'system') {
        // 使用内部状态，确保响应式更新
        return state.systemTheme;
      }
      return state.theme;
    },
    
    // 获取主题标签
    themeLabel: (state): string => {
      switch (state.theme) {
        case 'light':
          return '浅色';
        case 'dark':
          return '深色';
        case 'system':
          return '跟随系统';
        default:
          return '跟随系统';
      }
    },
  },
  
  actions: {
    // 设置主题
    setTheme(theme: ThemeType) {
      this.theme = theme;
      Cookies.set('theme', theme);
      
      // 如果切换到"跟随系统"模式，重新设置系统主题监听器
      if (theme === 'system') {
        this.setupSystemThemeListener();
      }
      
      this.applyTheme();
    },
    
    // 应用主题到 DOM
    applyTheme() {
      const actualTheme = this.currentTheme;
      const root = document.documentElement;
      
      // 移除之前的主题类
      root.classList.remove('theme-light', 'theme-dark');
      
      // 添加当前主题类
      root.classList.add(`theme-${actualTheme}`);
      
      // 设置 CSS 变量
      this.setCSSVariables(actualTheme);
    },
    
    // 设置 CSS 变量
    setCSSVariables(theme: 'light' | 'dark') {
      const root = document.documentElement;
      
      if (theme === 'dark') {
        // 深色主题变量
        root.style.setProperty('--color-background', '#1a1a1a');
        root.style.setProperty('--color-background-soft', '#1a1a1a');
        root.style.setProperty('--color-background-mute', '#1a1a1a');
        root.style.setProperty('--color-border', 'rgba(84, 84, 84, 0.48)');
        root.style.setProperty('--color-border-hover', 'rgba(84, 84, 84, 0.65)');
        root.style.setProperty('--color-heading', '#ffffff');
        root.style.setProperty('--color-text', 'rgba(235, 235, 235, 0.64)');
        root.style.setProperty('--el-bg-color', '#1a1a1a');
        root.style.setProperty('--el-bg-color-page', '#1a1a1a');
        root.style.setProperty('--el-text-color-primary', '#ffffff');
        root.style.setProperty('--el-text-color-regular', 'rgba(235, 235, 235, 0.64)');
        root.style.setProperty('--el-border-color', 'rgba(84, 84, 84, 0.48)');
        root.style.setProperty('--el-border-color-light', 'rgba(84, 84, 84, 0.32)');
        root.style.setProperty('--el-fill-color-light', '#2a2a2a');
        root.style.setProperty('--el-fill-color', '#2a2a2a');
        
        // 深色主题按钮变量
        root.style.setProperty('--sidebar-btn-bg', '#2a2a2a');
        root.style.setProperty('--sidebar-btn-bg-hover', '#3a3a3a');
        root.style.setProperty('--sidebar-btn-color', '#ffffff');
        root.style.setProperty('--sidebar-btn-border', 'rgba(84, 84, 84, 0.48)');
        root.style.setProperty('--sidebar-btn-active-bg', '#409eff');
        root.style.setProperty('--sidebar-btn-active-color', '#ffffff');
        root.style.setProperty('--sidebar-btn-shadow', '0 2px 8px rgba(0, 0, 0, 0.3)');
        root.style.setProperty('--sidebar-btn-shadow-hover', '0 4px 12px rgba(0, 0, 0, 0.4)');
        
        // 深色主题页面变量
        root.style.setProperty('--page-card-bg', '#2a2a2a');
        root.style.setProperty('--page-card-border', 'rgba(84, 84, 84, 0.48)');
        root.style.setProperty('--page-card-shadow', '0 2px 8px rgba(0, 0, 0, 0.3)');
        root.style.setProperty('--page-text-secondary', 'rgba(235, 235, 235, 0.6)');
      } else {
        // 浅色主题变量
        root.style.setProperty('--color-background', '#ffffff');
        root.style.setProperty('--color-background-soft', '#f8f8f8');
        root.style.setProperty('--color-background-mute', '#f2f2f2');
        root.style.setProperty('--color-border', 'rgba(60, 60, 60, 0.12)');
        root.style.setProperty('--color-border-hover', 'rgba(60, 60, 60, 0.29)');
        root.style.setProperty('--color-heading', '#2c3e50');
        root.style.setProperty('--color-text', '#2c3e50');
        root.style.setProperty('--el-bg-color', '#ffffff');
        root.style.setProperty('--el-bg-color-page', '#ffffff');
        root.style.setProperty('--el-text-color-primary', '#2c3e50');
        root.style.setProperty('--el-text-color-regular', '#2c3e50');
        root.style.setProperty('--el-border-color', 'rgba(60, 60, 60, 0.12)');
        root.style.setProperty('--el-border-color-light', 'rgba(60, 60, 60, 0.08)');
        root.style.setProperty('--el-fill-color-light', '#f5f7fa');
        root.style.setProperty('--el-fill-color', '#f0f2f5');
        
        // 浅色主题按钮变量
        root.style.setProperty('--sidebar-btn-bg', '#f0f2ff');
        root.style.setProperty('--sidebar-btn-bg-hover', '#e0e7ff');
        root.style.setProperty('--sidebar-btn-color', '#4b6bfb');
        root.style.setProperty('--sidebar-btn-border', 'rgba(60, 60, 60, 0.12)');
        root.style.setProperty('--sidebar-btn-active-bg', '#409eff');
        root.style.setProperty('--sidebar-btn-active-color', '#ffffff');
        root.style.setProperty('--sidebar-btn-shadow', '0 2px 8px rgba(0, 0, 0, 0.1)');
        root.style.setProperty('--sidebar-btn-shadow-hover', '0 4px 12px rgba(0, 0, 0, 0.15)');
        
        // 浅色主题页面变量
        root.style.setProperty('--page-card-bg', '#ffffff');
        root.style.setProperty('--page-card-border', 'rgba(60, 60, 60, 0.12)');
        root.style.setProperty('--page-card-shadow', '0 2px 8px rgba(0, 0, 0, 0.1)');
        root.style.setProperty('--page-text-secondary', '#666666');
      }
    },
    
    // 初始化主题
    initTheme() {
      // 设置系统主题变化监听器
      this.setupSystemThemeListener();
      
      // 同步系统主题状态
      this.syncSystemTheme();
      
      // 应用初始主题
      this.applyTheme();
      
      // 启动定期同步定时器（作为备用方案）
      this.startSyncTimer();
    },
    
    // 设置系统主题变化监听器
    setupSystemThemeListener() {
      // 移除旧的监听器（如果存在）
      if (this.mediaQuery && this.mediaQueryListener) {
        this.mediaQuery.removeEventListener('change', this.mediaQueryListener);
      }
      
      // 创建新的媒体查询对象
      this.mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
      
      // 创建监听器函数
      this.mediaQueryListener = () => {
        if (this.theme === 'system') {
          // 更新内部系统主题状态
          this.systemTheme = this.mediaQuery?.matches ? 'dark' : 'light';
          // 应用主题
          this.applyTheme();
        }
      };
      
      // 添加监听器
      this.mediaQuery.addEventListener('change', this.mediaQueryListener);
    },
    
    // 清理监听器
    cleanup() {
      if (this.mediaQuery && this.mediaQueryListener) {
        this.mediaQuery.removeEventListener('change', this.mediaQueryListener);
      }
    },
    
    // 同步系统主题状态
    syncSystemTheme() {
      if (this.theme === 'system') {
        const newSystemTheme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
        if (this.systemTheme !== newSystemTheme) {
          this.systemTheme = newSystemTheme;
          this.applyTheme();
        }
      }
    },
    
    // 启动定期同步定时器
    startSyncTimer() {
      // 每2秒检查一次系统主题状态
      setInterval(() => {
        this.syncSystemTheme();
      }, 2000);
    },
    

    

  },
}); 