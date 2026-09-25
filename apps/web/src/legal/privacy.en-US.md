# Phytomni Privacy Policy

**Version:** 0.1.4

**Effective date:** 2026-07-09  
**Operator / personal-information processor:** Biotechnology Research Institute, Chinese Academy of Agricultural Sciences (CAAS BRI)
**Contact email:** bri-zhbgs@caas.cn
**Address:** 12 Zhongguancun South Street, Haidian District, Beijing 100081, People’s Republic of China

Users in mainland China are governed by the Chinese version; all other users are governed by the English version. If the Chinese and English texts conflict, the Chinese version applies to users in mainland China and the English version applies to all other users.

## 1. Processor, applicable product, and regions

CAAS BRI is the personal-information processor for Phytomni. This Policy applies to the website, accounts, conversations and agents, file upload and storage, asynchronous analysis, task status, result or report downloads, and related support, security, and operations activities currently provided. Future public APIs, enterprise contracts, or third-party embedded deployments are not automatically covered and will be agreed separately.

We may process information in mainland China or other locations involved in the operational configuration. Specific locations and cross-border arrangements depend on enabled features and approved operational arrangements; this Policy does not promise a fixed region.

## 2. Categories of information collected

- **Account, login, and security records:** email address, hashed password, login and authorization records, IP address, device and browser information, timestamps, and necessary security and audit records.
- **Chat and user content:** prompts, conversation inputs and outputs, citations, conversation metadata, history, and instructions or feedback you submit.
- **Uploaded research and biological data:** genome, phenotype, experiment, patient or other human data, breeding materials, unpublished results, and file contents; the service does not automatically classify research data as sensitive.
- **Tasks, logs, and artifacts:** task identifiers, status, errors, execution records, reports, tables, and other downloadable artifacts.
- **Feedback, support, and error information:** support requests, feedback, contact information, and error or operational information needed for diagnosis.
- **Credentials and sensitive secrets:** passwords, API keys, access tokens, payment information, and other secrets. Do not submit unnecessary secrets in chat or uploaded files.
- **Cookies and local data:** session tokens, language preferences, login state, and similar settings needed to operate the interface.

## 3. Purpose matrix

The following describes purposes, improvement and review, processors, and deletion rules for each data category. Not every category is sent to every processor.

**Account, login, and security records**

- **Service:** registration, login, identity authentication, authorization, and account operation.
- **Security/support:** fraud prevention, abuse prevention, incident response, troubleshooting, and auditing.
- **Improvement:** not used for model training or general product improvement.
- **Processor:** authentication, core infrastructure, and security-monitoring services when enabled.
- **Deletion:** processed while the account exists; removed from active systems after account closure or an applicable deletion request, but records needed for security, audits, legal holds, or disputes may remain.
- **Legal/audit:** applicable legal duties, lawful requests, and necessary audit or dispute records.

**Chat inputs, outputs, citations, and conversation metadata**

- **Service:** generate answers, invoke requested agents, and retain history you ask us to keep.
- **Security/support:** security, abuse prevention, support, and troubleshooting to the necessary extent.
- **Improvement:** handled under the current default improvement policy in Section 4; you may request opt-out by email.
- **Processor:** Phytomni, Bot/model inference infrastructure when enabled, and services in the applicable configuration.
- **Deletion:** account or content deletion triggers removal from active systems; backup, audit, legal-hold, and dispute exceptions continue to apply.
- **Legal/audit:** content needed for applicable law, lawful requests, audits, or dispute preservation.

**Uploaded genome, phenotype, experiment, and other research files**

- **Service:** execute requested agents or tasks and generate artifacts.
- **Security/support:** protect integrity, investigate security events, and provide support and task diagnostics to the necessary extent.
- **Improvement:** biological or research characteristics do not by themselves create an automatic exclusion; improvement use follows Section 4 and applicable arrangements.
- **Processor:** object storage, Bot/model infrastructure, and approved asynchronous compute paths when enabled.
- **Deletion:** removed from active systems according to file or task lifecycle and applicable requests; backup, audit, security, legal-hold, and dispute exceptions continue to apply.
- **Legal/audit:** applicable legal duties, lawful requests, compliance audits, and necessary dispute preservation.

**Task metadata, execution logs, and artifacts**

- **Service:** display status, execute asynchronous tasks, and generate results requested for download.
- **Security/support:** reliability, support, incident response, and auditing.
- **Improvement:** only where a clearly approved improvement purpose covers the relevant fields.
- **Processor:** Phytomni, object storage when enabled, Bot-mediated asynchronous execution, and services in the applicable configuration; the current Web coordinator does not directly poll EIHealth.
- **Deletion:** handled according to task and artifact lifecycle; content needed for audits, legal holds, security records, or disputes may remain.
- **Legal/audit:** applicable legal duties, lawful requests, and necessary task-audit or dispute records.

**Feedback, support requests, and error reports**

- **Service:** answer requests, process feedback, and resolve faults.
- **Security/support:** investigate security or operational incidents.
- **Improvement:** may support product improvement after credentials and unnecessary sensitive information are filtered and an applicable purpose exists.
- **Processor:** email delivery and error-monitoring services when enabled.
- **Deletion:** handled as needed for support and security; legal, audit, and dispute exceptions apply.
- **Legal/audit:** support records needed for applicable law, lawful requests, audits, or disputes.

**Passwords, API keys, access tokens, payment information, and secrets**

- **Service:** authentication, authorization, and billing where applicable.
- **Security/support:** security protection and fraud prevention.
- **Improvement:** not used for model training or general product improvement.
- **Processor:** authentication, payment (where applicable), and core infrastructure services.
- **Deletion:** handled only under security and legal-retention rules; do not actively submit unnecessary secrets to Phytomni.
- **Legal/audit:** applicable legal duties, lawful requests, and necessary security or compliance audits.

