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
// @ts-ignore
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
          target: `http://192.168.12.153:8082/`,
          // target: `http://192.168.8.62:8082/`,
          changeOrigin: true,
          // rewrite: path => {
          //   const reg = new RegExp('^' + VITE_BASE_API);
          //   return path.replace(reg, '');
          // },
        },
        '/v1': {
          target: `http://192.168.12.153:8082/`,
          // target: `http://192.168.8.62:8082/`,
          changeOrigin: true,
          // rewrite: path => {
          //   const reg = new RegExp('^' + VITE_BASE_API);
          //   return path.replace(reg, '');
          // },
        },
        '/query': {
          target: `http://192.168.12.153:8081/`,
          // target: `http://192.168.8.62:8081/`,
          changeOrigin: true,
          // rewrite: (path) => path.replace(/^\/api/, ''),
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
