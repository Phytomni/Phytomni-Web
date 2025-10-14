/*
 * 组件注释
 * @Author: wuq-l
 * @Date: 2022-08-31 21:58:29
 * @LastEditors: wuq-l
 * @LastEditTime: 2022-09-01 15:38:32
 * @Description: hasPermi 是否满足展示需求
 * 人生无常！大肠包小肠......
 */
import { userStore } from "@/stores";
export default function (
  el: { parentNode: { removeChild: (arg0: any) => any } },
  binding: { value: string[] }
): void {
  const store = userStore();
  const { value: permissionFlag } = binding;

  const all_permission = "*:*:*";
  const permissions = store.permissions;
  if (Array.isArray(permissionFlag) && permissionFlag.length) {
    const hasPermissions = permissions.some(permission => {
      return (
        all_permission === permission || permissionFlag.includes(permission)
      );
    });

    if (!hasPermissions) {
      el.parentNode && el.parentNode.removeChild(el);
    }
  } else {
    throw new Error("`请设置操作权限标签值`");
  }
}
