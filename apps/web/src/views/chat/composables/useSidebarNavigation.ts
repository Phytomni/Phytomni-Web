import type { Router } from "vue-router";

export function useSidebarNavigation(opts: {
  router: Router;
  userStore: { permission_list: string[]; FedLogOut: () => Promise<unknown> };
  onStartNewChat: () => void;
  onStartTutorial: () => void;
  onSelectChat: (dialogueId: string) => void;
}) {
  const navigate = (path: string) => {
    Promise.resolve(opts.router.push(path)).catch(() => undefined);
  };

  // user management
  const handleUserManagement = () => navigate("/user-list");

  // system monitoring
  const handleSystemMonitor = () => navigate("/log-list");

  // permission management
  const handlePermissionManagement = () => navigate("/permi-manage");

  // global config
  const handleGlobalConfig = () => navigate("/global-config");

  // admin management
  const handleAdminManagement = () => navigate("/admin-management");

  // user feedback
  const handleFeedback = () => navigate("/feedback");

  // change password
  const handleChangePassword = () => navigate("/change-password");

  // logout
  const handleLogout = () => {
    Promise.resolve(opts.userStore.FedLogOut())
      .then(() => Promise.resolve(opts.router.replace("/login")))
      .catch(() => undefined);
  };

  // handle history click
  const handleHistory = () => navigate("/history");

  // handle profile click
  const handleProfile = () => navigate("/profile");

  // handle cloud-storage click
  const handleCloudStorage = () => navigate("/cloud-storage");

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
  const openKnowledgeBase = () => navigate("/gene-display");

  // handle favorites click
  const openFavorites = () => navigate("/favorites");

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
