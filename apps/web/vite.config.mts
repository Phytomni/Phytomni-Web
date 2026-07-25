import { fileURLToPath, URL } from "node:url";
import type { IncomingMessage } from "node:http";
import { defineConfig, loadEnv } from "vite";
import type { ConfigEnv, UserConfig } from "vite";
import createVitePlugins from "./vite/plugins";
// import vue from '@vitejs/plugin-vue';
// import vueJsx from '@vitejs/plugin-vue-jsx';
// https://vitejs.dev/config/

const setSseNoDelay = (response: IncomingMessage): void => {
  response.socket?.setNoDelay?.(true);
};

export default defineConfig(({ mode, command }: ConfigEnv): UserConfig => {
  // Load the .env file for the current working directory based on `mode`.
  // Passing '' as the third arg loads all env vars regardless of the `VITE_` prefix.
  const env = loadEnv(mode, process.cwd(), "");
  const { VITE_APP_BASE_URL, VITE_PORT } = env;
  const parsedPort = Number.parseInt(VITE_PORT || "5173", 10);
  const port = Number.isFinite(parsedPort) ? parsedPort : 5173;

  // Dev-only proxy targets — overridable via .env.dev so each engineer
  // points at their own LAN backend without editing this file. Defaults
  // to localhost so a fresh clone works against a locally-running Go
  // gateway (8080 is the canonical port from CLAUDE.md).
  const devProxyApi = env.VITE_DEV_PROXY_API || "http://localhost:8080";

  const config: UserConfig = {
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
      port,
      open: true,
      proxy: {
        // detail: https://cli.vuejs.org/config/#devserver-proxy
        // The Go business API is consolidated under /api/v1; the frontend only
        // targets this surface. Legacy aliases for Bot write-back and external
        // server integration are server-to-server and skip the browser dev proxy.
        "/api/v1": {
          target: devProxyApi,
          changeOrigin: true,
          // SSE: forward each event chunk immediately instead of buffering to EOF.
          configure: (proxy) => {
            proxy.on("proxyRes", (proxyRes) => {
              if (
                proxyRes.headers["content-type"]?.includes("text/event-stream")
              ) {
                setSseNoDelay(proxyRes);
              }
            });
          },
        },
      },
    },
    build: {
      outDir: "dist",
      assetsInlineLimit: 4096,
      target: ["chrome111", "edge111", "firefox114", "safari16.4"],
      rolldownOptions: {
        output: {
          codeSplitting: {
            groups: [
              {
                name: "vue-i18n",
                test: /node_modules[/\\]vue-i18n[/\\]/,
                priority: 20,
              },
            ],
          },
        },
      },
    },
  };
  return config;
});
