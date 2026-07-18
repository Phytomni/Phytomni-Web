<template>
  <PhyWorkspaceShell class="gene-display-workspace">
    <template #header>
      <PhyPageHeader :title="$t('menu.deepGenome')" />
    </template>

    <template #filters>
      <PhyDataToolbar>
        <template #filters>
          <div class="gene-search-field">
            <label class="gene-search-label" for="gene-display-search">
              {{ $t("gene.searchPlaceholder") }}
            </label>
            <el-input
              id="gene-display-search"
              v-model="searchQuery"
              :aria-label="$t('gene.searchPlaceholder')"
              :placeholder="$t('gene.searchPlaceholder')"
              class="gene-search-control"
              clearable
              @keyup.enter="handleSearch"
            >
              <template #append>
                <el-button
                  class="gene-search-button"
                  :aria-label="$t('gene.searchPlaceholder')"
                  :icon="Search"
                  @click="handleSearch"
                />
              </template>
            </el-input>
          </div>
          <span
            class="gene-results-count"
            aria-live="polite"
            aria-atomic="true"
          >
            {{ $t("gene.resultsCount", { count: total }) }}
          </span>
        </template>
      </PhyDataToolbar>
    </template>

    <PhyAsyncState :state="asyncState">
      <template #loading>
        <div class="gene-state-surface">
          <PhySkeleton shape="table-row" :count="6" />
        </div>
      </template>

      <template #empty>
        <div class="gene-state-surface">
          <PhyEmptyState :title="$t('common.noData')" />
        </div>
      </template>

      <template #error>
        <div class="gene-state-surface">
          <PhyErrorState
            :title="$t('gene.getFailed')"
            :description="$t('common.opFailedRetry')"
            :retry-label="$t('common.retry')"
            @retry="fetchData"
          />
        </div>
      </template>

      <template #ready>
        <PhyTableFrame>
          <el-table :data="tableData" class="gene-table" table-layout="fixed">
            <el-table-column
              type="index"
              :label="$t('common.index')"
              width="72"
              align="center"
            />
            <el-table-column
              prop="species_code"
              :label="$t('gene.biocode')"
              min-width="140"
            >
              <template #default="{ row }">
                <span class="gene-code gene-species-code">
                  {{ row.species_code }}
                </span>
              </template>
            </el-table-column>
            <el-table-column
              prop="gene_id"
              :label="$t('gene.geneId')"
              min-width="220"
            >
              <template #default="{ row }">
                <button
                  type="button"
                  class="gene-primary-action gene-code"
                  @click="handleGeneClick(row)"
                >
                  {{ row.gene_id }}
                </button>
              </template>
            </el-table-column>
            <el-table-column
              prop="file_name"
              :label="$t('gene.geneName')"
              min-width="260"
            >
              <template #default="{ row }">
                <span class="gene-file-name gene-code">
                  {{ row.file_name }}
                </span>
              </template>
            </el-table-column>
          </el-table>

          <template #pagination>
            <el-pagination
              v-model:current-page="currentPage"
              v-model:page-size="pageSize"
              class="gene-pagination"
              :page-sizes="[10, 20, 30, 50]"
              layout="total, sizes, prev, pager, next, jumper"
              :total="total"
              @size-change="handleSizeChange"
              @current-change="handleCurrentChange"
            />
          </template>
        </PhyTableFrame>
      </template>
    </PhyAsyncState>
  </PhyWorkspaceShell>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { Search } from "@element-plus/icons-vue";
import { ElMessage } from "element-plus";
import { getGeneList } from "@/api/gene-display";
import { useI18n } from "vue-i18n";
import {
  PhyDataToolbar,
  PhyEmptyState,
  PhyPageHeader,
  PhyTableFrame,
  PhyWorkspaceShell,
} from "@/components/shell";
import { PhyAsyncState, PhyErrorState, PhySkeleton } from "@/components/state";

type AsyncState = "loading" | "empty" | "error" | "ready";

interface GeneData {
  id: number;
  species_code: string;
  gene_id: string;
  file_name: string;
}

const { t } = useI18n();
const searchQuery = ref("");
const loading = ref(false);
const requestFailed = ref(false);
const currentPage = ref(1);
const pageSize = ref(20);
const total = ref(0);
const tableData = ref<GeneData[]>([]);

const asyncState = computed<AsyncState>(() => {
  if (loading.value) return "loading";
  if (requestFailed.value) return "error";
  if (tableData.value.length === 0) return "empty";
  return "ready";
});

