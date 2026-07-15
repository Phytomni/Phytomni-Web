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
  box-sizing: border-box;
  width: 100%;
  margin-top: auto;
  padding: var(--phy-space-12) 0;
  border-top: 1px solid var(--phy-color-border-subtle);
  background-color: transparent;
  text-align: center;
}

.footer-content {
  display: flex;
  box-sizing: border-box;
  width: 100%;
  align-items: center;
  flex-wrap: wrap;
  justify-content: center;
  gap: var(--phy-space-4) var(--phy-space-8);
  padding: 0 var(--phy-space-16);
  color: var(--phy-color-text-muted);
  font-size: 12px;
}

.legal-link,
.icp-link {
  display: inline-flex;
  min-height: var(--phy-control-height-default);
  align-items: center;
  border-radius: var(--phy-radius-sm);
  color: var(--phy-color-text-muted);
  text-decoration: none;
  transition: color var(--phy-motion-fast) var(--phy-motion-ease-out);

  &:visited {
    color: var(--phy-color-text-muted);
  }

  &:hover {
    color: var(--phy-color-action-text-hover);
    text-decoration: underline;
    text-underline-offset: 0.15em;
  }

  &:focus-visible {
    outline: 2px solid var(--phy-color-focus);
    outline-offset: 2px;
  }
}

@media (max-width: 899px) {
  .legal-link,
  .icp-link {
    min-height: calc(var(--phy-control-height-default) + var(--phy-space-4));
  }
}

.footer-sep {
  user-select: none;
}
</style>
