<template>
  <div ref="scrollContainerRef" class="help-page" data-scroll-root="help">
    <PhyDocLayout>
      <template #header>
        <PhyPageHeader :title="$t('help.title')">
          <template #actions>
            <div class="help-header-actions">
              <LangSwitch />
              <button class="back-btn" type="button" @click="goBack">
                {{ $t("common.back") }}
              </button>
            </div>
          </template>
        </PhyPageHeader>
      </template>

      <template #toc>
        <div class="toc-title">{{ $t("help.tableOfContents") }}</div>
        <nav class="toc-nav" :aria-label="$t('help.tableOfContents')">
          <ul class="toc-list">
            <li
              v-for="item in tableOfContents"
              :key="item.id"
              class="toc-item"
              :class="{ active: activeSection === item.id }"
            >
              <button
                class="toc-link"
                :class="{ active: activeSection === item.id }"
                :data-section-id="item.id"
                type="button"
                :aria-current="
                  activeSection === item.id ? 'location' : undefined
                "
                @click="scrollToSection(item.id)"
                @keydown.enter.prevent="scrollToSection(item.id)"
                @keydown.space.prevent="scrollToSection(item.id)"
              >
                {{ item.title }}
              </button>
            </li>
          </ul>
        </nav>
      </template>

      <article ref="mainContentRef" class="help-article">
        <section
          v-for="section in helpContent"
          :id="section.id"
          :key="section.id"
          class="help-section"
        >
          <h1 tabindex="-1">{{ section.heading }}</h1>
          <MarkdownViewer :content="section.body" surface="document" />
        </section>
      </article>

      <template #footer>
        <Footer class="help-footer" />
      </template>
    </PhyDocLayout>
  </div>
</template>

<script setup lang="ts">
import { useRouter } from "vue-router";
import MarkdownViewer from "@/components/MarkdownViewer.vue";
import { PhyDocLayout, PhyPageHeader } from "@/components/shell";
import Footer from "@/components/AppFooter.vue";
import LangSwitch from "@/components/LangSwitch.vue";
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
      Promise.resolve(router.replace("/login")).catch(() => undefined);
      return;
    }
    // Try to go back to the previous page
    router.back();
  } catch (error) {
    // Handle router navigation errors
    console.error("Failed to go back:", error);
    ElMessage.error(t("help.goBackFailed"));
    // If going back fails, navigate to the default page
    Promise.resolve(router.push("/")).catch(() => undefined);
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

const SECTION_IDS: Record<(typeof SECTIONS)[number], string> = {
  whatIs: "what-is-phytomni",
  gettingStarted: "getting-started",
  howItWorks: "how-it-works",
  resources: "resources",
  limitations: "limitations",
};

// Table of contents data structure. Both the labels and document bodies are
// computed so an in-place locale change updates the mounted document.
const tableOfContents = computed(() =>
  SECTIONS.map((key) => ({
    id: SECTION_IDS[key],
    title: t(`help.toc.${key}`),
    level: 1,
  }))
);

const helpContent = computed(() =>
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

// Help owns the only scroll root. App.vue locks document overflow for the SPA.
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
    if (typeof container.scrollTo === "function") {
      container.scrollTo({
        top: elementTop,
        behavior: "smooth",
      });
    } else {
      container.scrollTop = elementTop;
    }
    activeSection.value = sectionId;

    // Keep keyboard users oriented after the smooth-scroll request. The
    // heading is deliberately removed from the normal tab order in the
    // template, so this focus does not add another tab stop.
    const heading = element.querySelector("h1") as HTMLElement | null;
    if (heading) {
      try {
        heading.focus({ preventScroll: true });
      } catch {
        heading.focus();
      }
    }
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
.help-page {
  box-sizing: border-box;
  height: 100%;
  min-height: 100dvh;
  overflow-y: auto;
  padding-bottom: calc(var(--phy-space-64) + var(--phy-space-24));
  background: var(--phy-color-bg-page);
  color: var(--phy-color-text);
  overscroll-behavior-y: contain;
  scrollbar-gutter: stable;
}

.back-btn {
  border: 1px solid var(--phy-color-border);
  background: var(--phy-color-bg-elevated);
  color: var(--phy-color-text);
  border-radius: var(--phy-radius-sm);
  padding: 6px 12px;
  cursor: pointer;
}
.help-header-actions {
  display: flex;
  align-items: center;
  gap: var(--phy-space-8);
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
  margin: 0;
  padding: 0;
  border-radius: var(--phy-radius-sm);
}
.toc-item.active,
.toc-item:hover {
  background: var(--phy-color-primary-soft);
}
.toc-link {
  display: block;
  width: 100%;
  border: 0;
  border-radius: var(--phy-radius-sm);
  padding: 6px 8px;
  background: transparent;
  color: var(--phy-color-text-secondary);
  font: inherit;
  line-height: 1.4;
  text-align: left;
  cursor: pointer;
}
.toc-link.active,
.toc-link:hover {
  background: var(--phy-color-primary-soft);
  color: var(--phy-color-primary);
}
.toc-link:focus-visible,
.back-btn:focus-visible,
.help-section > h1:focus-visible {
  outline: 2px solid var(--phy-color-focus);
  outline-offset: 2px;
}
.help-article {
  min-width: 0;
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

.help-footer {
  display: block;
}

@media (max-width: 900px) {
  .help-page :deep(.phy-doc-layout__content) {
    padding-top: 20px;
  }
}
</style>
