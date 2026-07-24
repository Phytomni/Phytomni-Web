<template>
  <div
    :class="[
      'markdown-viewer',
      'phy-markdown',
      `phy-markdown--${surface}`,
      surface === 'legacy' ? 'phy-reading' : null,
    ]"
  >
    <!-- Use the Typewriter component when the typing effect is needed -->
    <Typewriter
      v-if="instantMessage"
      :typing="{
        step: 10,
        interval: 20,
      }"
      :content="content"
      :is-markdown="true"
      @finish="handleFinish"
    />
    <!-- Render the markdown directly when no typing effect is needed -->
    <div v-else class="markdown-content" v-html="renderedContent"></div>
  </div>
</template>

<script setup lang="ts">
import { Typewriter } from "vue-element-plus-x";
import { computed } from "vue";
import { escapeHtml, sanitizeEscapedHref } from "@/utils/sanitize-markup";
import { linkifyCitations } from "@/utils/linkify-citations";

export type MarkdownSurface = "legacy" | "chat" | "artifact" | "document";

const props = withDefaults(
  defineProps<{
    content: string;
    instantMessage?: boolean;
    ns?: string;
    /** Visual skin; legacy is unchanged. Chat gets the transcript skin. */
    surface?: MarkdownSurface;
  }>(),
  { surface: "legacy" }
);

const emit = defineEmits<{
  finish: [];
}>();

// Render content directly when no typing effect is needed
const renderedContent = computed(() => {
  if (!props.instantMessage) {
    // First HTML-escape the entire body, then run the markdown regexes: after
    // escaping, any bare tag in the body becomes an entity, and only the structural
    // tags we generate below are real HTML. This component renders agent content
    // (relayed via Bot) injected through v-html, so it must be sanitized first (the
    // typing state goes through Typewriter+DOMPurify, handled separately).
    let content = escapeHtml(props.content)
      // code blocks
      .replace(/```([\s\S]*?)```/g, "<pre><code>$1</code></pre>")
      // inline code
      .replace(/`([^`]+)`/g, "<code>$1</code>")
      // bold
      .replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>")
      // italics
      .replace(/\*(.*?)\*/g, "<em>$1</em>")
      // headings
      .replace(/^### (.*$)/gim, "<h3>$1</h3>")
      .replace(/^## (.*$)/gim, "<h2>$1</h2>")
      .replace(/^# (.*$)/gim, "<h1>$1</h1>")
      // images (src goes through the scheme allow-list; alt is escaped along with the whole body)
      .replace(
        /!\[([^\]]*)\]\(([^)]+)\)/g,
        (_match: string, alt: string, src: string) => {
          return `<img src="${sanitizeEscapedHref(
            src
          )}" alt="${alt}" style="max-width: 50%; height: auto; border-radius: 4px; margin: 8px 0;" />`;
        }
      )
      // links (href goes through the scheme allow-list; link text is escaped along with the whole body)
      .replace(
        /\[([^\]]+)\]\(([^)]+)\)/g,
        (_match: string, text: string, href: string) => {
          return `<a href="${sanitizeEscapedHref(
            href
          )}" target="_blank">${text}</a>`;
        }
      )
      // lists
      .replace(/^\* (.*$)/gim, "<li>$1</li>")
      .replace(/^- (.*$)/gim, "<li>$1</li>")
      // line breaks
      .replace(/\n/g, "<br>");

    // handle lists
    content = content.replace(/(<li>.*<\/li>)/gs, "<ul>$1</ul>");

    // handle images within paragraphs (ensure proper spacing around images)
    content = content.replace(
      /(<img[^>]*>)/g,
      '<p style="text-align: center; margin: 16px 0;">$1</p>'
    );

    // citation markers: [N] / [N,M] -> anchors into the ref-N reference rows. Runs last (after the
    // markdown link regex and after escapeHtml) so a real [1](url) stays a link and smuggled tags
    // are already inert. See @/utils/linkify-citations for the XSS rationale.
    content = linkifyCitations(content, props.ns);

    return content;
  }
  return "";
});

const handleFinish = () => {
  emit("finish");
};
</script>

<style lang="scss">
/* Legacy surface keeps the historical reset + typography. Chat/artifact/document
   skins live in styles/markdown.css and must not fight these nested selectors. */
