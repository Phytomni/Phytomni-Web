import { describe, expect, it } from "vitest";
import { constantRoutes } from "@/router";

type RouteRecord = {
  path: string;
  component?: unknown;
  children?: RouteRecord[];
  meta?: {
    layout?: string;
    hideSidebar?: boolean;
  };
};

const routes = constantRoutes as unknown as RouteRecord[];

function flattenLeafRoutes(records: RouteRecord[]): RouteRecord[] {
  return records.flatMap((record) =>
    record.children?.length
      ? flattenLeafRoutes(record.children)
      : record.component
        ? [record]
        : []
  );
}

const leafRoutes = flattenLeafRoutes(routes);

describe("product route metadata", () => {
  it("keeps no-layout and sidebar exceptions explicit and limited to known leaves", () => {
    const noLayoutPaths = leafRoutes
      .filter((route) => route.meta?.layout === "nolayout")
      .map((route) => route.path)
      .sort();
    const hiddenSidebarPaths = leafRoutes
      .filter((route) => route.meta?.hideSidebar === true)
      .map((route) => route.path)
      .sort();

    expect(noLayoutPaths).toEqual([
      "/401",
      "/:pathMatch(.*)*",
      "/analyst-agent",
      "/brief-gene-agent",
      "/cases/digital-design-agent",
      "/cases/gene-network-agent",
      "/change-password",
      "/chat",
      "/data-agent",
      "/deep-genome-agent",
      "/design",
      "/digital-design-agent",
      "/forgot-password",
      "/gene-display/detail",
      "/gene-network-agent",
      "/help",
      "/knowledge-agent",
      "/login",
      "/privacy",
      "/register",
      "/review-agent",
      "/terms",
    ]);
    expect(hiddenSidebarPaths).toEqual(["/gene-display"]);
  });

  it("does not register dormant dynamic routes as shipped routes", () => {
    const routerSource = routes.find((route) => route.path === "/");

    expect(routerSource?.component).toBeDefined();
    expect(leafRoutes.map((route) => route.path)).not.toContain(
      "/system/user-auth"
    );
  });
});
