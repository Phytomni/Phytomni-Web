<template>
  <div class="legal-page">
    <div class="legal-toolbar">
      <LangSwitch />
    </div>
    <p v-if="draftBanner" class="legal-draft-banner">{{ draftBanner }}</p>
    <header class="legal-header">
      <h1>{{ title }}</h1>
      <p class="legal-meta">
        {{ t("legal.versionLabel") }}: {{ doc.version }} ·
        {{ t("legal.effectiveLabel") }}: {{ doc.effectiveDate }}
      </p>
    </header>
    <article v-if="bodyHtml" class="legal-body" v-html="bodyHtml" />
    <p v-else class="legal-error">{{ t("legal.loadError") }}</p>
    <Footer class="legal-footer" />
  </div>
</template>

<script setup lang="ts">
import { computed, watchEffect, ref } from "vue";
import { useRoute } from "vue-router";
import { useI18n } from "vue-i18n";
import LangSwitch from "@/components/LangSwitch.vue";
import Footer from "@/components/Footer.vue";
import { loadLegalDoc, type LegalDocKind } from "@/legal/loadLegalDoc";
import { renderLegalMarkdown } from "@/legal/renderLegalMarkdown";

const route = useRoute();
const { t, locale } = useI18n();

const kind = computed<LegalDocKind>(() =>
  route.meta.doc === "privacy" ? "privacy" : "terms"
);

const doc = ref(loadLegalDoc(kind.value, locale.value));
const bodyHtml = ref("");

watchEffect(() => {
  doc.value = loadLegalDoc(kind.value, locale.value);
  try {
    bodyHtml.value = renderLegalMarkdown(doc.value.markdown);
  } catch {
    bodyHtml.value = "";
  }
});

const title = computed(() =>
  kind.value === "privacy" ? t("legal.privacyTitle") : t("legal.termsTitle")
);
const draftBanner = computed(() => t("legal.draftBanner"));
</script>

<style lang="scss" scoped>
.legal-page {
  /* App.vue locks html/body/#app to overflow:hidden; this page is the scroll root. */
  height: 100vh;
  overflow-y: auto;
  box-sizing: border-box;
  padding: 24px 20px 0;
  background: var(--el-bg-color-page, #f5f7fa);
  color: var(--el-text-color-primary, #303133);
}

.legal-toolbar {
  display: flex;
  justify-content: flex-end;
  max-width: 760px;
  margin: 0 auto 16px;
}

.legal-draft-banner {
  max-width: 760px;
  margin: 0 auto 20px;
  padding: 12px 16px;
  border-radius: 4px;
  background: var(--el-fill-color-light, #f4f4f5);
  border: 1px solid var(--el-border-color-lighter, #ebeef5);
  color: var(--el-text-color-regular, #606266);
  font-size: 14px;
  line-height: 1.5;
}

.legal-header {
  max-width: 760px;
  margin: 0 auto 24px;

  h1 {
    margin: 0 0 8px;
    font-size: 28px;
    font-weight: 600;
    line-height: 1.3;
  }
}

.legal-meta {
  margin: 0;
  font-size: 14px;
  color: var(--el-text-color-secondary, #909399);
}

.legal-body {
  max-width: 760px;
  margin: 0 auto;
  padding: 24px;
  border-radius: 4px;
  background: var(--el-bg-color, #fff);
  border: 1px solid var(--el-border-color-lighter, #ebeef5);
  line-height: 1.7;
  font-size: 15px;

  :deep(h1),
  :deep(h2),
  :deep(h3) {
    margin-top: 1.5em;
    margin-bottom: 0.5em;
    line-height: 1.3;
  }

  :deep(p) {
    margin: 0 0 1em;
  }

  :deep(ul),
  :deep(ol) {
    margin: 0 0 1em;
    padding-left: 1.5em;
  }
}

.legal-error {
  max-width: 760px;
  margin: 0 auto;
  color: var(--el-color-danger, #f56c6c);
  font-size: 15px;
}

.legal-footer {
  max-width: 760px;
  margin: 24px auto 0;
}
</style>
