import { ref } from "vue";
import { userStore } from "@/stores";

export function useTutorial() {
  // 教学引导功能状态管理
  const showTutorial = ref(false);
  const currentTutorialStep = ref(1);

  // 开始教学引导
  const startTutorial = () => {
    showTutorial.value = true;
    currentTutorialStep.value = 1;
  };

  // 下一步教学
  const nextTutorialStep = () => {
    if (currentTutorialStep.value < 3) {
      currentTutorialStep.value++;
    }
  };

  // 上一步教学
  const prevTutorialStep = () => {
    if (currentTutorialStep.value > 1) {
      currentTutorialStep.value--;
    }
  };

  // 完成教学
  const completeTutorial = () => {
    showTutorial.value = false;
    currentTutorialStep.value = 1;
    // 教学完成,标记用户已看过引导
    userStore().SET_SEEN_TUTORIAL("1");
  };

  // 处理教学遮罩层点击
  const handleTutorialOverlayClick = (event: Event) => {
    // 阻止事件冒泡，避免意外关闭教学
    event.stopPropagation();
  };

  // 处理键盘导航
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

  // 检查是否需要显示教学引导
  const checkTutorialStatus = () => {
    // Tutorial hand-off (TW-D15): change-password.vue 在 FedLogOut 之后写
    // sessionStorage.tutorial_pending='1';此处一次性消费 + 同步 Pinia,
    // 让「改密成功 → 首次进 chat = 看教学」自然触发路径成立。
    try {
      if (sessionStorage.getItem("tutorial_pending") === "1") {
        sessionStorage.removeItem("tutorial_pending");
        userStore().SET_SEEN_TUTORIAL("0");
      }
    } catch (err) {
      // sessionStorage 不可用(incognito 严格 / 容量满):静默放弃教学
      console.warn("sessionStorage unavailable for tutorial hand-off", err);
    }

    // 从用户 store 获取教学态,'0' 表示未看过引导
    const tutorialUnseen = userStore().seen_tutorial === "0";
    if (tutorialUnseen) {
      // 未看过教学引导时显示，确保页面完全加载
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
