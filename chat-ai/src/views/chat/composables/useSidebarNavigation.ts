import type { Router } from "vue-router";

export function useSidebarNavigation(opts: {
  router: Router;
  userStore: { permission_list: string[]; FedLogOut: () => Promise<unknown> };
  onStartNewChat: () => void;
  onStartTutorial: () => void;
  onSelectChat: (dialogueId: string) => void;
}) {
  // 用户管理
  const handleUserManagement = () => opts.router.push("/user-list");

  // 系统监控
  const handleSystemMonitor = () => opts.router.push("/log-list");

  // 权限管理
  const handlePermissionManagement = () => opts.router.push("/permi-manage");

  // 全局策略配置
  const handleGlobalConfig = () => opts.router.push("/global-config");

  // 管理员管理
  const handleAdminManagement = () => opts.router.push("/admin-management");

  // 用户反馈
  const handleFeedback = () => opts.router.push("/feedback");

  // 修改密码
  const handleChangePassword = () => opts.router.push("/change-password");

  // 登出
  const handleLogout = () => {
    opts.userStore.FedLogOut().finally(() => opts.router.replace("/login"));
  };

  // 处理历史记录点击事件
  const handleHistory = () => {
    opts.router.push("/history");
  };

  // 处理个人资料点击事件
  const handleProfile = () => {
    opts.router.push("/profile");
  };

  // 处理网盘空间点击事件
  const handleCloudStorage = () => {
    opts.router.push("/cloud-storage");
  };

  // 用户菜单相关
  const handleCommand = (command: string) => {
    switch (command) {
      case "userManagement":
        if (hasPermission("用户管理")) handleUserManagement();
        break;
      case "systemMonitor":
        if (hasPermission("系统监控")) handleSystemMonitor();
        break;
      case "permissionManagement":
        if (hasPermission("角色权限分配")) handlePermissionManagement();
        break;
      case "globalConfig":
        if (hasPermission("全局策略配置")) handleGlobalConfig();
        break;
      case "adminManagement":
        if (hasPermission("管理员管理")) handleAdminManagement();
        break;
      case "history":
        if (hasPermission("历史记录")) handleHistory();
        break;
      case "profile":
        if (hasPermission("个人资料管理")) handleProfile();
        break;
      case "cloudStorage":
        if (hasPermission("网盘空间")) handleCloudStorage();
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

  // 处理新对话点击事件
  const startNewChat = () => opts.onStartNewChat();

  // 处理知识库点击事件
  const openKnowledgeBase = () => {
    opts.router.push("/gene-display");
  };

  // 处理收藏页点击事件
  const openFavorites = () => {
    opts.router.push("/favorites");
  };

  // 处理开始教学点击事件
  const startTutorial = () => {
    opts.onStartTutorial();
  };

  // 处理选择对话事件
  const selectChat = (dialogueId: string) => opts.onSelectChat(dialogueId);

  // 权限检查方法
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