## 4. Model improvement, feedback, and human/automated review

Under this Policy, inputs and related data may by default be used for model and product improvement. You may email bri-zhbgs@caas.cn to request opt-out; opt-out applies prospectively to new data generated after the request and does not roll back model parameters already trained. Passwords, API keys, access tokens, payment information, and secrets are excluded from improvement data.

Opt-out does not stop processing necessary to provide the service, operate account security, prevent abuse, provide support, troubleshoot faults, or meet legal or audit obligations. Email is the available opt-out route. This Policy does not represent that an in-product switch, temporary chat, or immediate deletion control exists. Feedback may support product improvement after credentials and unnecessary sensitive information are removed.

Automated systems and personnel, where necessary, authorized, and restricted, may process relevant content for security, abuse prevention, support, incident response, or legal compliance. We do not claim that every conversation is manually read, and do not promise that authorized personnel will never access content.

## 5. Uploaded research and biological data

To perform requested tasks, Phytomni may receive prompts, files, genome and phenotype data, experiment materials, and task metadata. Patient or other human data, restricted breeding materials, unpublished results, and data you are not authorized to share are high-risk examples.

Before uploading, you must complete an assessment appropriate to your circumstances and obtain a lawful basis, ethics approval, organizational authorization, and third-party permissions. The service does not automatically classify, anonymize, intercept, or block research data, and does not automatically determine legal sensitivity because data is biological.

## 6. Processors, third parties, and data flows

When the relevant feature is enabled or used, data may flow by function to these categories:

- **Object storage:** Huawei Cloud OBS or another configured object-storage service may store files or artifacts and support controlled retrieval when the relevant storage or artifact feature is enabled; the applicable service and routing depend on the operational configuration.
- **Asynchronous analysis/compute:** Bot-mediated task execution and state coordination; EIHealth is only a possible category in another enabled and operations-confirmed path and does not mean that the current Web directly polls it.
- **Bot/model inference infrastructure:** content needed to enable chat, agents, or model functions when enabled.
- **Email delivery:** support, rights requests, and opt-out requests.
- **Error monitoring and operational analytics:** limited operational or error information for diagnosis and security when enabled.

Processors may handle information only for authorized purposes; not every category of data is sent to every service. We do not sell personal information.

## 7. Domestic and cross-border processing

Information may be processed in mainland China or outside mainland China, depending on features, enabled processor paths, and operational arrangements. Where required by applicable law, we will take corresponding contractual, technical, and organizational measures and complete required notices, assessments, or regulatory procedures. This Policy does not promise a fixed region, uniform cross-border mechanism, or single transfer path.

## 8. Retention, deletion, backups, and legal holds

Account information is generally processed while the account exists; chats, files, tasks, and artifacts are handled according to their functions and lifecycles. Where feasible, after an applicable deletion or account-closure request, we remove relevant information from active systems, but the product does not promise a uniform immediate deletion or export button.

Deletion from active systems does not necessarily delete backups, security and audit logs, error records, or legal-hold copies at the same time. Information may remain as necessary to meet legal duties, investigate security incidents, resolve disputes, enforce agreements, or respond to lawful requests; when the trigger ends, it is deleted or de-identified under applicable retention arrangements.

## 9. Security and incident notices

We take appropriate administrative, technical, and organizational measures for the service, including TLS in transit, access controls, password hashing, rate limiting, and security and audit logs. No transmission or storage method can guarantee absolute security; protect your passwords, tokens, and other credentials.

If a personal-information security incident occurs that must be notified under applicable law, we will notify affected users and/or competent authorities as required.

## 10. Rights and request process

Where applicable law provides them, you may have rights to access, copy, correct, delete, restrict or object to processing, withdraw consent, data portability, and lodge complaints. The scope depends on your location, legal basis, and processing activity. Mainland China users may exercise applicable rights under PIPL; GDPR/UK GDPR, US state laws, and other laws apply only where they apply.

Send rights, deletion, or correction requests to bri-zhbgs@caas.cn. We may require reasonable identity verification and will respond within the period required by applicable law; this Policy does not promise a uniform fixed SLA. Security, fraud prevention, backups, audits, legal holds, or disputes may lawfully limit some requests.

## 11. Minors and sensitive information

Phytomni is not directed to children below the age required by applicable law. Minors must obtain appropriate guardian authorization and use the service under appropriate supervision; applicable age and requirements follow local law, with no single global age standard.

Do not upload personal, patient, human, breeding, or other research data without a lawful basis, ethics approval, organizational authorization, or third-party permission. You are responsible for assessing sensitivity and authority; the service does not promise to automatically detect or block such data.

## 12. Cookies, local storage, analytics, and logs

We use session tokens, language preferences, login state, and similar cookies or local storage to maintain login and interface functions. Servers record limited information such as IP address, device, browser, timestamps, operations, and security events for service operation, security, abuse prevention, support, and audits. When error monitoring or operational analytics is enabled, processing is limited to diagnostics and operations; this Policy does not promise a fixed provider, region, or retention period.

## 13. Policy changes

We may update this Policy because of service, legal, or security changes. Material changes will be published on this page with a new version or effective information, with additional notice where required by law. The effective date shown above applies to this version.

## 14. Contact and complaints

**Personal-information processor:** Biotechnology Research Institute, Chinese Academy of Agricultural Sciences (CAAS BRI)

**Email:** bri-zhbgs@caas.cn
**Address:** 12 Zhongguancun South Street, Haidian District, Beijing 100081, People’s Republic of China

You may use this email for privacy, opt-out, or rights requests. Users in mainland China may also complain to the applicable personal-information protection authority or use another statutory remedy. We will handle requests to the extent required by applicable law.
