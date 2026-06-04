/*
 * 组件注释
 * @Author: wuq-l
 * @Date: 2022-09-01 09:15:58
 * @LastEditors: wuq-l
 * @LastEditTime: 2022-09-01 14:35:19
 * @Description: store的根文件
 * 人生无常！大肠包小肠......
 */
import counter from "@/stores/counter";
import userStore from "@/stores/user";
import { useAppStore } from "@/stores/app";
import { useThemeStore } from "@/stores/theme";

export { counter, userStore, useAppStore, useThemeStore };
export type { ThemeType } from "@/stores/theme";
