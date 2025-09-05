/*
 * 组件注释
 * @Author: wuq-l
 * @Date: 2022-08-31 21:56:45
 * @LastEditors: wuq-l
 * @LastEditTime: 2022-09-01 16:34:52
 * @Description: 自定义指令
 * 例如：v-hasPermi='[**:**]'
 * 人生无常！大肠包小肠......
 */
import hasPermi from "./permission/hasPermi";

interface IApp {
  directive: (arg0: string, arg1: (el: any, binding: any) => void) => void;
}

function install(app: IApp) {
  app.directive("hasPermi", hasPermi);
}

export default install;
