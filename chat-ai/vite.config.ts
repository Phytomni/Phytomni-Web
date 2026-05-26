/*
 * 组件注释
 * @Author: wuq-l
 * @Date: 2022-08-18 21:07:25
 * @LastEditors: error: git config user.name & please set dead value or install git
 * @LastEditTime: 2025-05-15 11:37:22
 * @Description: vite 配置
 * 人生无常！大肠包小肠......
 */
import { fileURLToPath, URL } from 'node:url';
import { defineConfig, loadEnv } from 'vite';
// @ts-expect-error: vite/plugins/index.js has not been migrated to TypeScript yet — drop this directive when the file becomes vite/plugins/index.ts
import createVitePlugins from './vite/plugins';
// import vue from '@vitejs/plugin-vue';
// import vueJsx from '@vitejs/plugin-vue-jsx';
// https://vitejs.dev/config/

export default defineConfig(({ mode, command }) => {
  // 根据当前工作目录中的 `mode` 加载 .env 文件
  // 设置第三个参数为 '' 来加载所有环境变量，而不管是否有 `VITE_` 前缀。
  const env = loadEnv(mode, process.cwd(), '');
  const { VITE_APP_BASE_URL, VITE_BASE_API, VITE_FILE_BASE, VITE_PORT } = env;
  const port = VITE_PORT || 80; // 端口

  // Dev-only proxy targets — overridable via .env.dev so each engineer
  // points at their own LAN backend without editing this file. Defaults
  // to localhost so a fresh clone works against a locally-running Go +
  // Python pair (8082 / 8081 are the canonical ports from CLAUDE.md).
  const devProxyApi =
    env.VITE_DEV_PROXY_API || 'http://localhost:8082';
  const devProxyMcp =
    env.VITE_DEV_PROXY_MCP || 'http://localhost:8081';

  return {
    // envPrefix: "VITE_", // env 环境变量前缀默认就是VITE_
    base: '/' + VITE_APP_BASE_URL,
    // plugins: [vue(), vueJsx()],
    plugins: createVitePlugins(env, command === 'build'),
    resolve: {
      // https://cn.vitejs.dev/config/#resolve-alias
      alias: {
        '@': fileURLToPath(new URL('./src', import.meta.url)),
      },
      // https://cn.vitejs.dev/config/#resolve-extensions
      extensions: ['.mjs', '.js', '.ts', '.jsx', '.tsx', '.json', '.vue'],
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
            postcssPlugin: 'internal:charset-removal',
            AtRule: {
              charset: atRule => {
                if (atRule.name === 'charset') {
                  atRule.remove();
                }
              },
            },
          },
        ],
      },
    },
    server: {
      host: '0.0.0.0',
      port: port as number,
      open: true,
      proxy: {
        // detail: https://cli.vuejs.org/config/#devserver-proxy
        [VITE_BASE_API]: {
          target: devProxyApi,
          changeOrigin: true,
        },
        '/v1': {
          target: devProxyApi,
          changeOrigin: true,
        },
        '/query': {
          target: devProxyMcp,
          changeOrigin: true,
        },
      },
    },
    build: {
      outDir: 'dist',
      assetsInlineLimit: 4096,
      // 添加以下配置
      rollupOptions: {
        output: {
          manualChunks: {
            'vue-i18n': ['vue-i18n'],
            locales: ['./src/locales'],
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
