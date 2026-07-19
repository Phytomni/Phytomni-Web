import type { Router } from "vue-router";

export function useSidebarNavigation(opts: {
  router: Router;
  userStore: { permission_list: string[]; FedLogOut: () => Promise<unknown> };
  onStartNewChat: () => void;
  onStartTutorial: () => void;
  onSelectChat: (dialogueId: string) => void;
}) {
  // user management
  const handleUserManagement = () => opts.router.push("/user-list");

  // system monitoring
  const handleSystemMonitor = () => opts.router.push("/log-list");

  // permission management
  const handlePermissionManagement = () => opts.router.push("/permi-manage");

  // global config
  const handleGlobalConfig = () => opts.router.push("/global-config");

  // admin management
  const handleAdminManagement = () => opts.router.push("/admin-management");

  // user feedback
  const handleFeedback = () => opts.router.push("/feedback");

  // change password
  const handleChangePassword = () => opts.router.push("/change-password");

  // logout
  const handleLogout = () => {
    opts.userStore.FedLogOut().finally(() => opts.router.replace("/login"));
  };

  // handle history click
  const handleHistory = () => {
    opts.router.push("/history");
  };

  // handle profile click
  const handleProfile = () => {
    opts.router.push("/profile");
  };

  // handle cloud-storage click
  const handleCloudStorage = () => {
    opts.router.push("/cloud-storage");
  };

  // user menu
  const handleCommand = (command: string) => {
    switch (command) {
      case "userManagement":
        if (hasPermission("User management")) handleUserManagement();
        break;
      case "systemMonitor":
        if (hasPermission("System monitor")) handleSystemMonitor();
        break;
      case "permissionManagement":
        if (hasPermission("Role permission assignment"))
          handlePermissionManagement();
        break;
      case "globalConfig":
        if (hasPermission("Global config")) handleGlobalConfig();
        break;
      case "adminManagement":
        if (hasPermission("Admin management")) handleAdminManagement();
        break;
      case "history":
        if (hasPermission("History")) handleHistory();
        break;
      case "profile":
        if (hasPermission("Profile management")) handleProfile();
        break;
      case "cloudStorage":
        if (hasPermission("Cloud storage")) handleCloudStorage();
        break;
      case "feedback":
        handleFeedback();
        break;
      case "changePassword":
        handleChangePassword();
        break;
      case "logout":
        handleLogout();
        break;
    }
  };

  // handle new-chat click
  const startNewChat = () => opts.onStartNewChat();

  // handle knowledge-base click
  const openKnowledgeBase = () => {
    opts.router.push("/gene-display");
  };

  // handle favorites click
  const openFavorites = () => {
    opts.router.push("/favorites");
  };

  // handle start-tutorial click
  const startTutorial = () => {
    opts.onStartTutorial();
  };

  // handle select-chat
  const selectChat = (dialogueId: string) => opts.onSelectChat(dialogueId);

  // permission check
  const hasPermission = (permission: string) => {
    return opts.userStore.permission_list.includes(permission);
  };

  return {
    handleCommand,
    hasPermission,
    startNewChat,
    openKnowledgeBase,
    openFavorites,
    startTutorial,
    selectChat,
  };
}
