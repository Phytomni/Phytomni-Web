import { describe, expect, it } from "vitest";
import { loadLegalDoc } from "@/legal/loadLegalDoc";

const documents = [
  { kind: "terms", locale: "en-US" },
  { kind: "terms", locale: "zh-CN" },
  { kind: "privacy", locale: "en-US" },
  { kind: "privacy", locale: "zh-CN" },
] as const;

const policyText = (kind: "terms" | "privacy", locale: "en-US" | "zh-CN") =>
  loadLegalDoc(kind, locale).markdown;

function sectionHeadings(markdown: string) {
  return [...markdown.matchAll(/^(##)\s+(.+)$/gm)].map((match) => ({
    level: match[1].length,
    title: match[2].trim(),
  }));
}

function expectPatterns(text: string, patterns: RegExp[]) {
  for (const pattern of patterns) expect(text).toMatch(pattern);
}

describe("legal policy contract", () => {
  it("loads all four documents with the approved version and ISO effective date", () => {
    for (const { kind, locale } of documents) {
      const document = loadLegalDoc(kind, locale);
      expect(document.version).toBe("0.1.4");
      expect(document.effectiveDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(document.effectiveDate).toBe("2026-07-09");
      expect(document.markdown.length).toBeGreaterThan(100);
      expect(document.markdown).toMatch(
        locale === "en-US"
          ? /^\*\*Version:\*\* 0\.1\.4/m
          : /^\*\*版本：\*\* 0\.1\.4/m
      );
      expect(document.markdown).toMatch(
        locale === "en-US"
          ? /^\*\*Effective date:\*\* 2026-07-09/m
          : /^\*\*生效日期：\*\* 2026-07-09/m
      );
    }
  });

  it("keeps the exact approved heading titles and order in both languages", () => {
    const termsTitles = {
      "en-US": [
        "1. Scope, operator, and product boundaries",
        "2. Accounts, organization accounts, and credentials",
        "3. Services, agents, models, asynchronous tasks, and artifacts",
        "4. User inputs, uploaded data, outputs, and ownership",
        "5. Research, biological, and third-party data responsibilities",
        "6. AI output, citations, and scientific-use limitations",
        "7. Acceptable use and prohibited conduct",
        "8. Third-party services, storage, computing, and external connections",
        "9. Intellectual property and feedback",
        "10. Availability, changes, rate limits, suspension, and termination",
        "11. Fees and institute-provided access",
        "12. Disclaimers and limitation of liability",
        "13. Indemnity",
        "14. Governing law, dispute resolution, and regional application",
        "15. Policy changes and contact information",
      ],
      "zh-CN": [
        "1. 适用范围、运营方与产品边界",
        "2. 账户、组织账户与凭证",
        "3. 服务、智能体、模型、异步任务与产物",
        "4. 用户输入、上传数据、输出与权利",
        "5. 研究、生物与第三方数据责任",
        "6. AI 输出、引用与科研使用限制",
        "7. 可接受使用与禁止行为",
        "8. 第三方服务、存储、计算与外部连接",
        "9. 知识产权与反馈",
        "10. 可用性、变更、限流、暂停与终止",
        "11. 费用与院所提供的访问",
        "12. 免责声明与责任限制",
        "13. 赔偿",
        "14. 适用法律、争议解决与地区适用",
        "15. 政策变更与联系方式",
      ],
    };
    const privacyTitles = {
      "en-US": [
        "1. Processor, applicable product, and regions",
        "2. Categories of information collected",
        "3. Purpose matrix",
        "4. Model improvement, feedback, and human/automated review",
        "5. Uploaded research and biological data",
        "6. Processors, third parties, and data flows",
        "7. Domestic and cross-border processing",
        "8. Retention, deletion, backups, and legal holds",
        "9. Security and incident notices",
        "10. Rights and request process",
        "11. Minors and sensitive information",
        "12. Cookies, local storage, analytics, and logs",
        "13. Policy changes",
        "14. Contact and complaints",
      ],
      "zh-CN": [
        "1. 处理者、适用产品与地区",
        "2. 收集的信息类别",
        "3. 使用目的矩阵",
        "4. 模型改进、反馈与人工/自动化审查",
        "5. 上传的研究与生物数据",
        "6. 受托处理者、第三方与数据流向",
        "7. 境内与跨境处理",
        "8. 保存期限、删除、备份与法律保全",
        "9. 安全措施与事件通知",
        "10. 用户权利与申请流程",
        "11. 未成年人和敏感信息",
        "12. Cookie、本地存储、分析与日志",
        "13. 政策变更",
        "14. 联系与投诉",
      ],
    };

    for (const locale of ["en-US", "zh-CN"] as const) {
      expect(sectionHeadings(policyText("terms", locale))).toEqual(
        termsTitles[locale].map((title) => ({ level: 2, title }))
      );
      expect(sectionHeadings(policyText("privacy", locale))).toEqual(
        privacyTitles[locale].map((title) => ({ level: 2, title }))
      );
    }
  });

  it("publishes all policy documents without draft or unreleased markers", () => {
    for (const { kind, locale } of documents) {
      expect(policyText(kind, locale)).not.toMatch(
        /\bdraft\b|unreleased|pending institute|not a final legal instrument|草案|未发布|待研究所审核/i
      );
    }
  });

  it("separates service delivery, security/support, and improvement purposes", () => {
    expectPatterns(policyText("terms", "en-US"), [
      /service-delivery processing/i,
      /security, support, and compliance processing/i,
      /improvement is a processing purpose separate/i,
      /Under these Terms, User Inputs and related data may by default be used/i,
      /email bri-zhbgs@caas\.cn to request opt-out/i,
      /opt-out applies prospectively to new data/i,
      /does not roll back model parameters already trained/i,
      /Opt-out does not stop processing necessary to provide the service[\s\S]*legal or audit obligations/i,
      /do not represent that an in-product switch[\s\S]*exists/i,
      /Email is the available opt-out route/i,
    ]);
    expectPatterns(policyText("terms", "zh-CN"), [
      /服务交付处理/,
      /安全、支持与合规处理/,
      /改进属于与服务交付以及安全、防滥用、支持、法律和审计处理相分开的处理目的/,
      /在本条款下，用户输入及相关数据默认可能用于模型与产品改进/,
      /发送邮件申请退出/,
      /对申请生效后产生的新数据具有前瞻性/,
      /不会回滚已经训练的模型参数/,
      /退出不会停止为提供服务[\s\S]*法律或审计义务所必需的处理/,
      /目前仅通过邮件申请处理退出/,
      /目前仅通过邮件申请处理退出/,
    ]);
    expectPatterns(policyText("privacy", "en-US"), [
      /## 3\. Purpose matrix/i,
      /## 4\. Model improvement/i,
      /\*\*Service:\*\*/i,
      /\*\*Security\/support:\*\*/i,
      /\*\*Improvement:\*\*/i,
    ]);
    expectPatterns(policyText("privacy", "zh-CN"), [
      /## 3\. 使用目的矩阵/,
      /## 4\. 模型改进/,
      /服务：/,
      /安全\/支持：/,
      /改进：/,
    ]);
    expectPatterns(policyText("privacy", "en-US"), [
      /Under this Policy[\s\S]*may by default be used/i,
      /You may email bri-zhbgs@caas\.cn to request opt-out/i,
      /opt-out applies prospectively/i,
      /does not represent that an in-product switch/i,
      /Email is the available opt-out route/i,
    ]);
    expectPatterns(policyText("privacy", "zh-CN"), [
      /在本政策下[\s\S]*默认可能用于/,
      /发送邮件申请退出/,
      /具有前瞻性/,
      /本政策不表示已有产品内开关/,
      /电子邮件是目前提供的退出途径/,
    ]);
    expectPatterns(policyText("terms", "en-US"), [
      /Email is the available opt-out route/i,
    ]);
    expectPatterns(policyText("terms", "zh-CN"), [
      /目前仅通过邮件申请处理退出/,
    ]);
  });

  it("covers all six privacy data classes and each purpose-matrix label", () => {
    expectPatterns(policyText("privacy", "en-US"), [
      /\*\*Account, login, and security records\*\*/i,
      /\*\*Chat inputs, outputs, citations, and conversation metadata\*\*/i,
      /\*\*Uploaded genome, phenotype, experiment, and other research files\*\*/i,
      /\*\*Task metadata, execution logs, and artifacts\*\*/i,
      /\*\*Feedback, support requests, and error reports\*\*/i,
      /\*\*Passwords, API keys, access tokens, payment information, and secrets\*\*/i,
      /\*\*Service:\*\*/i,
      /\*\*Security\/support:\*\*/i,
      /\*\*Improvement:\*\*/i,
      /\*\*Processor:\*\*/i,
      /\*\*Deletion:\*\*/i,
      /\*\*Legal\/audit:\*\*/i,
    ]);
    expectPatterns(policyText("privacy", "zh-CN"), [
      /\*\*账户、登录与安全记录\*\*/,
      /\*\*聊天输入、输出、引用与对话元数据\*\*/,
      /\*\*上传的基因组、表型、实验及其他研究文件\*\*/,
      /\*\*任务元数据、执行日志与产物\*\*/,
      /\*\*反馈、支持请求与错误报告\*\*/,
      /\*\*密码、API 密钥、访问令牌、支付信息与秘密\*\*/,
      /服务：/,
      /安全\/支持：/,
      /改进：/,
      /受托处理：/,
      /删除：/,
      /法律\/审计：/,
    ]);
  });

  it("states research-data examples and responsibility boundaries in both languages", () => {
    expectPatterns(policyText("terms", "en-US"), [
      /genomic, phenotypic, experimental, patient or other human/i,
      /breeding-material, and unpublished-result data/i,
      /sensitivity and risk assessment/i,
      /ethics approval, organizational authorization, and third-party permissions/i,
      /responsible for patient or other human data/i,
      /does not automatically classify Research Data/i,
    ]);
    expectPatterns(policyText("terms", "zh-CN"), [
      /基因组、表型、实验、患者或其他人类、育种材料及未发表结果/,
      /敏感性和风险评估/,
      /法律依据、伦理批准、组织授权以及第三方许可/,
      /您承担相应责任/,
      /不会自动将研究数据分类为敏感信息/,
    ]);
    expectPatterns(policyText("privacy", "en-US"), [
      /genome, phenotype, experiment/i,
      /patient or other human data/i,
      /breeding materials/i,
      /unpublished results/i,
      /ethics approval/i,
      /does not automatically classify/i,
    ]);
    expectPatterns(policyText("privacy", "zh-CN"), [
      /基因组、表型、实验/,
      /患者或其他人类数据/,
      /育种材料/,
      /未发表结果/,
      /伦理批准/,
      /不会自动分类/,
    ]);
  });

  it("limits processor disclosure to conditional categories and preserves retention exceptions", () => {
    expectPatterns(policyText("privacy", "en-US"), [
      /when the relevant feature is enabled or used/i,
      /Huawei Cloud OBS or another configured object-storage service may/i,
      /when the relevant storage or artifact feature is enabled/i,
      /object storage/i,
      /Bot\/model inference infrastructure/i,
      /email delivery/i,
      /error monitoring/i,
      /not every category is sent to every processor/i,
      /backups, security and audit logs, error records, or legal-hold copies/i,
      /investigate security incidents, resolve disputes/i,
    ]);
    expectPatterns(policyText("privacy", "zh-CN"), [
      /当相应功能启用或被使用时/,
      /华为云 OBS 或其他已配置的对象存储服务可能/,
      /启用相关存储或产物功能时/,
      /Bot\/模型推理基础设施/,
      /电子邮件投递/,
      /错误监控/,
      /并非每类数据都会发送给每类受托处理者/,
      /备份、安全与审计日志、故障记录或法律保全副本/,
      /调查安全事件、解决争议/,
    ]);
  });

  it("preserves bilingual retention exceptions and conditional deletion boundaries", () => {
    expectPatterns(policyText("privacy", "en-US"), [
      /according to their functions and lifecycles/i,
      /does not promise a uniform immediate deletion/i,
      /Deletion from active systems does not necessarily delete backups/i,
      /legal duties, investigate security incidents, resolve disputes/i,
      /deleted or de-identified under applicable retention arrangements/i,
    ]);
    expectPatterns(policyText("privacy", "zh-CN"), [
      /按照相应功能和生命周期处理/,
      /不承诺统一的即时删除/,
      /活动系统删除不必然同时删除备份/,
      /履行法定义务、调查安全事件、解决争议/,
      /按适用保留安排删除或去标识化/,
    ]);
    expectPatterns(policyText("terms", "en-US"), [
      /after termination, content and records are handled under the Privacy Policy/i,
      /applicable backup, audit, security, dispute, and legal obligations/i,
    ]);
    expectPatterns(policyText("terms", "zh-CN"), [
      /终止后的内容和记录按《隐私政策》/,
      /备份、审计、安全、争议和法律义务处理/,
    ]);
  });

  it("includes rights, minors, and contact routes in both privacy policies", () => {
    expectPatterns(policyText("privacy", "en-US"), [
      /## 10\. Rights and request process/i,
      /access, copy, correct, delete/i,
      /## 11\. Minors and sensitive information/i,
      /parent|guardian/i,
      /## 14\. Contact and complaints/i,
      /bri-zhbgs@caas\.cn/i,
    ]);
    expectPatterns(policyText("privacy", "zh-CN"), [
      /## 10\. 用户权利与申请流程/,
      /查阅、复制、更正、删除/,
      /## 11\. 未成年人和敏感信息/,
      /监护人/,
      /## 14\. 联系与投诉/,
      /bri-zhbgs@caas\.cn/,
    ]);
  });

  it("contains no unresolved public placeholders", () => {
    const banned = [
      /\bTODO\b/i,
      /\bTBD\b/i,
      /\[待研究所确认\]/,
      /\[待运维补全\]/,
      /\[TO BE CONFIRMED\]/i,
      /pending institute confirmation/i,
    ];
    for (const { kind, locale } of documents) {
      const text = policyText(kind, locale);
      for (const marker of banned) expect(text).not.toMatch(marker);
    }
  });

  it("does not assert unsupported product controls", () => {
    const affirmativeClaims = [
      /(?:we|phytomni)\s+(?:offer|provide|support|enable)[^.!?\n]{0,60}temporary chat/i,
      /temporary chat\s+(?:is|will be)\s+(?:available|enabled)/i,
      /zero[- ]retention\s+(?:policy|guarantee|is provided)/i,
      /(?:we|the service) automatically classif(?:y|ies|ied)\s+(?:all\s+)?research data/i,
      /product[- ]level\s+per[- ]conversation\s+training\s+controls?\s+(?:are|is)\s+available/i,
      /server[- ]side\s+consent logging\s+(?:is|has been)\s+(?:enabled|implemented)/i,
    ];
    const affirmativeClaimsZh = [
      /(?:服务|系统|Phytomni)(?:会|将|可以)自动分类(?:研究数据|研究资料)/,
      /零保留(?:政策|保证|承诺)/,
      /临时对话(?:功能|模式)(?:已提供|可用|已启用)/,
      /逐对话训练控制(?:已提供|可用|已启用)/,
      /服务器端同意记录(?:已启用|已实施)/,
    ];
    for (const { kind, locale } of documents) {
      const text = policyText(kind, locale);
      for (const claim of affirmativeClaims) expect(text).not.toMatch(claim);
      if (locale === "zh-CN") {
        for (const claim of affirmativeClaimsZh)
          expect(text).not.toMatch(claim);
      }
    }
    expect(policyText("privacy", "en-US")).toMatch(
      /does not represent that an in-product switch, temporary chat, or immediate deletion control exists/i
    );
    expect(policyText("privacy", "zh-CN")).toMatch(
      /本政策不表示已有产品内开关、临时对话或即时删除控制/
    );
    expect(policyText("terms", "en-US")).toMatch(
      /does not automatically classify Research Data/i
    );
    expect(policyText("privacy", "zh-CN")).toMatch(/服务不会自动分类/);
  });
});
