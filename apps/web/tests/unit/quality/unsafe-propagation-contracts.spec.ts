import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const source = (relativePath: string): string =>
  readFileSync(resolve(__dirname, "../../../src", relativePath), "utf8");

const rootSource = (relativePath: string): string =>
  readFileSync(resolve(__dirname, "../../..", relativePath), "utf8");

describe("unsafe propagation contracts", () => {
  it("keeps markdown and download regex callbacks typed", () => {
    const markdownViewer = source("components/MarkdownViewer.vue");
    const downloads = source("composables/useDeepGenomeDownloads.ts");

    expect(markdownViewer).toContain(
      "(_match: string, alt: string, src: string) => {"
    );
    expect(downloads).toContain(
      "(match: string, alt: string, src: string) => {"
    );
  });

  it("keeps sanitizer entity callbacks and text coercion explicit", () => {
    const sanitizer = source("utils/sanitize-markup.ts");

    expect(sanitizer).toContain("function decodeEntities(s: string): string {");
    expect(sanitizer).toContain("(m: string, hex: string) =>");
    expect(sanitizer).toContain("(m: string, dec: string) =>");
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
