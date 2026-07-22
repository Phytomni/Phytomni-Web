import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const SOURCE_ROOT = resolve(__dirname, "../../src/views");

function source(path: string): string {
  return readFileSync(resolve(SOURCE_ROOT, path), "utf8");
}

const dataSources = {
  favorites: source("favorites/FavoritesView.vue"),
  geneDetail: source("gene-display/GeneDetailView.vue"),
  geneDisplay: source("gene-display/GeneDisplayView.vue"),
  history: source("history/HistoryView.vue"),
  profile: source("profile/ProfileView.vue"),
  taskManager: source("task-manager/TaskManagerView.vue"),
};

const adminSources = {
  adminManagement: source("admin-management/AdminManagementView.vue"),
  globalConfig: source("global-config/GlobalConfigView.vue"),
  help: source("help/HelpView.vue"),
  userList: source("user-list/UserListView.vue"),
};

describe("data and admin async-owner contracts", () => {
  it("does not use void to discard data-surface promises", () => {
    expect(dataSources.favorites).not.toContain("void handleUnfavorite");
    expect(dataSources.favorites).not.toContain("void fetchFavorites");
    expect(dataSources.history).not.toContain("void fetchHistoryData");
    expect(dataSources.profile).not.toContain("void fetchUserInfo");
    expect(Object.values(dataSources)).not.toContain(
      expect.stringContaining("void fetchData")
    );
  });

  it("awaits or catches data refresh, retry, pagination, and navigation outcomes", () => {
    expect(dataSources.geneDisplay).toContain("await fetchData();");
    expect(dataSources.taskManager).toContain("await fetchData();");
    expect(dataSources.geneDetail).toContain(
      "fetchGeneDetail(fileName.value).catch(() => undefined);"
    );
    expect(dataSources.history).toContain(
      "Promise.resolve(\n    router.push(`/chat?dialogue_id=${history.dialogue_id}`)"
    );
    expect(dataSources.history).toContain(").catch(() => undefined);");
    expect(dataSources.favorites).toContain(
      "Promise.resolve(\n    router.push(`/chat?dialogue_id=${favorite.dialogue_id}`)"
    );
    expect(dataSources.favorites).toContain(").catch(() => undefined);");
  });

  it("keeps admin and configuration promises explicitly settled", () => {
    expect(adminSources.adminManagement).toContain("await fetchData();");
    expect(adminSources.userList).toContain("await fetchData();");
    expect(adminSources.globalConfig).toMatch(
      /ElMessageBox\.alert[\s\S]*\.catch\(\(\) => undefined\)/
    );
    expect(adminSources.help).toMatch(
      /Promise\.resolve\(router\.replace\("\/login"\)\)\.catch/
    );
    expect(adminSources.help).toMatch(
      /Promise\.resolve\(router\.push\("\/"\)\)\.catch/
    );
  });
});
