// Custom directives. Example usage: v-hasPermi="['*:*:*']"
import type { App } from "vue";
import hasPermi from "./permission/hasPermi";

function install(app: App): void {
  app.directive("hasPermi", hasPermi);
}

export default install;
