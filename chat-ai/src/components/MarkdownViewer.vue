<template>
  <div class="markdown-viewer">
    <!-- 当需要打字效果时使用 Typewriter 组件 -->
    <Typewriter 
      v-if="instantMessage"
      :typing="{
        step: 10,
        interval: 20
      }" 
      :content="content"
      :is-markdown="true"
      @finish="handleFinish" 
    />
    <!-- 当不需要打字效果时直接渲染 markdown 内容 -->
    <div v-else class="markdown-content" v-html="renderedContent"></div>
  </div>
</template>

<script setup lang="ts">
import { Typewriter } from 'vue-element-plus-x'
import { computed } from 'vue'

const props = defineProps<{
  content: string,
  instantMessage?: boolean
}>()

const emit = defineEmits<{
  finish: []
}>()

// 当不需要打字效果时，直接渲染内容
const renderedContent = computed(() => {
  if (!props.instantMessage) {
    // 更完整的 markdown 渲染
    let content = props.content
      // 代码块
      .replace(/```([\s\S]*?)```/g, '<pre><code>$1</code></pre>')
      // 行内代码
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      // 粗体
      .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
      // 斜体
      .replace(/\*(.*?)\*/g, '<em>$1</em>')
      // 标题
      .replace(/^### (.*$)/gim, '<h3>$1</h3>')
      .replace(/^## (.*$)/gim, '<h2>$1</h2>')
      .replace(/^# (.*$)/gim, '<h1>$1</h1>')
      // 图片
      .replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (match, alt, src) => {
        console.log('渲染图片:', { match, alt, src });
        return `<img src="${src}" alt="${alt}" style="max-width: 50%; height: auto; border-radius: 4px; margin: 8px 0;" />`;
      })
      // 链接
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank">$1</a>')
      // 列表
      .replace(/^\* (.*$)/gim, '<li>$1</li>')
      .replace(/^- (.*$)/gim, '<li>$1</li>')
      // 换行
      .replace(/\n/g, '<br>')
    
    // 处理列表
    content = content.replace(/(<li>.*<\/li>)/gs, '<ul>$1</ul>')
    
    // 处理段落中的图片（确保图片前后有适当的间距）
    content = content.replace(/(<img[^>]*>)/g, '<p style="text-align: center; margin: 16px 0;">$1</p>')
    
    return content
  }
  return ''
})

const handleFinish = () => {
  emit('finish')
}
</script>

<style lang="scss">
.markdown-viewer {
  all: initial;
  * {
    all: revert;
  }

  .markdown-content {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Noto Sans', Helvetica, Arial, sans-serif;
    font-size: 14px;
    line-height: 1.5;
    word-wrap: break-word;
    color: #1f2328;
    background-color: transparent;
    
    h1, h2, h3, h4, h5, h6 {
      margin: 16px 0 8px;
      line-height: 1.25;
      font-weight: 600;
    }
    
    h1 { font-size: 1.5em; }
    h2 { font-size: 1.3em; }
    h3 { font-size: 1.1em; }
    
    p {
      margin: 8px 0;
      line-height: 1.6;
    }
    
    ul, ol {
      padding-left: 2em;
      margin: 8px 0;
    }
    
    li {
      margin: 4px 0;
    }
    
    pre {
      background-color: #f8f9fa;
      margin: 12px 0;
      padding: 12px;
      border-radius: 4px;
      overflow-x: auto;
    }
    
    code {
      background-color: rgba(175, 184, 193, 0.2);
      padding: 0.2em 0.4em;
      border-radius: 4px;
      font-family: ui-monospace, SFMono-Regular, SF Mono, Menlo, Consolas, Liberation Mono, monospace;
    }
    
    pre code {
      background-color: transparent;
      padding: 0;
    }
    
    a {
      color: #0969da;
      text-decoration: none;
      
      &:hover {
        text-decoration: underline;
      }
    }
    
    blockquote {
      color: #57606a;
      border-left: 0.25em solid #d0d7de;
      padding: 0 1em;
      margin: 12px 0;
    }
  }

  .markdown-body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Noto Sans', Helvetica, Arial, sans-serif;
    font-size: 14px;
    line-height: 1.5;
    word-wrap: break-word;
    color: #1f2328;
    background-color: transparent;

    pre {
      background-color: #f8f9fa;
      margin: 12px 0;
      padding: 12px;
      border-radius: 4px;
      overflow-x: auto;
    }

    code {
      background-color: rgba(175, 184, 193, 0.2);
      padding: 0.2em 0.4em;
      border-radius: 4px;
      font-family: ui-monospace, SFMono-Regular, SF Mono, Menlo, Consolas, Liberation Mono, monospace;
    }

    table {
      border-collapse: collapse;
      margin: 12px 0;
      width: 100%;
      
      th, td {
        border: 1px solid #d0d7de;
        padding: 6px 13px;
      }
      
      tr:nth-child(2n) {
        background-color: #f6f8fa;
      }
    }

    p {
      margin: 8px 0;
      line-height: 1.6;
    }

    ul, ol {
      padding-left: 2em;
      margin: 8px 0;
    }

    blockquote {
      color: #57606a;
      border-left: 0.25em solid #d0d7de;
      padding: 0 1em;
      margin: 12px 0;
    }

    h1, h2, h3, h4, h5, h6 {
      margin: 16px 0 8px;
      line-height: 1.25;
      font-weight: 600;
    }

    img {
      max-width: 100%;
      border-radius: 4px;
    }

    hr {
      height: 0.25em;
      padding: 0;
      margin: 24px 0;
      // background-color: #d0d7de;
      border: 0;
    }

    a {
      color: #0969da;
      text-decoration: none;
      
      &:hover {
        text-decoration: underline;
      }
    }
  }
}
</style> 