<template>
  <div class="cloud-storage-container">
    <div class="cloud-storage-content">
      <h1>网盘空间</h1>
      <p>这是一个简化的网盘空间页面</p>
      <el-button type="primary">测试按钮</el-button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue';

const title = ref('网盘空间');
</script>

<style lang="scss" scoped>
.cloud-storage-container {
  padding: 24px;
  background-color: #f5f7fa;
  min-height: 100vh;
}

.cloud-storage-content {
  max-width: 1200px;
  margin: 0 auto;
  text-align: center;
  
  h1 {
    color: #303133;
    margin-bottom: 16px;
  }
  
  p {
    color: #606266;
    margin-bottom: 24px;
  }
}
</style>
