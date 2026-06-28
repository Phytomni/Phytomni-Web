import cache from "./cache";

export default function installPlugins(app) {
  // Cache object
  app.config.globalProperties.$cache = cache;
}
