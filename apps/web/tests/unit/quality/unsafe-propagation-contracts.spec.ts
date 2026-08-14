import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const source = (relativePath: string): string =>
  readFileSync(resolve(__dirname, "../../../src", relativePath), "utf8");

const rootSource = (relativePath: string): string =>
  readFileSync(resolve(__dirname, "../../..", relativePath), "utf8");

describe("unsafe propagation contracts", () => {
  it("keeps report content on the single scientific renderer", () => {
    const reportContent = [
      source("components/CitedAnswer.vue"),
      source("components/research/DeepGenomeArtifact.vue"),
      source("components/research/BotReportState.vue"),
      source("views/chat/components/ChatMessageContent.vue"),
      source("views/chat/components/StreamMessage.vue"),
    ].join("\n");
    const scientificMarkdown = source("components/ScientificMarkdown.vue");

    expect(reportContent).not.toMatch(/v-html\s*=/);
    expect(reportContent).not.toContain("processInlineMarkdown");
    expect(reportContent).not.toContain("renderStreamingMarkdown");
    expect(reportContent).not.toContain("parseDeepGenomeMarkdown");
    expect(reportContent).not.toContain("linkifyCitations");
    expect(scientificMarkdown).toContain(':allow-html="false"');
    expect(scientificMarkdown).toContain(':sanitize="true"');
  });

  it("keeps scientific Markdown and download boundaries typed", () => {
    const scientificMarkdown = source("components/ScientificMarkdown.vue");
    const downloads = source("composables/useDeepGenomeDownloads.ts");

    expect(scientificMarkdown).toContain(
      "function safeAnchorHref(href: string)"
    );
    expect(downloads).toContain("const downloadMarkdown = () => {");
    expect(downloads).toContain("saveAs(blob, filename);");
  });

  it("keeps sanitizer entity callbacks and text coercion explicit", () => {
    const sanitizer = source("utils/sanitize-markup.ts");

    expect(sanitizer).toContain(
      "function decodeEntities(value: string): string {"
    );
    expect(sanitizer).toContain(
      ".replace(/&#x([0-9a-f]+);?/gi, (match: string, hex: string) =>"
    );
    expect(sanitizer).toContain(
      ".replace(/&#(\\d+);?/g, (match: string, dec: string) =>"
    );
    expect(sanitizer).toContain(
      "export function escapeHtml(text: unknown): string {"
    );
  });

  it("keeps object-entry and array-spread boundaries typed as unknown", () => {
    const utils = source("utils/index.ts");
    const projection = source("views/chat/botProjection.ts");
    const remoteAgentHistory = source(
      "views/chat/composables/remoteAgentHistory.ts"
    );

    expect(utils).toContain(
      "function entriesOf(value: object): Array<[string, unknown]>"
    );
    expect(utils).not.toContain("Object.entries(value)");
    expect(projection).toContain(
      "function isUnknownArray(value: unknown): value is readonly unknown[]"
    );
    expect(remoteAgentHistory).toContain(
      "function isUnknownArray(value: unknown): value is readonly unknown[]"
    );

    const env = rootSource("env.d.ts");
    expect(env).toContain('declare module "file-saver" {');
    expect(env).toContain("data: Blob | string,");
    expect(env).not.toMatch(/declare module "file-saver";\s*$/m);
  });

  it("keeps the axios response interceptor payload unknown until decoding", () => {
    const request = source("utils/request.ts");

    expect(request).toContain(
      "const responseInterceptors = service.interceptors"
    );
    expect(request).toContain("UnwrappedResponseInterceptorManager;");
    expect(request).toContain("(res: AxiosResponse<unknown>) => {");
  });
});