const handleGeneClick = (gene: GeneData) => {
  const url = `/gene-display/detail?file_name=${gene.file_name}`;
  window.open(url, "_blank");
};

const fetchData = async () => {
  loading.value = true;
  requestFailed.value = false;

  try {
    const res = await getGeneList({
      title: searchQuery.value,
      current: currentPage.value,
      size: pageSize.value,
    });

    if (res.code === 200 && res.data) {
      tableData.value = res.data.gene_list || [];
      total.value = res.data.total || 0;
    } else {
      tableData.value = [];
      total.value = 0;
      requestFailed.value = true;
      ElMessage.error(res.message || t("gene.getFailed"));
    }
  } catch (error) {
    console.error(t("gene.logs.fetchDataFailed"), error);
    tableData.value = [];
    total.value = 0;
    requestFailed.value = true;
    ElMessage.error(t("gene.getFailed"));
  } finally {
    loading.value = false;
  }
};

const handleSearch = () => {
  currentPage.value = 1;
  fetchData();
};

const handleSizeChange = (size: number) => {
  pageSize.value = size;
  fetchData();
};

const handleCurrentChange = (page: number) => {
  currentPage.value = page;
  fetchData();
};

onMounted(() => {
  fetchData();
});
</script>

<style scoped lang="scss">
.gene-display-workspace {
  height: 100%;
}

.gene-search-field {
  display: grid;
  width: min(100%, 560px);
  min-width: 0;
  gap: var(--phy-space-8);
}

.gene-search-label {
  color: var(--phy-color-text-secondary);
  font-size: 0.8125rem;
  font-weight: 600;
  line-height: 1.35;
}

.gene-search-control {
  width: 100%;
  max-width: 100%;
}

.gene-results-count {
  display: inline-flex;
  align-items: center;
  min-height: var(--phy-control-height-default);
  color: var(--phy-color-text-secondary);
  font-size: 0.8125rem;
  white-space: nowrap;
}

:deep(.gene-search-control .el-input__wrapper) {
  background: var(--phy-color-bg-elevated);
}

:deep(.gene-search-button) {
  min-width: var(--phy-control-height-default);
}

.gene-state-surface {
  min-height: 220px;
  padding: var(--phy-space-24);
  border: 1px solid var(--phy-color-border-subtle);
  border-radius: var(--phy-radius-md);
  background: var(--phy-color-bg-elevated);
}

.gene-table {
  min-width: 720px;
}

.gene-code {
  font-family: var(--phy-font-mono);
  font-variant-numeric: tabular-nums;
}

.gene-species-code {
  color: var(--phy-color-text-secondary);
  font-size: 0.875rem;
  font-weight: 600;
}

.gene-file-name {
  color: var(--phy-color-text-secondary);
  font-size: 0.8125rem;
  overflow-wrap: anywhere;
}

.gene-primary-action {
  max-width: 100%;
  padding: 3px 4px;
  border: 0;
  border-radius: var(--phy-radius-sm);
  background: transparent;
  color: var(--phy-color-action-text);
  cursor: pointer;
  font-size: 0.875rem;
  font-weight: 600;
  overflow-wrap: anywhere;
  text-align: left;
}

.gene-primary-action:hover {
  color: var(--phy-color-action-text-hover);
  text-decoration: underline;
  text-underline-offset: 0.16em;
}

.gene-primary-action:focus-visible {
  outline: 2px solid var(--phy-color-focus);
  outline-offset: 2px;
}

:deep(.gene-table th.el-table__cell) {
  background: var(--phy-color-fill-subtle) !important;
  color: var(--phy-color-text);
  font-weight: 600;
}

:deep(.gene-table td.el-table__cell) {
  color: var(--phy-color-text);
  background: var(--phy-color-bg-elevated);
}

:deep(.gene-table .el-table__row:hover > td.el-table__cell) {
  background: var(--phy-color-fill-subtle);
}

:deep(.gene-pagination.el-pagination) {
  display: flex;
  width: 100%;
  min-width: 0;
  flex-wrap: wrap;
  justify-content: flex-end;
  row-gap: var(--phy-space-8);
}

@media (max-width: 599px) {
  .gene-search-field {
    width: 100%;
  }

  .gene-state-surface {
    min-height: 180px;
    padding: var(--phy-space-16);
  }

  :deep(.gene-pagination.el-pagination) {
    justify-content: flex-start;
  }

  :deep(.gene-pagination .el-pagination__jump),
  :deep(.gene-pagination .el-pagination__sizes) {
    margin-left: 0;
  }
}
</style>
