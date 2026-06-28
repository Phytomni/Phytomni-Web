// Store root: re-exports all Pinia stores.
import userStore from "@/stores/user";
import { useAppStore } from "@/stores/app";
import { useThemeStore } from "@/stores/theme";

export { userStore, useAppStore, useThemeStore };
export type { ThemeType } from "@/stores/theme";
