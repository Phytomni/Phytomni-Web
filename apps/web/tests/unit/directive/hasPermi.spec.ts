import { describe, expect, it, vi } from "vitest";
import type { DirectiveBinding } from "vue";
import hasPermi, {
  type PermissionValue,
} from "@/directive/permission/hasPermi";

const mockStore = vi.hoisted(() => ({ permissions: [] as string[] }));

vi.mock("@/stores", () => ({
  userStore: () => mockStore,
}));

const binding = (value: PermissionValue): DirectiveBinding<PermissionValue> =>
  ({ value }) as DirectiveBinding<PermissionValue>;

describe("v-hasPermi", () => {
  it("keeps an element when a listed permission is present", () => {
    mockStore.permissions = ["gene:read"];
    const parent = document.createElement("div");
    const element = document.createElement("button");
    parent.appendChild(element);

    hasPermi(element, binding(["gene:read"]));

    expect(parent.contains(element)).toBe(true);
  });

  it("removes an element when no listed permission is present", () => {
    mockStore.permissions = ["gene:write"];
    const parent = document.createElement("div");
    const element = document.createElement("button");
    parent.appendChild(element);

    hasPermi(element, binding(["gene:read"]));

    expect(parent.contains(element)).toBe(false);
  });

  it("rejects an empty or scalar directive value", () => {
    const element = document.createElement("button");

    expect(() => hasPermi(element, binding([]))).toThrow(
      "Please set the operation permission tag value"
    );
    expect(() => hasPermi(element, binding("gene:read"))).toThrow(
      "Please set the operation permission tag value"
    );
  });
});
