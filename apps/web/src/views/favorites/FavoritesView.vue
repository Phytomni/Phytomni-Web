<template>
  <PhyWorkspaceShell class="favorites-workspace">
    <template #header>
      <PhyPageHeader :title="$t('menu.favorites')" />
    </template>

    <PhyAsyncState :state="asyncState">
      <template #loading>
        <PhySkeleton shape="table-row" :count="6" />
      </template>

      <template #empty>
        <PhyEmptyState
          :title="$t('chat.noFavorites')"
          :subtitle="$t('chat.noFavoritesDescription')"
        >
          <el-button type="primary" @click="goToChat">
            {{ $t("chat.startChat") }}
          </el-button>
        </PhyEmptyState>
      </template>

      <template #error>
        <PhyErrorState
          :title="$t('favorites.loadFailed')"
          :retry-label="$t('common.retry')"
          @retry="fetchFavorites"
        />
      </template>

      <template #ready>
        <PhyDataToolbar class="favorites-toolbar">
          <template #filters>
            <p class="favorites-count">
              {{ $t("chat.favoritesCount", { count: favoritesList.length }) }}
            </p>
          </template>
          <template #actions>
            <el-button
              class="favorites-refresh"
              :loading="refreshing"
              :aria-busy="refreshing"
              @click="refreshFavorites"
            >
              <el-icon><Refresh /></el-icon>
              {{ $t("chat.refresh") }}
            </el-button>
          </template>
        </PhyDataToolbar>

        <section class="favorites-list" :aria-label="$t('menu.favorites')">
          <article
            v-for="favorite in favoritesList"
            :key="favorite.id"
            class="favorite-row"
            role="link"
            tabindex="0"
            @click="openChat(favorite)"
            @keydown.enter="openChat(favorite)"
            @keydown.space.prevent="openChat(favorite)"
          >
            <div class="favorite-row__content">
              <h2 class="favorite-title">
                <el-icon class="favorite-title__icon"><Star /></el-icon>
                <span class="favorite-title__text">{{ favorite.title }}</span>
              </h2>
              <div class="favorite-meta">
                <time class="favorite-date" :datetime="favorite.date">
                  {{ formatDate(favorite.date) }}
                </time>
                <span class="favorite-id">ID: {{ favorite.id }}</span>
              </div>
            </div>

            <div class="favorite-action-menu" @click.stop @keydown.stop>
              <el-dropdown
                trigger="click"
                @command="(command) => handleFavoriteAction(command, favorite)"
              >
                <el-button
                  class="favorite-menu-trigger"
                  text
                  :aria-label="$t('chat.more')"
                  @click.stop
                >
                  <el-icon><MoreFilled /></el-icon>
                </el-button>
                <template #dropdown>
                  <el-dropdown-menu>
                    <el-dropdown-item command="rename" :icon="Edit">
                      {{ $t("chat.actions.rename") }}
                    </el-dropdown-item>
                    <el-dropdown-item command="unfavorite" :icon="Star" divided>
                      {{ $t("chat.actions.unfavorite") }}
                    </el-dropdown-item>
                  </el-dropdown-menu>
                </template>
              </el-dropdown>
            </div>
          </article>
        </section>
      </template>
    </PhyAsyncState>
  </PhyWorkspaceShell>

  <el-backtop target=".favorites-workspace" :right="40" :bottom="40" />

  <el-dialog
    v-model="renameDialogVisible"
    :title="$t('chat.actions.rename')"
    class="favorites-rename-dialog"
    width="min(640px, calc(100vw - 24px))"
    :close-on-click-modal="false"
    :close-on-press-escape="false"
    @close="handleRenameDialogClose"
  >
    <el-form ref="renameFormRef" :model="renameForm" :rules="renameRules">
      <el-form-item prop="title" :label="$t('chat.conversationTitle')">
        <el-input
          v-model="renameForm.title"
          :placeholder="$t('chat.actions.enterNewTitle')"
          maxlength="100"
          show-word-limit
          @keyup.enter="handleRenameConfirm"
        />
      </el-form-item>
    </el-form>
    <template #footer>
      <span class="dialog-footer">
        <el-button @click="renameDialogVisible = false">
          {{ $t("common.cancel") }}
        </el-button>
        <el-button type="primary" @click="handleRenameConfirm">
          {{ $t("common.confirm") }}
        </el-button>
      </span>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import { useI18n } from "vue-i18n";