.markdown-viewer.phy-markdown--legacy {
  all: initial;
  display: block;
  min-width: 0;
  max-width: 100%;
  overflow-wrap: anywhere;

  &.phy-reading {
    font-family: var(--phy-font-reading);
    font-size: 17px;
    line-height: 1.7;
    color: var(--phy-color-text);
    max-width: var(--phy-layout-reading-max-width);
  }

  * {
    all: revert;
  }

  .markdown-content {
    font-family: inherit;
    font-size: inherit;
    line-height: inherit;
    word-wrap: break-word;
    overflow-wrap: anywhere;
    color: #1f2328;
    background-color: transparent;

    h1,
    h2,
    h3,
    h4,
    h5,
    h6 {
      margin: 16px 0 8px;
      line-height: 1.25;
      font-weight: 600;
      color: var(--el-text-color-primary);
    }

    h1 {
      font-size: 1.5em;
    }
    h2 {
      font-size: 1.3em;
    }
    h3 {
      font-size: 1.1em;
    }

    p {
      margin: 8px 0;
      line-height: 1.6;
    }

    ul,
    ol {
      padding-left: 2em;
      margin: 8px 0;
    }

    li {
      margin: 4px 0;
    }

    pre {
      max-width: 100%;
      background-color: var(--el-fill-color-light);
      margin: 12px 0;
      padding: 12px;
      border-radius: 4px;
      overflow-x: auto;
    }

    code {
      background-color: var(--el-fill-color);
      padding: 0.2em 0.4em;
      border-radius: 4px;
      font-family: ui-monospace, SFMono-Regular, SF Mono, Menlo, Consolas,
        Liberation Mono, monospace;
      overflow-wrap: anywhere;
    }

    pre code {
      background-color: transparent;
      padding: 0;
      overflow-wrap: normal;
    }

    a {
      color: var(--el-color-primary);
      text-decoration: none;

      &:hover {
        text-decoration: underline;
      }
    }

    blockquote {
      color: var(--el-text-color-secondary);
      border-left: 0.25em solid var(--el-border-color);
      padding: 0 1em;
      margin: 12px 0;
    }

    table {
      display: block;
      border-collapse: collapse;
      max-width: 100%;
      margin: 12px 0;
      overflow-x: auto;
      width: 100%;

      th,
      td {
        border: 1px solid var(--el-border-color);
        padding: 6px 13px;
        text-align: left;
        color: var(--el-text-color-primary);
      }

      th {
        font-weight: 600;
        background-color: var(--el-fill-color-light);
      }

      tr:nth-child(2n) {
        background-color: var(--el-fill-color-lighter);
      }
    }
  }

  .markdown-body {
    font-family: inherit;
    font-size: inherit;
    line-height: inherit;
    word-wrap: break-word;
    overflow-wrap: anywhere;
    color: var(--el-text-color-primary);
    background-color: transparent;

    pre {
      max-width: 100%;
      background-color: var(--el-fill-color-light);
      margin: 12px 0;
      padding: 12px;
      border-radius: 4px;
      overflow-x: auto;
    }

    code {
      background-color: var(--el-fill-color);
      padding: 0.2em 0.4em;
      border-radius: 4px;
      font-family: ui-monospace, SFMono-Regular, SF Mono, Menlo, Consolas,
        Liberation Mono, monospace;
      overflow-wrap: anywhere;
    }

    table {
      display: block;
      border-collapse: collapse;
      max-width: 100%;
      margin: 12px 0;
      overflow-x: auto;
      width: 100%;

      th,
      td {
        border: 1px solid var(--el-border-color);
        padding: 6px 13px;
        color: var(--el-text-color-primary);
      }

      tr:nth-child(2n) {
        background-color: var(--el-fill-color-lighter);
      }
    }

    p {
      margin: 8px 0;
      line-height: 1.6;
    }

    ul,
    ol {
      padding-left: 2em;
      margin: 8px 0;
    }

    blockquote {
      color: var(--el-text-color-secondary);
      border-left: 0.25em solid var(--el-border-color);
      padding: 0 1em;
      margin: 12px 0;
    }

    h1,
    h2,
    h3,
    h4,
    h5,
    h6 {
      margin: 16px 0 8px;
      line-height: 1.25;
      font-weight: 600;
      color: var(--el-text-color-primary);
    }

    img {
      max-width: 100%;
      border-radius: 4px;
    }

    hr {
      height: 0.25em;
      padding: 0;
      margin: 24px 0;
      border: 0;
    }

    a {
      color: var(--el-color-primary);
      text-decoration: none;

      &:hover {
        text-decoration: underline;
      }
    }
  }
}
.cif-container {
  width: 100%;
  height: 600px; // fixed height, or use min-height
  min-height: 300px;
  position: relative;
  background: var(--el-fill-color-light);
  border-radius: 8px;
  overflow: hidden;
}
</style>
