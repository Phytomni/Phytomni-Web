<template>
  <div class="footer-container">
    <div class="footer-content">
      <a href="/terms" class="legal-link">{{ $t("legal.termsTitle") }}</a>
      <span class="footer-sep" aria-hidden="true">·</span>
      <a href="/privacy" class="legal-link">{{ $t("legal.privacyTitle") }}</a>
      <span class="footer-sep" aria-hidden="true">·</span>
      <a
        href="https://beian.miit.gov.cn/"
        target="_blank"
        rel="noopener noreferrer"
        class="icp-link"
      >
        京ICP备07026971号-9
      </a>
    </div>
  </div>
</template>

<script setup lang="ts">
// ICP footer component; no extra logic needed
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
  gap: 8px;
  font-size: 12px;
  color: #909399;
}

.legal-link,
.icp-link {
  color: #909399;
  text-decoration: none;
  transition: color 0.3s;

  &:hover {
    color: var(--el-color-primary);
    text-decoration: underline;
  }

  &:visited {
    color: #909399;
  }
}

// dark theme adaptation
:global(.theme-dark) .footer-container {
  border-top-color: rgba(255, 255, 255, 0.1);
}

:global(.theme-dark) .footer-content {
  color: #909399;
}

:global(.theme-dark) .legal-link,
:global(.theme-dark) .icp-link {
  color: #909399;

  &:hover {
    color: var(--el-color-primary);
  }
}

.footer-sep {
  user-select: none;
}
</style>