import { Edit, MoreFilled, Refresh, Star } from "@element-plus/icons-vue";
import { ElMessage } from "element-plus";
import {
  PhyDataToolbar,
  PhyEmptyState,
  PhyPageHeader,
  PhyWorkspaceShell,
} from "@/components/shell";
import { PhyAsyncState, PhyErrorState, PhySkeleton } from "@/components/state";
import { collectHistory, getCollectHistory, renameHistory } from "@/api/chat";
import { formatDisplayDate } from "@/locales/format-display-date";

type AsyncState = "loading" | "empty" | "error" | "ready";

interface FavoriteItem {
  id: number;
  dialogue_id: string;
  title: string;
  date: string;
  isFavorite: boolean;
}

interface FavoriteApiItem {
  id: number;
  dialogue_id: string;
  title_query?: string;
  title?: string;
  query?: string;
  created_at?: string;
  date?: string;
}

const { t, d } = useI18n();
const router = useRouter();
const loading = ref(false);
const refreshing = ref(false);
const requestFailed = ref(false);
const favoritesList = ref<FavoriteItem[]>([]);

const renameDialogVisible = ref(false);
const renameForm = ref({ title: "" });
const renameFormRef = ref<{
  validate: () => Promise<boolean>;
  resetFields: () => void;
}>();
const renameRules = {
  title: [{ required: true, message: "Please enter a title", trigger: "blur" }],
};
const favoriteToRename = ref<FavoriteItem | null>(null);

const asyncState = computed<AsyncState>(() => {
  if (loading.value) return "loading";
  if (requestFailed.value) return "error";
  if (favoritesList.value.length === 0) return "empty";
  return "ready";
});

const fetchFavorites = async (showLoading = true): Promise<boolean> => {
  if (showLoading) loading.value = true;
  requestFailed.value = false;

  try {
    const response = await getCollectHistory();
    if (response.code === 200 && Array.isArray(response.data)) {
      favoritesList.value = response.data.map((item: FavoriteApiItem) => ({
        id: item.id,
        dialogue_id: item.dialogue_id,
        title: item.title_query || item.title || item.query || "",
        date: item.created_at || item.date || "",
        isFavorite: true,
      }));
      return true;
    }

    requestFailed.value = favoritesList.value.length === 0;
    ElMessage.error(response.message || t("favorites.loadFailed"));
    return false;
  } catch {
    requestFailed.value = favoritesList.value.length === 0;
    ElMessage.error(t("favorites.loadFailed"));
    return false;
  } finally {
    if (showLoading) loading.value = false;
  }
};

const refreshFavorites = async () => {
  refreshing.value = true;
  try {
    if (await fetchFavorites(false)) {
      ElMessage.success(t("common.refreshedSuccess"));
    }
  } finally {
    refreshing.value = false;
  }
};

const handleFavoriteAction = (command: string, favorite: FavoriteItem) => {
  if (command === "rename") {
    renameForm.value.title = favorite.title;
    favoriteToRename.value = favorite;
    renameDialogVisible.value = true;
  }

  if (command === "unfavorite") {
    Promise.resolve(handleUnfavorite(favorite)).catch(() => undefined);
  }
};

