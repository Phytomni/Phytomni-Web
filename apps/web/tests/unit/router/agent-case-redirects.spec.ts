import { describe, expect, it } from "vitest";
import router from "@/router";

describe("agent case redirects", () => {
  it("sends five legacy demo paths onto /cases and leaves live product paths in place", () => {
    const redirects: Array<[string, string]> = [
      ["/knowledge-agent", "/cases/knowledge-agent"],
      ["/data-agent", "/cases/data-agent"],
      ["/review-agent", "/cases/review-agent"],
      ["/brief-gene-agent", "/cases/brief-gene-agent"],
      ["/deep-genome-agent", "/cases/deep-genome-agent"],
    ];
    for (const [from, to] of redirects) {
      expect(router.resolve(from).matched.at(-1)?.redirect).toBe(to);
      expect(router.resolve(to).path).toBe(to);
    }
    const live = [
      "/analyst-agent",
      "/gene-network-agent",
      "/digital-design-agent",
      "/research-agent",
      "/design",
    ];
    for (const path of live) {
      expect(router.resolve(path).path).toBe(path);
    }
  });
});
