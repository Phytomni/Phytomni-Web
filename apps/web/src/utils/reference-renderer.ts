import { escapeHtml, sanitizeHref } from "@/utils/sanitize-markup";
import { formatDetailedCitation } from "@/utils/citation";

// 处理参考文献列表，生成格式化后的 HTML(从 DeepGenomeResultViewer 的
// displayReferences computed 原样抽出)。
//
// XSS 清洗不变量(v-html sink):references 来自 Bot `formatted.references`
// reshape,字段受 agent 输出 / RAG 语料影响,最终注入 v-html。所有 agent 文本
// 字段(title / citation au-so / dl 文本 / pm 文本 / 普通字符串 / JSON)一律
// escapeHtml;DOI / PubMed 的 href 一律经 sanitizeHref 做协议白名单校验。
export const buildDisplayReferences = (
  references: any[]
): Array<{ html: string; id: string }> => {
  if (!references || references.length === 0) {
    return [];
  }

  return references.map((doc, index) => {
    const refIndex = index + 1;

    if (doc.title) {
      return {
        html: `<div>${refIndex}. ${escapeHtml(String(doc.title))}</div>`,
        id: `ref-${refIndex}`,
      };
    } else if (doc.au || doc.ti) {
      const citation = formatDetailedCitation(doc);

      // 构建 DOI 和 PMID 链接部分
      let linkPart = "";
      const hasLink = doc.dl || doc.pm;

      if (hasLink) {
        const doiLink = doc.dl
          ? `doi:<a href="${sanitizeHref(
              String(doc.dl)
            )}" target="_blank" class="doi-link">${escapeHtml(
              String(doc.dl)
            )}</a>`
          : "";
        const pmidLink = doc.pm
          ? `pmid:<a href="${sanitizeHref(
              "https://pubmed.ncbi.nlm.nih.gov/" + String(doc.pm)
            )}" target="_blank" class="pmid-link">${escapeHtml(
              String(doc.pm)
            )}</a>`
          : "";

        const separator = doc.dl && doc.pm ? "; " : "";

        linkPart = `. <span class="doc-link-inline">${doiLink}</span><span>${separator}</span><span class="doc-link-inline">${pmidLink}</span>`;
      }

      return {
        // citation 是纯文本(au/so/卷页年),先转义;linkPart 是本组件生成的
        // 已消毒锚点(sanitizeHref + escapeHtml),保留原样不再转义。
        html: `<div class="doc-citation">${refIndex}. ${escapeHtml(
          citation
        )}${linkPart}</div>`,
        id: `ref-${refIndex}`,
      };
    } else {
      // 处理普通字符串类型的引用
      if (typeof doc === "string") {
        return {
          html: `<div>${refIndex}. ${escapeHtml(doc)}</div>`,
          id: `ref-${refIndex}`,
        };
      }

      // 默认情况
      return {
        html: `<div>${refIndex}. ${escapeHtml(JSON.stringify(doc))}</div>`,
        id: `ref-${refIndex}`,
      };
    }
  });
};