const handleUnfavorite = async (favorite: FavoriteItem) => {
  try {
    const formData = new FormData();
    formData.append("id", favorite.id.toString());
    formData.append("collect_type", "0");

    const response = await collectHistory(formData);
    if (response.code === 200) {
      const index = favoritesList.value.findIndex(
        (item) => item.id === favorite.id
      );
      if (index !== -1) favoritesList.value.splice(index, 1);
      ElMessage.success(t("favorites.removedSuccess"));
    } else {
      ElMessage.error(response.message || t("favorites.removeFailed"));
    }
  } catch {
    ElMessage.error(t("favorites.removeFailed"));
  }
};

const handleRenameConfirm = async () => {
  if (!renameFormRef.value || !favoriteToRename.value) return;

  try {
    if (await renameFormRef.value.validate()) {
      const formData = new FormData();
      formData.append("id", favoriteToRename.value.id.toString());
      formData.append("rename", renameForm.value.title);

      const response = await renameHistory(formData);
      if (response.code === 200) {
        const favorite = favoritesList.value.find(
          (item) => item.id === favoriteToRename.value?.id
        );
        if (favorite) favorite.title = renameForm.value.title;
        renameDialogVisible.value = false;
        favoriteToRename.value = null;
        ElMessage.success(t("common.renamedSuccess"));
      } else {
        ElMessage.error(response.message || t("common.renameFailedRetry"));
      }
    }
  } catch {
    ElMessage.error(t("common.renameFailedRetry"));
  }
};

const handleRenameDialogClose = () => {
  favoriteToRename.value = null;
  renameForm.value.title = "";
  renameFormRef.value?.resetFields();
};

const openChat = (favorite: FavoriteItem) => {
  Promise.resolve(
    router.push(`/chat?dialogue_id=${favorite.dialogue_id}`)
  ).catch(() => undefined);
};

const goToChat = () => {
  Promise.resolve(router.push("/chat")).catch(() => undefined);
};

const formatDate = (dateString: string) =>
  formatDisplayDate(d, dateString, "datetime");

onMounted(() => {
  fetchFavorites().catch(() => undefined);
});
</script>

<style lang="scss" scoped>
.favorites-workspace {
  min-width: 0;
}

.favorites-count {
  margin: 0;
  color: var(--phy-color-text);
  font-size: 1rem;
  font-weight: 600;
}

.favorites-list {
  display: grid;
  gap: var(--phy-space-12);
  min-width: 0;
}

.favorite-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: var(--phy-space-16);
  padding: var(--phy-space-16);
  border: 1px solid var(--phy-color-border);
  border-radius: var(--phy-radius-md);
  background: var(--phy-color-bg-elevated);
  cursor: pointer;
}

.favorite-row:hover {
  border-color: var(--phy-color-border-control);
}

.favorite-row:focus-visible {
  outline: 2px solid var(--phy-color-focus);
  outline-offset: 2px;
}

.favorite-row__content {
  min-width: 0;
}

.favorite-title {
  display: flex;
  gap: var(--phy-space-8);
  margin: 0;
  color: var(--phy-color-text);
  font-size: 1rem;
  line-height: 1.5;
}

.favorite-title__icon {
  flex: 0 0 auto;
  margin-top: 0.125rem;
  color: var(--phy-color-action-text);
}

.favorite-title__text {
  display: -webkit-box;
  overflow: hidden;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  overflow-wrap: anywhere;
}

.favorite-meta {
  display: flex;
  flex-wrap: wrap;
  gap: var(--phy-space-8) var(--phy-space-12);
  margin-top: var(--phy-space-8);
  color: var(--phy-color-text-secondary);
  font-size: 0.8125rem;
  line-height: 1.4;
}

.favorite-action-menu {
  align-self: start;
}

.favorite-menu-trigger {
  min-width: auto;
  color: var(--phy-color-text-secondary);
}

.dialog-footer {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: var(--phy-space-12);
}

.favorites-rename-dialog {
  max-height: min(720px, calc(100dvh - 32px));
  overflow: auto;
}

@media (max-width: 599px) {
  .favorite-row {
    gap: var(--phy-space-12);
    padding: var(--phy-space-12);
  }
}
</style>
