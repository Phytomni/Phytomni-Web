import { fileURLToPath, URL } from "node:url";
import { defineConfig, loadEnv } from "vite";
// @ts-expect-error: vite/plugins/index.js has not been migrated to TypeScript yet — drop this directive when the file becomes vite/plugins/index.ts
import createVitePlugins from "./vite/plugins";
// import vue from '@vitejs/plugin-vue';
// import vueJsx from '@vitejs/plugin-vue-jsx';
// https://vitejs.dev/config/

export default defineConfig(({ mode, command }) => {
  // Load the .env file for the current working directory based on `mode`.
  // Passing '' as the third arg loads all env vars regardless of the `VITE_` prefix.
  const env = loadEnv(mode, process.cwd(), "");
  const { VITE_APP_BASE_URL, VITE_FILE_BASE, VITE_PORT } = env;
  const port = VITE_PORT || 5173; // port

  // Dev-only proxy targets — overridable via .env.dev so each engineer
  // points at their own LAN backend without editing this file. Defaults
  // to localhost so a fresh clone works against a locally-running Go
  // gateway (8080 is the canonical port from CLAUDE.md).
  const devProxyApi = env.VITE_DEV_PROXY_API || "http://localhost:8080";

  return {
    // envPrefix: "VITE_", // the env var prefix defaults to VITE_
    base: "/" + (VITE_APP_BASE_URL || ""),
    // plugins: [vue(), vueJsx()],
    plugins: createVitePlugins(env, command === "build"),
    resolve: {
      // https://cn.vitejs.dev/config/#resolve-alias
      alias: {
        "@": fileURLToPath(new URL("./src", import.meta.url)),
      },
      // https://cn.vitejs.dev/config/#resolve-extensions
      extensions: [".mjs", ".js", ".ts", ".jsx", ".tsx", ".json", ".vue"],
    },
    //fix:error:stdin>:7356:1: warning: "@charset" must be the first rule in the file
    css: {
      preprocessorOptions: {
        scss: {
          // additionalData: `$injectedColor: orange;`,
        },
      },
      postcss: {
        plugins: [
          {
            postcssPlugin: "internal:charset-removal",
            AtRule: {
              charset: (atRule) => {
                if (atRule.name === "charset") {
                  atRule.remove();
                }
              },
            },
          },
        ],
      },
    },
    server: {
      host: "0.0.0.0",
      port: port as number,
      open: true,
      proxy: {
        // detail: https://cli.vuejs.org/config/#devserver-proxy
        // The Go business API is consolidated under /api/v1; the frontend only
        // targets this surface. Legacy aliases for Bot write-back and external
        // server integration are server-to-server and skip the browser dev proxy.
        "/api/v1": {
          target: devProxyApi,
          changeOrigin: true,
        },
      },
    },
    build: {
      outDir: "dist",
      assetsInlineLimit: 4096,
      rollupOptions: {
        output: {
          manualChunks: {
            "vue-i18n": ["vue-i18n"],
            locales: ["./src/locales"],
          },
        },
      },
    },
  };
});
// export default defineConfig({
//   // envPrefix: "VITE_",
//   plugins: [vue(), vueJsx()],
//   resolve: {
//     alias: {
//       "@": fileURLToPath(new URL("./src", import.meta.url)),
//     },
//   },
// });
