<!--
 * 组件注释
 * @Author: AI assistant
 * @Date: 2025-07-17
 * @Description: 助手任务管理页面，包含对话列表信息表格
 * 既往不恋！当下不杂！！未来不迎！！！
-->
<template>
  <div class="gene-display-container">
    <div class="search-container">
      <el-input v-model="searchQuery" :placeholder="$t('gene.searchPlaceholder')" class="input-with-search"
        @keyup.enter="handleSearch">
        <template #append>
          <el-button :icon="Search" @click="handleSearch" />
        </template>
      </el-input>
    </div>

    <div class="table-container">
      <el-table :data="tableData" border stripe v-loading="loading" style="width: 100%"
        header-row-class-name="table-header-row" header-cell-class-name="table-header-cell">
        <el-table-column type="index" :label="$t('common.index')" width="80" align="center" />
        <el-table-column prop="species_code" :label="$t('gene.biocode')" align="center">
          <template #default="{ row }">
            <span class="gene-name-highlight" @click="handleGeneClick(row)">
              {{ row.species_code }}
            </span>
          </template>
        </el-table-column>
        <el-table-column prop="gene_id" :label="$t('gene.geneId')" align="center">
          <template #default="{ row }">
            <span class="gene-name-highlight" @click="handleGeneClick(row)">
              {{ row.gene_id }}
            </span>
          </template>
        </el-table-column>
        <el-table-column prop="file_name" :label="$t('gene.geneName')" align="center">
          <template #default="{ row }">
            <span>
              {{ row.file_name }}
            </span>
          </template>
        </el-table-column>
      </el-table>

      <div class="pagination-container">
        <el-pagination v-model:current-page="currentPage" v-model:page-size="pageSize" :page-sizes="[10, 20, 30, 50]"
          layout="total, sizes, prev, pager, next, jumper" :total="total" @size-change="handleSizeChange"
          @current-change="handleCurrentChange" />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { Search } from '@element-plus/icons-vue';
import { ElMessage } from 'element-plus';
import { getGeneList } from '@/api/gene-display';
import { useI18n } from 'vue-i18n';

const { t } = useI18n();

interface GeneData {
  id: number;
  title: string;
  synopsis: string;
  picture: string;
}

const searchQuery = ref('');
const loading = ref(false);
const currentPage = ref(1);
const pageSize = ref(20);
const total = ref(0);
const tableData = ref<GeneData[]>([]);

const handleGeneClick = (gene: GeneData) => {
  const url = `/gene-display/detail?file_name=${gene.file_name}`;
  window.open(url, '_blank');
};

const fetchData = async () => {
  loading.value = true;
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
      ElMessage.error(t('gene.getFailed'));
      tableData.value = [];
      total.value = 0;
    }
  } catch (error) {
    console.error(t('gene.logs.fetchDataFailed'), error);
    ElMessage.error(t('gene.getFailed'));
    tableData.value = [];
    total.value = 0;
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
.gene-display-container {
  height: auto;
  min-height: 100%;
  padding: 20px;

  .search-container {
    margin-bottom: 20px;

    .input-with-search {
      width: 400px;
      max-width: 100%;
    }
  }

  .table-container {
    margin-bottom: 20px;

    .el-table {
      width: 100%;
    }

    .gene-name-highlight {
      color: #409eff;
      font-weight: bold;
      cursor: pointer;
      transition: color 0.3s;

      &:hover {
        color: #66b1ff;
        text-decoration: underline;
      }
    }
  }

  .pagination-container {
    margin-top: 20px;
    margin-bottom: 20px;
    display: flex;
    justify-content: flex-end;
  }
}

:deep(.table-header-row) {
  background-color: #409eff !important;
}

:deep(.table-header-cell) {
  background-color: #409eff !important;
  color: white !important;
  font-weight: bold !important;
}
:deep(.el-input__wrapper) {
  background-color: transparent !important;
}
:deep(.el-select__wrapper) {
  background-color: transparent !important;
}
</style>
