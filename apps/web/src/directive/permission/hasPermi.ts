// v-hasPermi: removes the element unless the user holds one of the required permission flags.
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
    const hasPermissions = permissions.some((permission) => {
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
