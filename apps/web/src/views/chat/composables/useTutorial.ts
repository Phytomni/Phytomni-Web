import { ref, onMounted, onUnmounted } from "vue";
import { userStore } from "@/stores";

export function useTutorial() {
  // tutorial state management
  const showTutorial = ref(false);
  const currentTutorialStep = ref(1);

  // start the tutorial
  const startTutorial = () => {
    showTutorial.value = true;
    currentTutorialStep.value = 1;
  };

  // next tutorial step
  const nextTutorialStep = () => {
    if (currentTutorialStep.value < 3) {
      currentTutorialStep.value++;
    }
  };

  // previous tutorial step
  const prevTutorialStep = () => {
    if (currentTutorialStep.value > 1) {
      currentTutorialStep.value--;
    }
  };

  // complete the tutorial
  const completeTutorial = () => {
    showTutorial.value = false;
    currentTutorialStep.value = 1;
    // tutorial done; mark the user as having seen it
    userStore().SET_SEEN_TUTORIAL("1");
  };

  // handle tutorial overlay click
  const handleTutorialOverlayClick = (event: Event) => {
    // stop propagation to avoid accidentally closing the tutorial
    event.stopPropagation();
  };

  // handle keyboard navigation
  const handleTutorialKeydown = (event: KeyboardEvent) => {
    if (!showTutorial.value) return;

    switch (event.key) {
      case "ArrowRight":
      case " ":
        event.preventDefault();
        if (currentTutorialStep.value < 3) {
          nextTutorialStep();
        }
        break;
      case "ArrowLeft":
        event.preventDefault();
        if (currentTutorialStep.value > 1) {
          prevTutorialStep();
        }
        break;
      case "Escape":
        event.preventDefault();
        completeTutorial();
        break;
    }
  };

  // keyboard listener lifecycle — register on mount, remove on unmount (prevent leaks)
  onMounted(() => {
    document.addEventListener("keydown", handleTutorialKeydown);
  });
  onUnmounted(() => {
    document.removeEventListener("keydown", handleTutorialKeydown);
  });

  // check whether to show the tutorial
  const checkTutorialStatus = () => {
    // Tutorial hand-off (TW-D15): change-password.vue writes
    // sessionStorage.tutorial_pending='1' after FedLogOut; here we consume it once and
    // sync Pinia, so the path "password change succeeds → first chat visit = see tutorial"
    // triggers naturally.
    try {
      if (sessionStorage.getItem("tutorial_pending") === "1") {
        sessionStorage.removeItem("tutorial_pending");
        userStore().SET_SEEN_TUTORIAL("0");
      }
    } catch (err) {
      // sessionStorage unavailable (strict incognito / quota full): silently skip the tutorial
      console.warn("sessionStorage unavailable for tutorial hand-off", err);
    }

    // read the tutorial state from the user store; '0' means not yet seen
    const tutorialUnseen = userStore().seen_tutorial === "0";
    if (tutorialUnseen) {
      // show it when unseen, ensuring the page is fully loaded
      setTimeout(() => {
        startTutorial();
      }, 1000);
    }
  };

  return {
    showTutorial,
    currentTutorialStep,
    startTutorial,
    nextTutorialStep,
    prevTutorialStep,
    completeTutorial,
    handleTutorialOverlayClick,
    handleTutorialKeydown,
    checkTutorialStatus,
  };
}
