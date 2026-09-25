// v-hasPermi: removes the element unless the user holds one of the required permission flags.
import type { DirectiveBinding } from "vue";
import { userStore } from "@/stores";

export type PermissionValue = readonly string[] | string;

export default function hasPermi(
  el: HTMLElement,
  binding: DirectiveBinding<PermissionValue>
): void {
  const store = userStore();
  const { value: permissionFlag } = binding;

  const all_permission = "*:*:*";
  const permissions = store.permissions;
  if (
    Array.isArray(permissionFlag) &&
    permissionFlag.length > 0 &&
    permissionFlag.every(
      (permission): permission is string => typeof permission === "string"
    )
  ) {
    const hasPermissions = permissions.some((permission) => {
      return (
        all_permission === permission || permissionFlag.includes(permission)
      );
    });

    if (!hasPermissions) {
      if (el.parentNode) el.parentNode.removeChild(el);
    }
  } else {
    throw new Error("Please set the operation permission tag value");
  }
}
