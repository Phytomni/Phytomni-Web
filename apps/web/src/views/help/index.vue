<template>
  <div class="help-page">
    <div class="help-container">
      <!-- Page header -->
      <div class="help-header">
        <div class="header-content">
          <h1 class="help-title">{{ $t("help.title") }}</h1>
        </div>
        <div class="header-actions">
          <button class="back-btn" @click="goBack">
            <i class="icon-arrow-left"></i>
            {{ $t("common.back") }}
          </button>
        </div>
      </div>

      <!-- Help content -->
      <div class="help-content">
        <div class="content-layout">
          <!-- Sidebar table of contents -->
          <div class="toc-sidebar">
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
          </div>

          <!-- Main content area -->
          <div class="main-content" ref="mainContentRef">
            <MarkdownViewer :content="helpContent" />
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useRouter } from "vue-router";
import MarkdownViewer from "@/components/MarkdownViewer.vue";
import { ref, onMounted, onUnmounted } from "vue";
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

const SECTION_IDS: Record<(typeof SECTIONS)[number], string> = {
  whatIs: "what-is-phytomni",
  gettingStarted: "getting-started",
  howItWorks: "how-it-works",
  resources: "resources",
  limitations: "limitations",
};

// Table of contents data structure
const tableOfContents = ref(
  SECTIONS.map((key) => ({
    id: SECTION_IDS[key],
    title: t(`help.toc.${key}`),
    level: 1,
  })),
);

// Currently active table-of-contents item
const activeSection = ref(SECTION_IDS.whatIs);

// Reference to the main content area element
const mainContentRef = ref<HTMLElement | null>(null);

// Jump to a section when a TOC item is clicked
const scrollToSection = (sectionId: string) => {
  const element = document.getElementById(sectionId);
  if (element && mainContentRef.value) {
    // Compute the element's relative position within the main content area
    const elementTop = element.offsetTop - 20; // Add 20px top margin so the heading is not obscured
    // Scroll to the target position
    mainContentRef.value.scrollTo({
      top: elementTop,
      behavior: "smooth",
    });
    activeSection.value = sectionId;
  }
};

// Listen for scroll events to update the currently active section
const handleScroll = () => {
  if (!mainContentRef.value) return;

  const sections = tableOfContents.value.map((item) => item.id);
  const scrollPosition = mainContentRef.value.scrollTop + 100; // Use main-content's scroll position

  for (let i = sections.length - 1; i >= 0; i--) {
    const element = document.getElementById(sections[i]);
    if (element && element.offsetTop <= scrollPosition) {
      activeSection.value = sections[i];
      break;
    }
  }
};

onMounted(() => {
  // Bind to main-content's scroll event
  if (mainContentRef.value) {
    mainContentRef.value.addEventListener("scroll", handleScroll);
  }
  // Check the currently active section on initialization
  handleScroll();
});

onUnmounted(() => {
  // Unbind the scroll event
  if (mainContentRef.value) {
    mainContentRef.value.removeEventListener("scroll", handleScroll);
  }
});

// Markdown content — assembled from i18n so copy is localized/reviewable, while
// the section-anchor <div id> wrappers stay in code (DOM contract for the TOC
// scroll-spy). Each section closes its <h1> block before the markdown body so
// CommonMark resumes parsing (block HTML would otherwise suspend markdown).
const helpContent = SECTIONS.map((key) => {
  const id = SECTION_IDS[key];
  const heading = t(`help.doc.${key}.heading`);
  const body = t(`help.doc.${key}.body`);
  return `<div id="${id}"><h1>${heading}</h1></div>\n\n${body}`;
}).join("\n\n");
</script>

<style scoped>
.help-page {
  height: 100vh;
  padding: 20px;
  overflow: hidden; /* Remove the page-level scrollbar */
}

.help-container {
  max-width: 1200px;
  margin: 0 auto;
  background: white;
  border-radius: 16px;
  box-shadow: 0 20px 40px rgba(0, 0, 0, 0.1);
}

