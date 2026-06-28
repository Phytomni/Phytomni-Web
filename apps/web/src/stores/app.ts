// Application-wide state (current UI language).
import { defineStore } from "pinia";
import Cookies from "js-cookie";

export const useAppStore = defineStore("app", {
  state: () => ({
    language: Cookies.get("language") || "en-US",
  }),
  actions: {
    setLanguage(lang: string) {
      this.language = lang;
      Cookies.set("language", lang);
    },
  },
});
