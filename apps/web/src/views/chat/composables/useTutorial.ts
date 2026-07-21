import { ref } from "vue";
import { userStore } from "@/stores";

type TutorialOptions = {
  beforeStart?: () => void;
};

export function useTutorial(options: TutorialOptions = {}) {
  const showTutorial = ref(false);

  const startTutorial = () => {
    options.beforeStart?.();
    showTutorial.value = true;
  };

  const completeTutorial = () => {
    showTutorial.value = false;
    userStore().SET_SEEN_TUTORIAL("1");
  };

  const checkTutorialStatus = () => {
    try {
      if (sessionStorage.getItem("tutorial_pending") === "1") {
        sessionStorage.removeItem("tutorial_pending");
        userStore().SET_SEEN_TUTORIAL("0");
      }
    } catch (err) {
      console.warn("sessionStorage unavailable for tutorial hand-off", err);
    }

    if (userStore().seen_tutorial === "0") {
      setTimeout(() => {
        startTutorial();
      }, 1000);
    }
  };

  return {
    showTutorial,
    startTutorial,
    completeTutorial,
    checkTutorialStatus,
  };
}