.help-header {
  background: linear-gradient(
    135deg,
    var(--phy-color-primary) 0%,
    var(--phy-color-primary-hover) 100%
  );
  color: white;
  padding: 40px;
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.header-content h1 {
  font-size: 2.5rem;
  font-weight: 700;
  margin: 0 0 10px 0;
}

.header-content p {
  font-size: 1.1rem;
  opacity: 0.9;
  margin: 0;
}

.back-btn {
  background: rgba(255, 255, 255, 0.2);
  border: 1px solid rgba(255, 255, 255, 0.3);
  color: white;
  padding: 12px 24px;
  border-radius: 8px;
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 8px;
  transition: all 0.3s ease;
}

.back-btn:hover {
  background: rgba(255, 255, 255, 0.3);
  transform: translateY(-2px);
}

.help-content {
  padding: 40px;
}

/* Content layout */
.content-layout {
  display: flex;
  gap: 40px;
  max-width: 1400px;
  margin: 0 auto;
  padding-left: 320px; /* Leave space for the fixed table of contents */
}

/* Sidebar table-of-contents styling */
.toc-sidebar {
  width: 280px;
  flex-shrink: 0;
  position: fixed;
  top: 185px;
  left: 100px;
  height: fit-content;
  z-index: 100;
}

.toc-title {
  font-size: 1.1rem;
  font-weight: 600;
  color: #1f2937;
  margin-bottom: 20px;
  padding-bottom: 10px;
  border-bottom: 1px solid #e5e7eb;
}

.toc-nav {
  background: #f8fafc;
  border-radius: 8px;
  padding: 20px;
}

.toc-list {
  list-style: none;
  margin: 0;
  padding: 0;
}

.toc-item {
  margin-bottom: 8px;
  position: relative;
}

.toc-item:last-child {
  margin-bottom: 0;
}

.toc-link {
  display: block;
  padding: 12px 16px;
  color: #6b7280;
  text-decoration: none;
  border-radius: 6px;
  cursor: pointer;
  transition: all 0.2s ease;
  font-size: 0.95rem;
  line-height: 1.4;
}

.toc-item:hover .toc-link {
  color: #374151;
  background: #e5e7eb;
}

.toc-item.active {
  position: relative;
}

.toc-item.active::before {
  content: "";
  position: absolute;
  left: -20px;
  top: 0;
  bottom: 0;
  width: 3px;
  background: #3b82f6;
  border-radius: 2px;
}

.toc-item.active .toc-link {
  color: #1f2937;
  font-weight: 600;
  background: #dbeafe;
}

/* Main content area */
.main-content {
  flex: 1;
  min-width: 0;
  overflow-y: auto; /* Let the main content area scroll independently */
  margin-left: 0; /* Remove the left margin, since the TOC is now inside help-container */
  padding-right: 15px; /* Increase right padding so the scrollbar does not obscure content */
}

.help-section {
  margin-bottom: 60px;
}

.section-title {
  font-size: 2rem;
  font-weight: 600;
  color: #1f2937;
  margin-bottom: 30px;
  position: relative;
  padding-bottom: 15px;
}

.section-title::after {
  content: "";
  position: absolute;
  bottom: 0;
  left: 0;
  width: 60px;
  height: 4px;
  background: linear-gradient(
    135deg,
    var(--phy-color-primary),
    var(--phy-color-primary-hover)
  );
  border-radius: 2px;
}

/* Getting-started styling */
.step-list {
  display: flex;
  flex-direction: column;
  gap: 30px;
}

.step-item {
  display: flex;
  align-items: flex-start;
  gap: 20px;
  padding: 30px;
  background: #f8fafc;
  border-radius: 12px;
  border-left: 4px solid var(--phy-color-primary);
}

.step-number {
  background: linear-gradient(
    135deg,
    var(--phy-color-primary),
    var(--phy-color-primary-hover)
  );
  color: white;
  width: 40px;
  height: 40px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: 600;
  flex-shrink: 0;
}

.step-content h3 {
  font-size: 1.3rem;
  font-weight: 600;
  color: #1f2937;
  margin: 0 0 10px 0;
}

.step-content p {
  color: #6b7280;
  line-height: 1.6;
  margin: 0;
}

/* Feature introduction styling */
.feature-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(350px, 1fr));
  gap: 30px;
}

.feature-card {
  background: white;
  border: 1px solid #e5e7eb;
  border-radius: 12px;
  padding: 30px;
  transition: all 0.3s ease;
}

.feature-card:hover {
  transform: translateY(-5px);
  box-shadow: 0 10px 25px rgba(0, 0, 0, 0.1);
  border-color: var(--phy-color-primary);
}

.feature-icon {
  width: 60px;
  height: 60px;
  background: linear-gradient(
    135deg,
    var(--phy-color-primary),
    var(--phy-color-primary-hover)
  );
  border-radius: 12px;
  display: flex;
  align-items: center;
  justify-content: center;
  margin-bottom: 20px;
}

.feature-icon i {
  font-size: 24px;
  color: white;
}

.feature-card h3 {
  font-size: 1.3rem;
  font-weight: 600;
  color: #1f2937;
  margin: 0 0 15px 0;
}

