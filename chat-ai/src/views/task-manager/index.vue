<template>
  <div class="task-management-container">
    <div class="table-container">
      <el-table :data="tableData" border stripe v-loading="loading" style="width: 100%"
      header-row-class-name="table-header-row" header-cell-class-name="table-header-cell"
      >
        <el-table-column prop="query" :label="$t('taskManager.question')">
           <template #default="{ row }">
              <el-tooltip placement="top" :content="row?.query">
                <div class="itemQuery">
                  {{ row?.query }}
                </div>
              </el-tooltip>
          </template>
        </el-table-column>
        <el-table-column prop="status" :label="$t('taskManager.status')"  width="80" >
           <template #default="{ row }">
             {{ showStatus(row) }}
          </template>
        </el-table-column>
        <el-table-column prop="updated_at" :label="$t('taskManager.updated_at')" width="200">
           <template #default="{ row }">
             {{ moment(row.updated_at).format('YYYY-MM-DD') }}
          </template>
        </el-table-column>
        <!-- <el-table-column prop="upload_path" :label="$t('taskManager.downloadURL')" width="150" >
          <template #default="{ row }">
            <el-button @click="handleDownClick(row)" v-if="row?.status && row?.status=='SUCCEEDED' && row?.upload_path && row?.upload_path !=='' " type="primary">
              <el-icon style="vertical-align: middle">
                <Download />
              </el-icon>
              <span style="vertical-align: middle">{{ $t('taskManager.downloadURL') }}</span>
            </el-button>
          </template>
        </el-table-column> -->
        <el-table-column prop="dialogue_id" :label="$t('taskManager.operate')" width="320" >
           <template #default="{ row }">
            <el-space wrap alignment="start" :size="10">
              <el-button @click="handleDownClick(row)" v-if="row?.status && row?.status=='SUCCEEDED' && row?.download_path && row?.download_path !=='' " type="primary">
                <el-icon style="vertical-align: middle">
                  <Download />
                </el-icon>
                <span style="vertical-align: middle">{{ $t('taskManager.downloadURL') }}</span>
              </el-button>
              <el-button @click="handleTaskClick(row)"  type="primary">
                <el-icon style="vertical-align: middle">
                  <Link />
                </el-icon>
                <span style="vertical-align: middle">{{ $t('taskManager.dialogue_link') }}</span>
              </el-button>
            </el-space>
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
import moment from 'moment';
import { ref, onMounted } from 'vue';
import {
  Link,
  Download
} from '@element-plus/icons-vue';
import { ElMessage } from 'element-plus';
import { useI18n } from 'vue-i18n';
import { getTaskList } from '@/api/task-manager';
import { getChatdownloadURL } from '@/api/chat';

const { t } = useI18n();

interface TaskData {
  query?:string;
  status?:string;
  upload_path?:string;
  updated_at?:string;
  dialogue_id?:string;
  f_dialogue_id?:string;
  download_path?:string;
}

const loading = ref(false);
const currentPage = ref(1);
const pageSize = ref(10);
const total = ref(0);
const tableData = ref<TaskData[]>([]);

const fetchData = async () => {
  loading.value = true;
  try {
    const res = await getTaskList({
      current: currentPage.value,
      size: pageSize.value,
    });
    if (res.code === 200 && res.data) {
      tableData.value = res.data.gene_list || [];
      total.value = res.data.total || 0;
    } else {
      ElMessage.error(t('taskManager.getFailed'));
      tableData.value = [];
      total.value = 0;
    }
  } catch (error) {
    console.error(t('taskManager.logs.fetchDataFailed'), error);
    ElMessage.error(t('taskManager.getFailed'));
    tableData.value = [];
    total.value = 0;
  } finally {
    loading.value = false;
  }
};

const showStatus = (data:TaskData)=>{
  switch(data.status) {
    case 'SUCCEEDED':
      return t('common.finished');
    case 'FAILED':
      return t('common.failed');
    case 'RUNNING，':
      return t('common.running');
    default:
      return ''
  }
}

const handleDownClick = async (data:TaskData) => {
  console.log(data,'data');
  

  if(!data?.download_path)return;
  // 在这里调用 getChatdownloadURL 接口 获取下载链接
  const res = await getChatdownloadURL({ obs_path: data.download_path });
  if(res.code == 200){
    window.open(res.data,"_blank",'noopener,noreferrer')
  }
};

const handleTaskClick = (data:TaskData) => {
  const url = `/chat?dialogue_id=${data?.f_dialogue_id || data?.dialogue_id}`;
  window.open(url, '_blank');
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

<style lang="scss" scoped>
.task-management-container {
  padding: 20px;
  height: auto;
  min-height: 100%;
  .table-container {
    margin-bottom: 20px;

    .el-table {
      width: 100%;
    }
  }
  .pagination-container {
    margin-top: 20px;
    margin-bottom: 20px;
    display: flex;
    justify-content: flex-end;
  }

  .itemQuery {
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 3; /* 控制显示行数 */
    overflow: hidden;
    text-overflow: ellipsis;
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