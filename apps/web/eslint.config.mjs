import js from "@eslint/js";
import pluginVue from "eslint-plugin-vue";
import globals from "globals";
import { withVueTs, vueTsConfigs } from "@vue/eslint-config-typescript";
import skipFormattingConfig from "@vue/eslint-config-prettier/skip-formatting";

export default withVueTs(
  {
    rootDir: import.meta.dirname,
    scriptLangs: ["ts"],
  },
  {
    name: "phytomni/javascript",
    files: ["**/*.{js,cjs,mjs}"],
    ...js.configs.recommended,
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.node,
      },
    },
  },
  pluginVue.configs["flat/essential"],
  vueTsConfigs.recommended,
  {
    name: "phytomni/type-information",
    files: ["**/*.{ts,tsx,vue}"],
    languageOptions: {
      parserOptions: {
        projectService: false,
        project: "./tsconfig.eslint.json",
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    name: "phytomni/base-rules",
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-non-null-assertion": "error",
      "@typescript-eslint/no-unused-vars": "error",
      "vue/multi-word-component-names": "error",
    },
  },
  {
    name: "phytomni/handled-promises",
    files: [
      "src/main.ts",
      "src/utils/request.ts",
      "src/layout/LayoutView.vue",
      "src/views/change-password/ChangePasswordView.vue",
      "src/views/error/UnauthorizedView.vue",
      "src/views/forgot-password/ForgotPasswordView.vue",
      "src/views/login/LoginView.vue",
      "src/views/register/RegisterView.vue",
      "src/components/DeepGenomeResultViewer.vue",
      "src/components/research/BotArtifactList.vue",
      "src/components/research/DeepGenomeArtifact.vue",
      "src/components/research/ResearchArtifactShell.vue",
      "src/components/shell/PhyAdaptiveShell.vue",
      "src/components/shell/PhyAdaptiveSidebar.vue",
      "src/composables/useDeepGenomeToc.ts",
      "src/views/digital-design-agent/DigitalDesignAgentView.vue",
      "src/views/gene-network-agent/GeneNetworkAgentView.vue",
      "src/views/research-agent/ResearchAgentView.vue",
      "src/views/admin-management/AdminManagementView.vue",
      "src/views/favorites/FavoritesView.vue",
      "src/views/gene-display/GeneDetailView.vue",
      "src/views/gene-display/GeneDisplayView.vue",
      "src/views/global-config/GlobalConfigView.vue",
      "src/views/help/HelpView.vue",
      "src/views/history/HistoryView.vue",
      "src/views/profile/ProfileView.vue",
      "src/views/task-manager/TaskManagerView.vue",
      "src/views/user-list/UserListView.vue",
      "src/views/chat/composables/useAgentImages.ts",
      "src/views/chat/composables/useChatHistoryActions.ts",
      "src/views/chat/composables/useComposer.ts",
      "src/views/chat/composables/useCopyDownload.ts",
      "src/views/chat/composables/useFileUpload.ts",
      "src/views/chat/composables/useLogView.ts",
      "src/views/chat/composables/useReactions.ts",
      "src/views/chat/composables/useRefreshMessage.ts",
      "src/views/chat/composables/useSelectChat.ts",
      "src/views/chat/composables/useSendMessage.ts",
      "src/views/chat/composables/useSidebarNavigation.ts",
      "src/views/chat/ChatSidebar.vue",
    ],
    rules: {
      "@typescript-eslint/no-floating-promises": [
        "error",
        { ignoreVoid: false },
      ],
    },
  },
  {
    name: "phytomni/callback-promises",
    files: [
      "src/components/research/ResearchEvidencePanel.vue",
      "src/layout/LayoutView.vue",
      "src/views/change-password/ChangePasswordView.vue",
      "src/views/chat/ChatView.vue",
      "src/views/chat/composables/useComposer.ts",
      "src/views/chat/composables/useFileUpload.ts",
      "src/views/chat/composables/useLogView.ts",
      "src/views/chat/composables/useReactions.ts",
      "src/views/profile/ProfileView.vue",
      "tests/unit/composables/useDeepGenomeDownloads.spec.ts",
      "tests/visual/chat/main.ts",
      "tests/visual/research/main.ts",
    ],
    rules: {
      "@typescript-eslint/no-misused-promises": [
        "error",
        {
          checksConditionals: true,
          checksSpreads: true,
          checksVoidReturn: true,
        },
      ],
    },
  },
  {
    name: "phytomni/await-thenable",
    files: [
      "src/composables/useDeepGenomeDownloads.ts",
      "src/views/chat/composables/useRefreshMessage.ts",
      "src/views/chat/composables/useSelectChat.ts",
      "src/views/chat/composables/useSendMessage.ts",
    ],
    rules: {
      "@typescript-eslint/await-thenable": "error",
    },
  },
  {
    name: "phytomni/unsafe-storage-request-markdown",
    files: [
      "src/permission.ts",
      "src/stores/app.ts",
      "src/stores/theme.ts",
      "src/stores/user.ts",
      "src/utils/auth.ts",
      "src/utils/index.ts",
      "src/utils/markdown-inline.ts",
      "src/utils/request.ts",
    ],
    rules: {
      "@typescript-eslint/no-unsafe-assignment": "error",
      "@typescript-eslint/no-unsafe-member-access": "error",
    },
  },
  {
    name: "phytomni/unsafe-agent-ui",
    files: [
      "src/composables/useDeepGenomeDownloads.ts",
      "src/views/change-password/ChangePasswordView.vue",
      "src/views/chat/composables/useBotCapabilities.ts",
      "src/views/chat/composables/useCopyDownload.ts",
      "src/views/chat/composables/useRefreshMessage.ts",
      "src/views/chat/composables/useSelectChat.ts",
      "src/views/chat/composables/useSendMessage.ts",
      "src/views/chat/streaming/a2uiParse.ts",
      "src/views/feedback/FeedbackView.vue",
      "src/views/gene-display/GeneDetailView.vue",
    ],
    rules: {
      "@typescript-eslint/no-unsafe-assignment": "error",
      "@typescript-eslint/no-unsafe-member-access": "error",
    },
  },
  {
    name: "phytomni/unsafe-propagation",
    files: [
      "src/components/MarkdownViewer.vue",
      "src/composables/useDeepGenomeDownloads.ts",
      "src/utils/index.ts",
      "src/utils/request.ts",
      "src/utils/sanitize-markup.ts",
      "src/views/chat/botProjection.ts",
      "src/views/research-agent/ResearchAgentView.vue",
    ],
    rules: {
      "@typescript-eslint/no-unsafe-call": "error",
      "@typescript-eslint/no-unsafe-argument": "error",
      "@typescript-eslint/no-unsafe-return": "error",
    },
  },
  {
    name: "phytomni/node-build-files",
    files: [
      "vite/**/*.{ts,js}",
      "vite.config.mts",
      "vitest.config.mts",
      "eslint.config.mjs",
      "scripts/quality/*.mjs",
    ],
    languageOptions: {
      globals: globals.node,
    },
  },
  {
    name: "phytomni/auth-console",
    files: ["src/views/login/**", "src/permission.ts"],
    rules: {
      "no-console": "error",
    },
  },
  skipFormattingConfig
);
