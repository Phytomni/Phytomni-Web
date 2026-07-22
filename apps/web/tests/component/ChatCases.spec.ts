import { defineComponent } from "vue";
import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import { createI18n } from "vue-i18n";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import ChatCases from "@/views/chat/components/ChatCases.vue";
import enUS from "@/locales/langs/en-US";
import zhCN from "@/locales/langs/zh-CN";

const CASES_SOURCE = readFileSync(
  resolve(__dirname, "../../src/views/chat/components/ChatCases.vue"),
  "utf8"
);

const routes = [
  "/knowledge-agent",
  "/data-agent",
  "/analyst-agent",
  "/cases/gene-network-agent",
  "/brief-gene-agent",
  "/deep-genome-agent",
  "/cases/digital-design-agent",
];

const enTitles = [
  "Knowledge Agent",
  "Data Agent",
  "Analyst Agent",
  "Gene Network Agent",
  "Brief Gene Agent",
  "Deep Genome Agent",
  "Digital Design Agent",
];

const zhTitles = [
  "知识智能体",
  "数据智能体",
  "分析智能体",
  "基因网络智能体",
  "基因综述智能体",
  "基因深度分析智能体",
  "智能设计智能体",
];

const imagePaths = [
  "/agent-icons/KnowledgeAgent.jpg",
  "/agent-icons/DataAgent.jpg",
  "/agent-icons/AnalystAgent.jpg",
  "/agent-icons/GeneNetworkAgent.jpg",
  "/agent-icons/BriefReviewAgent.jpg",
  "/agent-icons/DeepGenomeAgent.jpg",
  "/agent-icons/DigitalDesignAgent.jpg",
];

const imageHashes: Record<string, string> = {
  "KnowledgeAgent.jpg":
    "fc22a9909241b0cae6bc1a9f4a7f6bac15d1418e87e07adf789e9f3125cb9572",
  "DataAgent.jpg":
    "eb0ff77210d5ec26b812828ad941aaa2eb4fa5488d31326d9c8b938323796fb9",
  "AnalystAgent.jpg":
    "09e79c24fb971d5cdbc42d4cbaf166a68e47f830816d9f94f8bd5cd1717405af",
  "GeneNetworkAgent.jpg":
    "79a18a4289d7465ae4893d2f9fd1bc44df4e95c1577915f7783c875339054494",
  "BriefReviewAgent.jpg":
    "229c13bf7ae44161f04de82d32f5cb8ea4b732ca95618aff87fa05abe0712e22",
  "DeepGenomeAgent.jpg":
    "30b512140fa63dd5817ffd4f18730f1e7201b541b5124ee7f81d56c2b1323dc7",
  "DigitalDesignAgent.jpg":
    "0c4252a8a654e71a93ba26c594bec345aa6c5c674b4b0d382d12dd76fa8e5dd0",
};

const RouterLinkStub = defineComponent({
  name: "RouterLink",
  props: {
    to: { type: String, required: true },
  },
  template: '<a :href="to"><slot /></a>',
});

const mountCases = (locale: "en-US" | "zh-CN") => {
  const i18n = createI18n({
    legacy: false,
    locale,
    fallbackLocale: "en-US",
    messages: { "en-US": enUS, "zh-CN": zhCN },
  });
  return mount(ChatCases, {
    global: {
      plugins: [i18n],
      stubs: { RouterLink: RouterLinkStub },
    },
  });
};

describe("ChatCases", () => {
  it("keeps the seven-card group on the bounded conversation lane", () => {
    expect(CASES_SOURCE).toContain(
      "max-width: var(--phy-layout-transcript-max-width)"
    );
    expect(CASES_SOURCE).toContain(
      "grid-template-columns: repeat(7, minmax(0, 1fr))"
    );
  });

  it("uses compact mobile cards so all seven Cases fit the reviewed landing", () => {
    expect(CASES_SOURCE).toMatch(
      /@media \(max-width: 599px\)[\s\S]*?\.chat-case-link\s*\{[\s\S]*?padding:\s*var\(--phy-space-8\) var\(--phy-space-12\);/
    );
    expect(CASES_SOURCE).toMatch(
      /@media \(max-width: 599px\)[\s\S]*?\.chat-case-icon\s*\{[\s\S]*?width:\s*28px;[\s\S]*?height:\s*28px;/
    );
  });

  it("renders every routed case in fixed product order without role props", () => {
    const wrapper = mountCases("en-US");
    const links = wrapper.findAll('[data-testid="chat-case-link"]');

    expect(wrapper.props()).toEqual({});
    expect(links).toHaveLength(7);
    expect(links.map((link) => link.attributes("href"))).toEqual(routes);
    expect(links.map((link) => link.text())).toEqual(enTitles);
  });

  it("uses Chinese page titles without leaking English registry names", () => {
    const wrapper = mountCases("zh-CN");
    const links = wrapper.findAll('[data-testid="chat-case-link"]');

    expect(wrapper.get("h2").text()).toBe("智能体案例");
    expect(links.map((link) => link.text())).toEqual(zhTitles);
    expect(wrapper.text()).not.toContain("Knowledge Agent");
    expect(wrapper.text()).not.toContain("Deep Genome Agent");
  });

  it("maps every fixed case to its approved decorative image", () => {
    const wrapper = mountCases("en-US");
    const images = wrapper.findAll(".chat-case-icon img");

    expect(images).toHaveLength(7);
    expect(images.map((image) => image.attributes("src"))).toEqual(imagePaths);
    for (const image of images) {
      expect(image.attributes("alt")).toBe("");
      expect(image.attributes("loading")).toBe("eager");
    }
  });

  it("keeps byte-identical copies of the approved legacy icons", () => {
    for (const [filename, expected] of Object.entries(imageHashes)) {
      const bytes = readFileSync(
        resolve(__dirname, "../../public/agent-icons/" + filename)
      );
      expect(createHash("sha256").update(bytes).digest("hex")).toBe(expected);
    }
  });

  it("keeps case viewing separate from capability-gated live execution", () => {
    const wrapper = mountCases("en-US");
    const hrefs = wrapper
      .findAll('[data-testid="chat-case-link"]')
      .map((link) => link.attributes("href"));

    expect(hrefs).toContain("/cases/gene-network-agent");
    expect(hrefs).toContain("/cases/digital-design-agent");
    expect(hrefs).not.toContain("/gene-network-agent");
    expect(hrefs).not.toContain("/digital-design-agent");
  });
});
