<template>
  <PhyDocLayout>
    <template #header>
      <PhyPageHeader :title="$t('help.title')">
        <template #actions>
          <button class="back-btn" type="button" @click="goBack">
            {{ $t("common.back") }}
          </button>
        </template>
      </PhyPageHeader>
    </template>

    <template #toc>
      <div class="toc-title">{{ $t("help.tableOfContents") }}</div>
      <nav class="toc-nav">
        <ul class="toc-list">
          <li
            v-for="item in tableOfContents"
            :key="item.id"
            class="toc-item"
            :class="{ active: activeSection === item.id }"
            @click="scrollToSection(item.id)"
          >
            <span class="toc-link">{{ item.title }}</span>
          </li>
        </ul>
      </nav>
    </template>

    <div ref="mainContentRef" class="help-article">
      <section
        v-for="section in helpSections"
        :id="section.id"
        :key="section.id"
        class="help-section"
      >
        <h1>{{ section.heading }}</h1>
        <MarkdownViewer :content="section.body" surface="document" />
      </section>
    </div>

    <template #footer>
      <Footer />
    </template>
  </PhyDocLayout>
</template>

<script setup lang="ts">
import { useRouter } from "vue-router";
import MarkdownViewer from "@/components/MarkdownViewer.vue";
import { PhyDocLayout, PhyPageHeader } from "@/components/shell";
import Footer from "@/components/Footer.vue";
import { computed, ref, onMounted, onUnmounted } from "vue";
import { useI18n } from "vue-i18n";
import { getToken } from "@/utils/auth";
import { ElMessage } from "element-plus";

const router = useRouter();
const { t } = useI18n();

// Go back to the previous page
const goBack = () => {
  try {
    // Check whether the token exists
    if (!getToken()) {
      ElMessage.warning(t("help.goBackTokenExpired"));
      router.replace("/login");
      return;
    }
    // Try to go back to the previous page
    router.back();
  } catch (error) {
    // Handle router navigation errors
    console.error("Failed to go back:", error);
    ElMessage.error(t("help.goBackFailed"));
    // If going back fails, navigate to the default page
    router.push("/");
  }
};

// Section anchors — the ids are DOM contracts consumed by the TOC scroll-spy
// (scrollToSection / handleScroll call getElementById on them), so they stay in
// code. Only the visible titles/prose come from i18n (help.toc.* / help.doc.*).
const SECTIONS = [
  "whatIs",
  "gettingStarted",
  "howItWorks",
  "resources",
  "limitations",
] as const;

const SECTION_IDS: Record<typeof SECTIONS[number], string> = {
  whatIs: "what-is-phytomni",
  gettingStarted: "getting-started",
  howItWorks: "how-it-works",
  resources: "resources",
  limitations: "limitations",
};

// Table of contents data structure
const tableOfContents = computed(() =>
  SECTIONS.map((key) => ({
    id: SECTION_IDS[key],
    title: t(`help.toc.${key}`),
    level: 1,
  }))
);

const helpSections = computed(() =>
  SECTIONS.map((key) => ({
    id: SECTION_IDS[key],
    heading: t(`help.doc.${key}.heading`),
    body: t(`help.doc.${key}.body`),
  }))
);

// Currently active table-of-contents item
const activeSection = ref(SECTION_IDS.whatIs);

// Reference to the main content area element
const mainContentRef = ref<HTMLElement | null>(null);

// Scroll root — PhyDocLayout body scrolls via the layout shell (App.vue locks document overflow).
const scrollContainerRef = ref<HTMLElement | null>(null);

function sectionTopInContainer(
  element: HTMLElement,
  container: HTMLElement
): number {
  return (
    element.getBoundingClientRect().top -
    container.getBoundingClientRect().top +
    container.scrollTop
  );
}

// Jump to a section when a TOC item is clicked
const scrollToSection = (sectionId: string) => {
  const container = scrollContainerRef.value;
  const element = document.getElementById(sectionId);
  if (element && container) {
    const elementTop = sectionTopInContainer(element, container) - 20;
    container.scrollTo({
      top: elementTop,
      behavior: "smooth",
    });
    activeSection.value = sectionId;
  }
};

// Listen for scroll events to update the currently active section
const handleScroll = () => {
  const container = scrollContainerRef.value;
  if (!container) return;

  const sections = tableOfContents.value.map((item) => item.id);
  const scrollPosition = container.scrollTop + 100;

  for (let i = sections.length - 1; i >= 0; i--) {
    const element = document.getElementById(sections[i]);
    if (
      element &&
      sectionTopInContainer(element, container) <= scrollPosition
    ) {
      activeSection.value = sections[i];
      break;
    }
  }
};

onMounted(() => {
  scrollContainerRef.value =
    (mainContentRef.value?.closest(".phy-doc-layout") as HTMLElement | null) ??
    mainContentRef.value;
  if (scrollContainerRef.value) {
    scrollContainerRef.value.addEventListener("scroll", handleScroll);
  }
  handleScroll();
});
onUnmounted(() => {
  if (scrollContainerRef.value) {
    scrollContainerRef.value.removeEventListener("scroll", handleScroll);
  }
});
</script>

<style scoped>
.back-btn {
  border: 1px solid var(--phy-color-border);
  background: var(--phy-color-bg-elevated);
  color: var(--phy-color-text);
  border-radius: var(--phy-radius-sm);
  padding: 6px 12px;
  cursor: pointer;
}
.back-btn:hover {
  border-color: var(--phy-color-primary);
  color: var(--phy-color-primary);
}
.toc-title {
  font-weight: 600;
  margin-bottom: 8px;
  color: var(--phy-color-text);
}
.toc-list {
  list-style: none;
  margin: 0;
  padding: 0;
}
.toc-item {
  padding: 6px 8px;
  border-radius: var(--phy-radius-sm);
  color: var(--phy-color-text-secondary);
  cursor: pointer;
}
.toc-item.active,
.toc-item:hover {
  background: var(--phy-color-primary-soft);
  color: var(--phy-color-primary);
}
.toc-link {
  display: block;
}
.help-article {
  /* Reading measure comes from .phy-reading on PhyDocLayout body */
}
.help-section + .help-section {
  margin-top: 48px;
}
.help-section > h1 {
  margin: 0 0 20px;
  font-family: var(--phy-font-shell);
  font-size: 1.6rem;
  line-height: 1.25;
  color: var(--phy-color-text);
}
</style>
