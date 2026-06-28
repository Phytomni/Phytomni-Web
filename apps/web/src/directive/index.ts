// Custom directives. Example usage: v-hasPermi="['*:*:*']"
import hasPermi from "./permission/hasPermi";

interface IApp {
  directive: (arg0: string, arg1: (el: any, binding: any) => void) => void;
}

function install(app: IApp) {
  app.directive("hasPermi", hasPermi);
}

export default install;