.feature-card p {
  color: #6b7280;
  line-height: 1.6;
  margin-bottom: 20px;
}

.feature-list {
  list-style: none;
  padding: 0;
  margin: 0;
}

.feature-list li {
  padding: 8px 0;
  color: #4b5563;
  position: relative;
  padding-left: 20px;
}

.feature-list li::before {
  content: "✓";
  position: absolute;
  left: 0;
  color: #10b981;
  font-weight: bold;
}

/* Dark mode adaptation */
.theme-dark .help-page {
  background-color: var(--color-background) !important;
  overflow: hidden;
  height: 100vh; /* Ensure the height is also set correctly in dark mode */
}

/* Ensure the body has no scrollbar in dark mode either */
.theme-dark body {
  overflow: hidden;
}

/* Main content area in dark mode */
.theme-dark .main-content {
  margin-left: 0; /* Remove the left margin, since the TOC is now inside help-container */
  overflow-y: auto; /* Ensure the main content can also scroll independently in dark mode */
  padding-right: 15px; /* Increase right padding so the scrollbar does not obscure content */
}

.theme-dark .help-container {
  background: var(--color-background) !important;
  box-shadow: 0 20px 40px rgba(0, 0, 0, 0.3) !important;
}

.theme-dark .help-header {
  background: linear-gradient(
    135deg,
    var(--phy-color-primary) 0%,
    var(--phy-color-primary-hover) 100%
  ) !important;
}

.theme-dark .toc-sidebar {
  background: var(--color-background-card) !important;
}

.theme-dark .toc-title {
  color: var(--el-text-color-primary) !important;
  border-bottom-color: var(--el-border-color) !important;
}

.theme-dark .toc-nav {
  background: var(--color-background-card) !important;
}

.theme-dark .toc-link {
  color: var(--el-text-color-regular) !important;
}

.theme-dark .toc-item:hover .toc-link {
  color: var(--el-text-color-primary) !important;
  background: var(--el-fill-color-light) !important;
}

.theme-dark .toc-item.active .toc-link {
  color: var(--el-color-primary) !important;
  background: var(--el-color-primary-light-9) !important;
}

.theme-dark .toc-item.active::before {
  background: var(--el-color-primary) !important;
}

.theme-dark .section-title {
  color: var(--el-text-color-primary) !important;
}

.theme-dark .section-title::after {
  background: linear-gradient(
    135deg,
    var(--phy-color-primary),
    var(--phy-color-primary-hover)
  ) !important;
}

.theme-dark .step-item {
  background: var(--color-background) !important;
  border-left-color: var(--el-color-primary) !important;
}

.theme-dark .step-content h3 {
  color: var(--el-text-color-primary) !important;
}

.theme-dark .step-content p {
  color: var(--el-text-color-regular) !important;
}

.theme-dark .feature-card {
  background: var(--color-background-card) !important;
  border-color: var(--el-border-color) !important;
}

.theme-dark .feature-card:hover {
  border-color: var(--el-color-primary) !important;
  box-shadow: 0 10px 25px rgba(0, 0, 0, 0.2) !important;
}

.theme-dark .feature-card h3 {
  color: var(--el-text-color-primary) !important;
}

.theme-dark .feature-card p {
  color: var(--el-text-color-regular) !important;
}

.theme-dark .feature-list li {
  color: var(--el-text-color-regular) !important;
}

.theme-dark .feature-list li::before {
  color: var(--el-color-success) !important;
}

/* Responsive design */
@media (max-width: 1024px) {
  .content-layout {
    flex-direction: column;
    gap: 30px;
    padding-left: 0; /* Remove the left padding */
  }

  .toc-sidebar {
    width: 100%;
    position: static;
    order: 2;
    top: auto;
    left: auto;
  }

  .main-content {
    order: 1;
    overflow-y: visible;
    padding-right: 0;
    height: auto;
  }

  .theme-dark .main-content {
    overflow-y: visible;
    padding-right: 0;
  }
}

@media (max-width: 768px) {
  .help-page {
    padding: 10px;
  }

  .help-header {
    padding: 30px 20px;
    flex-direction: column;
    gap: 20px;
    text-align: center;
  }

  .header-content h1 {
    font-size: 2rem;
  }

  .help-content {
    padding: 20px;
  }

  .content-layout {
    gap: 20px;
  }

  .toc-sidebar {
    width: 100%;
  }

  .toc-nav {
    padding: 15px;
  }

  .toc-link {
    padding: 10px 12px;
    font-size: 0.9rem;
  }
}
</style>
