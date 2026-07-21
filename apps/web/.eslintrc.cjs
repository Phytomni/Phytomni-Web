/* eslint-env node */
require("@rushstack/eslint-patch/modern-module-resolution");

module.exports = {
  root: true,
  extends: [
    "plugin:vue/vue3-essential",
    "eslint:recommended",
    "@vue/eslint-config-typescript/recommended",
    "@vue/eslint-config-prettier",
  ],
  // The tracked minified 3Dmol vendor bundle can trigger catastrophic parser
  // backtracking; keep the rest of public/ lintable. dist/ is generated output
  // from the build pipeline, not first-party source.
  ignorePatterns: ["dist/", "public/static/js/3Dmol-min.js"],
  parserOptions: {
    ecmaVersion: "latest",
  },
  rules: {
    // Formatting is enforced by the standalone G2.1 Prettier check. Keep
    // eslint-config-prettier's conflict disabling without duplicating its
    // formatter diagnostics in the semantic lint inventory.
    "prettier/prettier": "off",
    // The current source and test inventories are clean for these semantic
    // debt rules; keep the zero-warning contract fail-closed for new code.
    "@typescript-eslint/no-explicit-any": "error",
    "@typescript-eslint/no-non-null-assertion": "error",
    "@typescript-eslint/no-unused-vars": "error",
    // The Vue ecosystem (incl. Vue docs and `npm create vue@latest`)
    // routinely uses single-word names for layout/root components
    // (App, Layout, Sidebar, etc.). This codebase follows that
    // convention everywhere — enforcing multi-word names would force
    // 33 cosmetic renames across views/components without changing
    // runtime behavior. Disable globally to align the rule set with
    // project convention rather than fight it.
    "vue/multi-word-component-names": "off",
  },
  overrides: [
    {
      // Type-aware rules must see every first-party TypeScript/Vue file while
      // JavaScript and config files keep their existing parser behavior.
      files: ["**/*.ts", "**/*.tsx", "**/*.vue"],
      parserOptions: {
        project: "./tsconfig.eslint.json",
        tsconfigRootDir: __dirname,
      },
    },
    {
      // The handled-promise rule rolls out by characterized owner batch so a
      // rejected async outcome cannot be hidden behind a broad exemption
      // while the remaining owners are still being audited.
      files: [
        "src/main.ts",
        "src/utils/request.ts",
        "src/layout/index.vue",
        "src/views/change-password/index.vue",
        "src/views/error/401.vue",
        "src/views/forgot-password/index.vue",
        "src/views/login/index.vue",
        "src/views/register/index.vue",
        "src/components/DeepGenomeResultViewer.vue",
        "src/components/research/BotArtifactList.vue",
        "src/components/research/DeepGenomeArtifact.vue",
        "src/components/research/ResearchArtifactShell.vue",
        "src/components/shell/PhyAdaptiveShell.vue",
        "src/components/shell/PhyAdaptiveSidebar.vue",
        "src/composables/useDeepGenomeToc.ts",
        "src/views/digital-design-agent/index.vue",
        "src/views/gene-network-agent/index.vue",
        "src/views/research-agent/index.vue",
        "src/views/admin-management/index.vue",
        "src/views/favorites/index.vue",
        "src/views/gene-display/detail.vue",
        "src/views/gene-display/index.vue",
        "src/views/global-config/index.vue",
        "src/views/help/index.vue",
        "src/views/history/index.vue",
        "src/views/profile/index.vue",
        "src/views/task-manager/index.vue",
        "src/views/user-list/index.vue",
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
        "src/views/chat/sidebar.vue",
      ],
      rules: {
        "@typescript-eslint/no-floating-promises": [
          "error",
          { ignoreVoid: false },
        ],
      },
    },
    {
      // Promise-returning callbacks are explicit at event, visual-fixture,
      // and injected chat-scroll boundaries; every rejection is settled by
      // the owning synchronous wrapper or operation.
      files: [
        "src/components/research/ResearchEvidencePanel.vue",
        "src/layout/index.vue",
        "src/views/change-password/index.vue",
        "src/views/chat/index.vue",
        "src/views/chat/composables/useComposer.ts",
        "src/views/chat/composables/useFileUpload.ts",
        "src/views/chat/composables/useLogView.ts",
        "src/views/chat/composables/useReactions.ts",
        "src/views/profile/index.vue",
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
      // Await-thenable rollout covers only the contracts characterized in
      // Task 54; the remaining type-aware files stay observation-only.
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
      // Unsafe value reads are enabled only at the browser-storage, request,
      // and markdown configuration boundaries characterized in Task 56a.
      // The remaining findings stay observation-only until their owning
      // payload contracts are characterized in a later batch.
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
      // Agent payload and UI-library boundaries are strict after their
      // decoders/forms have been characterized in Task 56b. Test fixtures
      // remain observation-only until their owning production boundary is
      // complete.
      files: [
        "src/composables/useDeepGenomeDownloads.ts",
        "src/views/change-password/index.vue",
        "src/views/chat/composables/useBotCapabilities.ts",
        "src/views/chat/composables/useCopyDownload.ts",
        "src/views/chat/composables/useRefreshMessage.ts",
        "src/views/chat/composables/useSelectChat.ts",
        "src/views/chat/composables/useSendMessage.ts",
        "src/views/chat/streaming/a2uiParse.ts",
        "src/views/feedback/index.vue",
        "src/views/gene-display/detail.vue",
      ],
      rules: {
        "@typescript-eslint/no-unsafe-assignment": "error",
        "@typescript-eslint/no-unsafe-member-access": "error",
      },
    },
    {
      // Calls, arguments, and returns stay strict at the seven boundaries
      // characterized by the unsafe-propagation contract suite. Test fixtures
      // remain observation-only until their owning production boundary is
      // complete.
      files: [
        "src/components/MarkdownViewer.vue",
        "src/composables/useDeepGenomeDownloads.ts",
        "src/utils/index.ts",
        "src/utils/request.ts",
        "src/utils/sanitize-markup.ts",
        "src/views/chat/botProjection.ts",
        "src/views/research-agent/index.vue",
      ],
      rules: {
        "@typescript-eslint/no-unsafe-call": "error",
        "@typescript-eslint/no-unsafe-argument": "error",
        "@typescript-eslint/no-unsafe-return": "error",
      },
    },
    {
      // vite/plugins/*.js are build-time plugin factories that run in
      // Node context (process.cwd, path, etc.). Without an env flag,
      // ESLint flags `process` as no-undef. Limiting the override to
      // this directory keeps the browser-side default env intact.
      files: ["vite/plugins/*.js"],
      env: {
        node: true,
      },
    },
    {
      // Vite and Vitest configuration modules execute in Node, including the
      // TypeScript variants covered by the ESLint project above.
      files: [
        "vite/**/*.ts",
        "vite/**/*.js",
        "vite.config.ts",
        "vitest.config.ts",
      ],
      env: {
        node: true,
      },
    },
    {
      // Auth paths must never log request/response/error objects — they carry
      // the bearer token (Authorization / satoken headers; res.data.token).
      // Scoped here because the rest of the app uses console legitimately.
      files: ["src/views/login/**", "src/permission.ts"],
      rules: {
        "no-console": "error",
      },
    },
  ],
};
