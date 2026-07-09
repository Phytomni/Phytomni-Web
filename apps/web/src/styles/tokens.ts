/** Quiet Lab brand tokens — keep in sync with tokens.css */
export const PHY_TOKENS = {
  primary: "#3A83F7",
  primaryHover: "#6BA4F9",
  primarySoft: "#D6E6FE",
  accent: "#14644A",
  accentHover: "#3D8F72",
  accentSoft: "#D7EDE5",
  bgPage: "#F7F9FC",
  bgElevated: "#FFFFFF",
  bgSidebar: "#F5F7FA",
  text: "#14201B",
  textSecondary: "#5B6B63",
  textMuted: "#8B9790",
  border: "#E6EBE7",
  /** Chat bubble soft-wash mix amount (Style B glass). */
  bubbleTintOpacity: 0.2,
} as const;

/** Legacy competing brand colors — must not reappear as hardcodes in apps/web */
export const BANNED_BRAND_HEX = [
  "#409eff",
  "#66b1ff",
  "#1890ff",
  "#626aef",
  "#4b6bfb",
  "#4f46e5",
  "#7c3aed",
  "#7171c6",
  "#3aa3ed", // Help companion purple-blue gradient stop
] as const;
