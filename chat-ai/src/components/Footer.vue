<!--
 * 组件注释
 * @Author: AI Assistant
 * @Date: 2025-01-XX
 * @Description: 备案信息组件
 -->
<template>
  <div class="footer-container">
    <div class="footer-content">
      <a href="https://beian.miit.gov.cn/" target="_blank" rel="noopener noreferrer" class="icp-link">
        京ICP备07026971号-9
      </a>
    </div>
  </div>
</template>

<script setup lang="ts">
// 备案信息组件，无需额外逻辑
</script>

<style scoped lang="scss">
.footer-container {
  width: 100%;
  padding: 12px 0;
  text-align: center;
  background-color: transparent;
  border-top: 1px solid rgba(0, 0, 0, 0.06);
  margin-top: auto;
}

.footer-content {
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  color: #909399;
}

.icp-link {
  color: #909399;
  text-decoration: none;
  transition: color 0.3s;

  &:hover {
    color: #409eff;
    text-decoration: underline;
  }

  &:visited {
    color: #909399;
  }
}

// 暗色主题适配
:global(.theme-dark) .footer-container {
  border-top-color: rgba(255, 255, 255, 0.1);
}

:global(.theme-dark) .footer-content {
  color: #909399;
}

:global(.theme-dark) .icp-link {
  color: #909399;

  &:hover {
    color: #409eff;
  }
}
</style>

