/*
 * 组件注释
 * @Author: AI Assistant
 * @Date: 2024-06-17
 * @Description: 中文语言包
 * 既往不恋！当下不杂！！未来不迎！！！
 */
export default {
  // 通用部分
  common: {
    confirm: "确认",
    cancel: "取消",
    edit: "编辑",
    delete: "删除",
    failed: "失败",
    warning: "警告",
    loading: "加载中",
    noData: "暂无数据",
    save: "保存",
    reset: "重置",
    retry: "重试",
    back: "返回",
    close: "关闭",
    view: "查看",
    index: "序号",
    operation: "操作",
    running: "运行中",
    finished: "已完成",
    Tip: "（AI 生成）",
    aiDisclaimer: "由AI生成，请仔细审查",
    followSystem: "跟随系统",
    lightTheme: "浅色",
    darkTheme: "深色",
    themeSelector: "选择主题",
    languageSelector: "选择语言",
    languageChinese: "中文",
    languageEnglish: "English",
    languageChineseCompact: "中",
    languageEnglishCompact: "EN",
    opFailedRetry: "操作失败，请重试",
    renamedSuccess: "重命名成功",
    renameFailedRetry: "重命名失败，请重试",
    deletedSuccess: "删除成功",
    deleteFailedRetry: "删除失败，请重试",
    refreshedSuccess: "刷新成功",
    refreshFailed: "刷新失败",
    refreshFailedRetry: "刷新失败，请重试",
    userAddedSuccess: "用户添加成功",
    userUpdatedSuccess: "用户更新成功",
    registrationSuccess: "注册成功",
    sessionExpired: "登录已过期，请重新登录",
    notice: "提示",
  },

  // 错误页
  errorPage: {
    back: "返回",
    goHome: "回首页",
    goChat: "打开对话",
    e401Title: "401错误！",
    e401NoAccess: "您没有访问权限！",
    e401Detail: "对不起，您没有访问权限，请不要进行非法操作！您可以返回主页面",
    e404Title: "404错误！",
    e404NotFound: "页面不存在！",
    e404Detail:
      "对不起，您正在寻找的页面不存在。尝试检查URL的错误，然后按浏览器上的刷新按钮或尝试在我们的应用程序中找到其他内容。",
  },

  // 应用信息
  app: {
    title: "农科发现大模型",
  },

  // 互动教程
  tutorial: {
    step1: {
      title: "欢迎使用农科发现大模型！",
      content:
        '首先，让我们了解一下导航功能。快速访问功能："开始新对话"启动全新任务，"深度基因收录"让您查看基因信息，"收藏夹"用于收集常用内容，还有按时间分类的历史交互记录，帮助您高效查找过往记录。',
    },
    step2: {
      title: "浏览智能体案例",
      content:
        "输入框下方展示所有智能体案例。点击任一案例可打开对应的演示页面。",
    },
    step3: {
      title: "对话窗口",
      content:
        '这是与农科发现大模型交流的"窗口"。您可以直接输入问题，或者自主选择不同的智能助手，如"ChatAgent"和"KnowledgeAgent"。试试点击输入框。准备好开始探索了吗？',
    },
    nextStep: "下一步",
    prevStep: "上一步",
    complete: "完成",
    startTutorial: "开始教学",
    navigationHint: "💡 提示：使用 ← → 方向键或空格键导航，ESC键退出",
  },

  // 菜单
  menu: {
    deepGenome: "深度基因收录",
    favorites: "收藏夹",
    feedback: "用户反馈",
    userList: "用户列表",
    logList: "系统监控",
    permissionManage: "权限管理",
    taskManager: "任务管理",
    globalConfig: "全局策略配置",
    adminManagement: "管理员管理",
  },

  // 错误码
  errorCode: {
    401: "认证失败，无法访问系统资源",
    403: "当前操作没有权限",
    404: "访问资源不存在",
    default: "系统未知错误，请反馈给管理员",
  },

  // 请求层(axios 拦截器使用)
  request: {
    sessionExpired: "登录已过期，请重新登录",
    sessionInvalid: "无效的会话，或者会话已过期，请重新登录。",
    confirmButtonText: "我知道了",
    networkError: "后端接口连接异常",
    requestTimeout: "系统接口请求超时",
    httpStatusError: "系统接口{code}异常",
  },

  // 修改密码
  changePassword: {
    usernamePlaceholder: "请输入用户名",
    oldPassword: "旧密码",
    oldPasswordPlaceholder: "请输入旧密码",
    newPassword: "新密码",
    newPasswordPlaceholder: "请输入新密码",
    confirmPassword: "确认新密码",
    confirmPasswordPlaceholder: "请再次输入新密码",
    confirm: "确认修改",
    usernameRequired: "请输入用户名",
    oldPasswordRequired: "请输入旧密码",
    newPasswordRequired: "请输入新密码",
    confirmPasswordRequired: "请再次输入新密码",
    passwordMinLength: "密码长度不能小于6个字符",
    passwordMinLength8: "密码长度不能小于8个字符",
    passwordNeedUppercase: "密码必须包含大写字母",
    passwordNeedLowercase: "密码必须包含小写字母",
    passwordNeedNumber: "密码必须包含数字",
    passwordNeedSpecial: "密码必须包含特殊符号",
    passwordSame: "新密码不能与旧密码相同",
    passwordMismatch: "两次输入的密码不一致",
    formValidationFailed: "请检查表单填写是否正确",
    passwordChangeSuccess: "密码修改成功",
    passwordChangeFailed: "密码修改失败",
    passwordChangeRetry: "密码修改失败，请稍后重试",
  },

  // 登录模块
  login: {
    title: "登录",
    subtitle: "面向科学发现与植物设计的多智能体科研系统",
    email: "邮箱",
    emailPlaceholder: "请输入邮箱地址",
    password: "密码",
    passwordPlaceholder: "8-16个字符长，区分大小写",
    forgotPassword: "忘记密码？",
    loginButton: "登 录",
    noAccount: "没有账户？",
    register: "注册",
    login: "登录",
    loginSuccess: "登录成功",
    loginFailed: "登录失败",
    registerFailed: "注册失败",
    passwordWarningTitle: "密码安全提醒",
    accountLockedTitle: "账户已锁定",
    firstLoginTitle: "首次登录提醒",
    firstLoginMessage: "检测到您是首次登录，为了账户安全，请先修改初始密码。",
    // NOTE: firstLoginTitle/Message 现有 keys 在 login moment 触发(login.vue:188)
    // — 用户首次登录瞬间的提醒。FirstLoginEnforce* 在 router 守卫拦截 bypass
    // 时触发 — 用户尝试绕过强制改密的提示。两套语义独立,文案不混用。
    firstLoginEnforceTitle: "密码尚未修改",
    firstLoginEnforceMessage: "请先修改初始密码，否则无法访问其他页面",
    agreement: {
      prefix: "登录即表示您同意我们的",
      terms: "服务条款",
      and: "和",
      privacy: "隐私政策",
    },
    validation: {
      emailRequired: "请输入邮箱地址",
      emailFormat: "请输入正确的邮箱格式",
      passwordRequired: "请输入密码",
      passwordLength: "密码长度在8-16个字符之间",
    },
  },

  // 注册模块
  register: {
    title: "注册账户",
    subtitle: "创建您的农科发现大模型账户",
    closedTitle: "暂未开放注册",
    closedSubtitle: "当前暂不接受新账户注册。",
    closedDescription: "如需开通账户，请联系管理员。",
    returnToLogin: "返回登录",
    email: "邮箱",
    emailPlaceholder: "请输入邮箱地址",
    password: "密码",
    passwordPlaceholder: "请输入密码",
    confirmPassword: "确认密码",
    confirmPasswordPlaceholder: "请再次输入密码",
    registerButton: "注 册",
    registrationFailed: "注册失败",
    haveAccount: "已有账户？",
    login: "登录",
    agreement: {
      prefix: "注册即表示您同意我们的",
      terms: "服务条款",
      and: "和",
      privacy: "隐私政策",
      checkboxLabel: "我已阅读并同意以下法律文件",
      checkboxRequired: "请先同意服务条款和隐私政策",
    },
    validation: {
      emailRequired: "请输入邮箱地址",
      emailFormat: "请输入正确的邮箱格式",
      passwordRequired: "请输入密码",
      passwordMinLength8: "@:changePassword.passwordMinLength8",
      passwordMaxLength16: "密码长度不能超过16个字符",
      passwordNeedUppercase: "@:changePassword.passwordNeedUppercase",
      passwordNeedLowercase: "@:changePassword.passwordNeedLowercase",
      passwordNeedNumber: "@:changePassword.passwordNeedNumber",
      passwordNeedSpecial: "密码必须包含特殊符号",
      confirmPasswordRequired: "请确认密码",
      confirmPasswordMismatch: "两次输入的密码不一致",
      formValidationFailed: "请检查表单填写是否正确",
    },
  },

  legal: {
    termsTitle: "服务条款",
    privacyTitle: "隐私政策",
    icpFiling: "京ICP备07026971号-9",
    versionLabel: "版本",
    effectiveLabel: "生效日期",
    draftBanner: "本稿待中国农业科学院生物技术研究所审定，不构成最终法律文本。",
    loadError: "文档加载失败，请稍后重试。",
  },

  // 忘记密码模块
  forgotPassword: {
    title: "忘记密码",
    backToLogin: "返回登录",
    unavailableTitle: "密码重置功能暂未开放",
    unavailableMessage: "此功能正在开发中，如需重置密码请联系系统管理员。",
  },

  // 用户管理
  user: {
    list: "用户列表",
    listTitle: "用户列表",
    passwordEditPlaceholder: "留空则不修改密码",
    unnamedUser: "未设置用户名",
    add: "新增用户",
    edit: "编辑用户",
    username: "用户名",
    password: "密码",
    role: "角色",
    roleSelect: "请选择角色",
    admin: "管理员",
    addFailed: "新增失败",
    editFailed: "编辑失败",
    detail: "用户详情",
    changePassword: "修改密码",
    feedback: "用户反馈",
    logout: "登出",
    history: "历史记录",
    profile: "个人资料",
    cloudStorage: "网盘空间",
    systemMonitor: "系统监控",
    globalConfig: "全局策略配置",
    adminManagement: "管理员管理",
    unlock: "解锁",
    unlockConfirmTitle: "解锁用户",
    unlockConfirmMessage: "确定要解锁用户 {email} 吗？",
    unlockSuccess: "用户解锁成功",
    unlockFailed: "用户解锁失败",
    phone: "手机号",
    phonePlaceholder: "请输入手机号",
    organization: "所属机构",
    organizationPlaceholder: "请输入所属机构",
    position: "职位",
    positionPlaceholder: "请输入职位",
    lastLoginAt: "最后登录",
    notLoggedIn: "未登录",
    chatLimit: "对话限制",
    chatLimitPlaceholder: "请输入对话次数限制",
    unlimited: "无限制",
    validation: {
      emailRequired: "请输入用户名",
      emailFormat: "请输入正确的邮箱地址",
      passwordRequired: "请输入密码",
      passwordLength: "长度在8到16个字符",
      passwordMinLength8: "@:changePassword.passwordMinLength8",
      passwordMaxLength16: "密码长度不能超过16个字符",
      passwordNeedUppercase: "@:changePassword.passwordNeedUppercase",
      passwordNeedLowercase: "@:changePassword.passwordNeedLowercase",
      passwordNeedNumber: "@:changePassword.passwordNeedNumber",
      passwordNeedSpecial: "密码必须包含特殊符号",
      roleRequired: "请选择角色",
      formValidationFailed: "请检查表单填写是否正确",
    },
  },

  // 基因展示
  gene: {
    detailTitle: "基因科研结果",
    notFound: "未找到基因详情",
    searchPlaceholder: "请输入物种或者基因进行搜索",
    getFailed: "获取基因详情失败",
    geneName: "文件名称",
    biocode: "物种名",
    geneId: "基因ID",
    resultsCount: "共 {count} 条结果",
    logs: {
      fetchDataFailed: "获取数据失败：",
      fetchDetailFailed: "获取基因详情失败：",
    },
  },

  // 聊天模块
  chat: {
    untitledConversation: "新对话",
    conversationTitle: "对话标题",
    appTitle: "农科发现大模型",
    welcome: "欢迎使用，可直接输入您想问的问题",
    inputPlaceholder: "请输入您的问题……",
    send: "发 送",
    newChat: "开启新对话",
    openNavigation: "打开导航",
    expandNavigation: "展开导航",
    collapseNavigation: "收起导航",
    exploreAgent: "智能体示例",
    agentsArchitectureTitle: "农科发现大模型智能体架构",
    agentsArchitectureAlt: "农科发现大模型智能体架构图",
    deepGenome: "深度基因收录",
    useTool: "使用工具",
    stepResult: "步骤结果",
    resultImageAlt: "结果图 {index}",
    sendFailed: "发送消息失败，请稍后重试。",
    timeoutFailed: "请求处理超时，请缩小查询范围或稍后重试。",
    contextDegraded: "回答已保存。系统将在下一条消息时重建对话上下文。",
    routingFallbackChat: "未能识别专用智能体，已降级为对话智能体。",
    routingSelectedAgent: "{agent}",
    requestId: "请求 ID",
    sendAriaLabel: "发送",
    abortAriaLabel: "中止回答",
    progress: {
      processing: "处理中",
      selectingAgent: "正在选择智能体…",
      valueText: "处理中，{percent}%",
      etaSeconds: "通常需要 {min}–{max} 秒",
      etaMinutes: "通常需要 {min}–{max} 分钟",
      etaHours: "通常需要 {min}–{max} 小时",
      cotLabel: "工作步骤",
      cotCount: "{shown}/{total}",
      stages: {
        chat: {
          prepareContext: "正在整理对话上下文",
          generate: "正在生成回答",
          followUp: "正在整理后续问题",
        },
        knowledge: {
          processFiles: "正在处理参考文件",
          retrieve: "正在检索文献与知识库",
          prepareGenerate: "正在准备带文献的草稿",
          generate: "正在撰写带文献的回答",
          assemble: "正在整理引用",
          prepareFollowUp: "正在准备后续问题",
          followUp: "正在写出后续问题",
        },
        data: {
          prepareRetrieve: "正在准备目录检索",
          searchKnowledge: "正在核对相关知识",
          collectRetrieve: "正在汇总目录匹配",
          prepareRewrite: "正在准备改写查询",
          rewriteQuery: "正在改写数据查询",
          applyRewrite: "正在应用改写后的查询",
          searchCatalog: "正在检索数据目录",
        },
        briefGene: {
          parseQuery: "正在解析基因问题",
          fetchAnnotation: "正在拉取基因注释",
          prepareRetrieve: "正在准备文献任务",
          retrieveWorker: "正在检索相关文献",
          retrieveReduce: "正在合并文献结果",
          prepareGenerate: "正在准备基因综述",
          generate: "正在撰写基因综述",
          prepareFollowUp: "正在准备后续问题",
          followUp: "正在写出后续问题",
        },
        review: {
          planPrep: "正在准备综述问题",
          planPost: "正在锁定综述计划",
          retrieveDispatch: "正在分发文献检索",
          retrieveWorker: "正在检索文献",
          retrieveReduce: "正在合并检索证据",
          draftDispatch: "正在分发章节起草",
          draftWorker: "正在起草综述章节",
          draftReduce: "正在合并章节草稿",
          reviewDispatch: "正在分发章节审校",
          reviewWorker: "正在审校章节草稿",
          reviewReduce: "正在合并审校意见",
          reviseDispatch: "正在分发修订任务",
          reviseWorker: "正在修订文稿",
          reviseReduce: "正在合并修订章节",
          summaryPrep: "正在准备综述摘要",
          summaryPost: "正在撰写综述摘要",
          prepareFollowUp: "正在准备后续问题",
          followUp: "正在写出后续问题",
        },
        analyst: {
          parsePrep: "正在准备解析需求",
          parsePost: "正在解析分析需求",
          selectPrep: "正在准备数据选择",
          selectPost: "正在选择数据集",
          methodPrep: "正在准备方法检索",
          methodKnowledge: "正在检索分析方法",
          methodPost: "正在锁定分析方法",
          planPrep: "正在准备分析计划",
          planPost: "正在撰写分析计划",
          checkPrep: "正在准备计划核对",
          checkPost: "正在核对分析计划",
          toolExtractPrep: "正在准备工具提取",
          toolExtractPost: "正在提取所需工具",
          toolRetrieve: "正在获取工具配置",
          submit: "正在提交计算任务",
          pool: "正在等待分析结果",
        },
        deepGenome: {
          brief: "正在撰写基因背景综述",
          prepare: "正在准备多组学任务",
          tissues: "正在收集组织表达证据",
          cultivars: "正在收集品种表达证据",
          treatments: "正在收集处理表达证据",
          genotypes: "正在收集基因型表达证据",
          singleCell: "正在收集单细胞证据",
          promoter: "正在收集启动子证据",
          smep: "正在收集 SMEP 证据",
          smoc: "正在收集 SMOC 证据",
          protein: "正在收集蛋白结构证据",
          design: "正在收集设计证据",
          evolution: "正在收集进化证据",
          synthesize: "正在综合已收集证据",
          experiment: "正在起草建议实验",
          protocol: "正在起草实验方案",
          discussion: "正在撰写讨论",
          summary: "正在撰写深度报告摘要",
          followUp: "正在整理后续问题",
        },
        design: {
          prepare: "正在准备蛋白与启动子设计任务",
          protein: "正在提交蛋白设计",
          promoter: "正在提交启动子设计",
          resume: "正在恢复外部设计任务",
          wait: "正在等待设计结果",
        },
        network: {
          prepare: "正在准备基因网络任务",
          submit: "正在提交网络分析",
          build: "正在构建调控网络",
          wait: "正在等待网络结果",
        },
        research: {
          validate: "正在校验研究请求",
          resolveInputs: "正在解析研究输入",
          extract: "正在提取研究目标",
          plan: "正在规划虚拟实验",
          prepare: "正在准备研究任务",
          run: "正在运行分析任务",
          resume: "正在恢复外部研究任务",
          pack: "正在等待结果并打包",
        },
      },
    },
    botReport: {
      waiting: "正在准备报告",
      partial: "报告尚未完成",
      degraded: "部分分析暂不可用",
      failed: "报告生成失败",
      inputRequired: "需要补充信息",
      complete: "报告已生成",
      emptyArtifacts: "暂无可下载的产物。",
    },
    generationStopped: "已停止生成",
    relatedDocuments: "参考资料",
    welcomeTitle: "今天想探索什么？",
    history: {
      loading: "正在加载对话历史",
      emptyTitle: "此对话暂时没有消息",
      emptySubtitle: "从一个问题开始，继续这段对话。",
      errorTitle: "无法加载对话历史",
      errorSubtitle: "请重试，其他对话不会受到影响。",
      retry: "重试",
    },
    mode: {
      instant: "快速模式",
      expert: "专家模式",
      comingSoon: "即将上线",
    },
    tools: {
      generic: "正在调用工具",
      knowledge_search: "正在检索文献",
    },
    steps: {
      retrieving: "正在检索",
    },
    toolHits: "命中 {count} 条",
    streamInterrupted: "连接中断，请重试。",
    activity: {
      label: "活动",
      count: "{count}",
      status: {
        running: "进行中",
        done: "已完成",
      },
    },
    a2ui: {
      confirm: "确认",
      cancel: "取消",
      submit: "提交",
      submitting: "正在等待操作完成。",
      submitted: "操作已提交。",
      cancelled: "操作已取消。",
      rejected: "操作被拒绝。",
      advanced: "操作已由新操作取代。",
      temporarilyRejected: "操作暂时未完成，可以重试。",
      retry: "重试操作",
      expired: "该提示已失效。",
      unknown: "操作结果未知。",
      protocolError: "无法显示该操作。",
      notSent: "操作尚未发送。",
      refreshRequired: "请刷新对话后继续。",
      failed: "该提示失败，请重新提问。",
      locked: "已提交",
    },
    reasoning: { show: "展开思考过程", hide: "收起思考过程" },
    welcomeSubtitle: "可以从文献、基因与物种研究，或深度基因组分析开始。",
    cases: {
      title: "智能体案例",
      ariaLabel: "智能体案例展示",
    },
    inputPlaceholderTip: "请输入您的问题",
    uploadFile:
      "支持生物学数据和文本文件，单个最大 10 GiB，最多 {maxFiles} 个，也可直接粘贴复制的文件。",
    attachmentTargetUnavailable:
      "当前智能体无法接收附件。请移除附件或选择兼容的智能体。",
    attachmentTargetUnsupported: "当前智能体不支持上传文件。",
    attachmentErrors: {
      unsupported_type: "当前智能体不支持“{file}”，请查看智能体能力后重试。",
      file_too_large: "“{file}”超过单个文件 {maxFileMb} MB 的限制。",
      total_too_large: "附件总大小不能超过 {maxTotalMb} MB。",
      too_many_files: "最多添加 {maxFiles} 个附件。",
      invalid_filename: "“{file}”的文件名无效。",
      invalid_size: "“{file}”大小必须在 1 字节到 10 GiB 之间。",
      invalid_metadata: "“{file}”的文件元数据无效。",
      upload_disabled: "文件上传当前不可用。",
      upload_unavailable: "文件上传服务暂时不可用。",
    },
    upload: {
      alreadyAttached: "已添加：{file}",
      attachments: "附件",
      chipLabel: "{file}，{suffix}，{status}，{metric}",
      fileSuffixFallback: "文件",
      more: "另外 {count} 个",
      hiddenFailed: "{count} 个失败",
      hiddenExpired: "{count} 个已过期",
      status: {
        queued: "排队中",
        creating: "准备中",
        uploading: "上传中",
        paused: "已暂停",
        failed: "上传失败",
        completing: "整理中",
        completed: "可发送",
        aborted: "已取消",
        expired: "会话已过期",
      },
      stateChanged: "{file}：{status}",
      progress: "{loaded} / {total}（{percent}%）",
      progressLabel: "“{file}”的上传进度",
      speed: "{rate}",
      eta: "约剩余 {seconds} 秒",
      pause: "暂停",
      resume: "继续",
      retry: "重试",
      reselect: "选择文件",
      cancel: "取消",
      remove: "移除",
      actions: {
        pause: "暂停上传“{file}”",
        resume: "继续上传“{file}”",
        retry: "重试上传“{file}”",
        reselect: "为“{file}”选择原文件",
        cancel: "取消上传“{file}”",
        remove: "移除“{file}”",
      },
      completedFile: "已完成的文件",
    },
    timeGroup: {
      today: "今天",
      yesterday: "昨天",
      week: "7 天内",
      older: "一周前",
    },
    agentLabels: {
      chatAgent: "对话智能体",
      knowledgeAgent: "知识智能体",
      dataAgent: "数据智能体",
      analystAgent: "分析智能体",
      reviewAgent: "综述智能体",
      briefGeneAgent: "基因综述智能体",
      deepGenomeAgent: "基因深度分析智能体",
      inSilicoResearchAgent: "虚拟研究智能体",
      geneNetworkAgent: "基因网络智能体",
      digitalDesignAgent: "智能设计智能体",
    },
    agentPresentation: {
      chatAgentAlt: "对话智能体工作流程图",
      knowledgeAgentAlt: "知识智能体工作流程图",
      dataAgentAlt: "数据智能体工作流程图",
      analystAgentAlt: "分析智能体工作流程图",
      reviewAgentAlt: "综述智能体工作流程图",
      inSilicoResearchAgentAlt: "虚拟研究智能体工作流程图",
      geneNetworkAgentAlt: "基因网络智能体工作流程图",
      deepGenomeAgentAlt: "基因深度分析智能体工作流程图",
      digitalDesignAgentAlt: "智能设计智能体工作流程图",
    },
    agents: {
      chatAgent: "您的农业科研智能助手，用自然语言解答各类研究问题。",
      knowledgeAgent: "提供权威农业知识库，精准匹配科研需求。",
      dataAgent: "高效管理海量农业数据，助力高效分析。",
      analystAgent: "从数据到洞察，一键生成农业研究分析结果。",
      reviewAgent: "自动整合文献，生成领域综述报告，快速把握研究趋势。",
      briefGeneAgent: "快速生成基因功能与研究线索的基因综述。",
      deepGenomeAgent: "深度分析植物基因，为育种研究提供智能支持。",
      inSilicoResearchAgent: "通过数字模拟加速农业实验，降低研发成本。",
      geneNetworkAgent: "解析基因调控网络，揭示农作物抗逆性与高产的关键通路。",
      digitalDesignAgent:
        "智能化设计基因启动子与蛋白质结构，为合成生物学和分子育种提供精准方案。",
    },
    logs: {
      sendMessageFailed: "发送消息失败：",
    },
    downloadURL: "下载链接",
    copySuccess: "复制成功",
    copyFailed: "复制失败",
    pendingWriteFailed: "会话备份失败，不影响发送",
    icpAriaLabel: "工信部备案信息",
    copy: "复制",
    ladingInner: "正在处理您的请求：检索数据、分析信息并生成回答，请稍候",
    footer: "内容由 AI 生成，请仔细甄别。",
    followUpQuestions: "问题建议：",
    more: "更多",
    actions: {
      rename: "重命名",
      favorite: "收藏",
      unfavorite: "取消收藏",
      delete: "删除",
      deleteConfirm: "确认删除",
      deleteWarning: "确定要删除这个对话吗？此操作不可撤销。",
      enterNewTitle: "请输入新的标题",
      like: "点赞",
      undoLike: "取消点赞",
      dislike: "点踩",
      undoDislike: "取消点踩",
      downloadAttachments: "下载附件",
      downloadFormats: "下载为格式",
      download: "下载",
      attachments: "附件",
    },
    favorites: "收藏",
    noFavorites: "暂无收藏",
    noFavoritesDescription:
      "您还没有收藏任何对话，开始聊天并收藏您喜欢的内容吧",
    startChat: "开始聊天",
    favoritesCount: "共 {count} 个收藏",
    openChat: "打开对话",
    refresh: "刷新",
    loveThis: "点赞",
    needsImprovement: "点踩",
    hideLog: "隐藏日志",
    showLog: "显示日志",
    downloadFile: "下载文件",
    testParallel: "测试并行对话",
    refreshReply: "刷新回复",
    refreshConversationGone: "这条对话已经不存在，请从侧边栏重新打开",
    abortTooltip: "中止回答",
    loadingAgentPerms: "加载智能体权限中……",
    agentPicker: {
      loading: "加载智能体权限中……",
      empty: "当前账号暂无可用智能体",
      noAvailableAgents: "当前账号暂无可用智能体。",
      auto: "自动选择",
      label: "选择智能体",
      searchPlaceholder: "搜索智能体……",
      noResults: "没有匹配的智能体",
      remove: "移除 {agent}",
    },
    log: {
      replyContent: "回复内容",
      execLog: "执行日志 (ID: {id})",
      activityLabel: "执行日志",
      updateLog: "更新日志",
      updateUnavailable: "无法更新",
      loading: "加载日志中……",
      contentColumn: "日志内容",
      noData: "暂无日志数据",
      unavailable: "日志不可用",
      fetchError: "加载日志失败",
      updateError: "更新日志失败",
      retry: "重试",
      reconnecting: "正在重新连接智能体日志……",
      pending: "智能体日志暂不可用。",
      terminalEmpty: "该智能体任务已完成，但没有日志。",
      truncated: "仅显示当前可用的日志内容。",
      historicalRefresh: "刷新历史日志",
    },
    lifecycle: {
      preparing: "准备中",
      resolving_inputs: "解析输入中",
      planning: "任务规划中",
      running: "运行中",
      finalizing: "最终整理中",
      succeeded: "已成功",
      failed: "失败",
      timed_out: "已超时",
      cancelled: "已取消",
      resultUnavailable: "任务已完成，但报告暂不可用。",
      childKindFallback: "子任务 {ordinal}",
      childKind: {
        analyst: "分析",
        research: "研究单元",
        network: "网络分析",
        design: "设计分析",
        protein_structure_analysis: "蛋白质结构",
        promoter_analysis: "启动子设计",
        protein_design_analysis: "蛋白质设计",
        promoter_design_analysis: "启动子设计",
        gene_network_analysis: "基因网络分析",
      },
      childError: {
        input_rejected: "该子任务因输入无效而被拒绝。",
        plan_rejected: "该子任务因计划无效而被拒绝。",
        remote_failed: "该子任务未成功。",
        remote_cancelled: "该子任务已取消。",
        fallback: "该子任务未成功。",
      },
    },
    logUpdatedSuccess: "日志更新成功",
    logUpdateFailed: "日志更新失败",
    logUpdateFailedRetry: "日志更新失败，请重试",
    liked: "已点赞",
    disliked: "已点踩",
    cancelled: "已取消",
    printFailed: "打印失败",
    transferCancel: "取消",
    transferEta: "约剩余 {seconds} 秒",
    transferSize: "{loaded} / {total}",
    transferProgress: "进行中的传输",
    transferPhase: {
      upload: "正在上传",
      download: "正在下载",
    },
    transferProgressText: "{phase}：{loaded} / {total}（{percent}%）",
    transferProgressIndeterminate: "{phase}：已传输 {loaded}",
    downloadCancelled: "已取消下载",
    downloadError: "下载过程中出错，请联系管理员！",
    resultArchive: {
      preparing: "正在准备结果归档",
      download: "下载 {name}",
      generationFailed: "结果归档生成失败",
      none: "已完成，无附件可下载",
      unavailable: "结果归档暂不可用",
      retry: "重试生成归档",
      retrying: "正在重试生成归档",
      retryFailed: "无法开始归档重试。",
      downloadFailed: "无法下载结果归档。",
    },
  },

  // 历史记录模块
  history: {
    noHistory: "暂无历史记录",
    noHistoryDescription:
      "您还没有任何聊天历史记录，开始聊天并查看您的对话历史吧",
    historyCount: "共 {count} 条历史记录",
    loadFailed: "加载历史记录失败",
  },

  // 收藏模块
  favorites: {
    loadFailed: "加载收藏失败",
    removedSuccess: "已取消收藏",
    removeFailed: "取消收藏失败",
    addedSuccess: "已添加到收藏",
  },

  // 个人资料管理模块
  profile: {
    title: "个人资料管理",
    description: "管理您的个人信息、账户安全和使用统计",
    basicInfo: {
      title: "基本信息",
      username: "用户名",
      email: "邮箱",
      phone: "手机号",
      organization: "所属机构",
      position: "职位",
    },
    security: {
      title: "账户安全",
      password: "登录密码",
      passwordDescription: "定期更换密码，确保账户安全",
      changePassword: "修改密码",
      permission: "用户权限",
      permissionDescription: "当前账户的权限级别",
      oldPassword: "旧密码",
      oldPasswordPlaceholder: "@:changePassword.oldPasswordPlaceholder",
      newPassword: "新密码",
      newPasswordPlaceholder: "@:changePassword.newPasswordPlaceholder",
      confirmPassword: "确认密码",
      confirmPasswordPlaceholder: "@:changePassword.confirmPasswordPlaceholder",
    },
    usage: {
      title: "使用统计",
      totalChats: "总对话数",
      lastLogin: "最后登录",
    },
    passwordChangeSuccess: "密码修改成功",
    passwordChangeFailed: "密码修改失败，请重试",
    userInfoNotFound: "未获取到用户信息",
    fetchUserInfoFailed: "获取用户信息失败",
    fetchUserInfoError: "获取用户信息失败",
  },

  // 网盘空间模块
  cloudStorage: {
    title: "网盘空间 (Beta)",
    description: "这是一个简化的预览版本。部分功能仍在开发中。",
    tryDemo: "体验演示",
  },

  // 日志管理
  log: {
    list: "日志列表",
  },

  // 权限管理
  permission: {
    title: "权限管理",
  },

  // 任务管理
  taskManager: {
    question: "问题",
    status: "状态",
    updated_at: "更新时间",
    downloadURL: "下载链接",
    dialogue_link: "跳转至对话",
    getFailed: "获取列表失败",
    logs: {
      fetchDataFailed: "获取数据列表失败",
    },
    operate: "操作",
    cancel: "取消",
    cancelFailed: "任务已无法取消",
  },

  // 用户反馈
  feedback: {
    placeholder: "请详细描述您的问题、建议或反馈……",
    submit: "提交反馈",
    submitSuccess: "反馈提交成功，感谢您的宝贵意见！",
    submitFailed: "提交失败，请重试",
    validation: {
      required: "请输入反馈内容",
      min: "反馈内容至少需要10个字符",
      max: "反馈内容不能超过1000个字符",
    },
  },

  // 全局策略配置
  globalConfig: {
    description: "管理系统全局策略和安全配置",
    systemSettings: "系统设置",
    basicSettings: "基础配置",
    securitySettings: "安全策略",
    featureSettings: "功能配置",
    systemName: "系统名称",
    systemNamePlaceholder: "请输入系统名称",
    maxFileSize: "最大文件大小",
    sessionTimeout: "会话超时时间",
    minutes: "分钟",
    passwordPolicy: "密码策略",
    requireUppercase: "必须包含大写字母",
    requireLowercase: "必须包含小写字母",
    requireNumbers: "必须包含数字",
    requireSymbols: "必须包含特殊字符",
    loginAttempts: "最大登录尝试次数",
    attempts: "次",
    ipWhitelist: "IP白名单",
    ipWhitelistPlaceholder: "请输入IP地址，每行一个",
    enableFileUpload: "启用文件上传",
    enableChatHistory: "启用聊天历史",
    maxChatHistory: "最大聊天历史记录数",
    records: "条",
    testConfig: "测试配置",
    configHistory: "配置历史",
    timestamp: "时间",
    operator: "操作人",
    changes: "变更内容",
    historyDetail: "历史详情",
    historyDetailContent: "时间：{time}\n操作人：{operator}\n变更：{changes}",
    saveSuccess: "配置保存成功",
    saveFailed: "配置保存失败",
    resetConfirm: "确定要重置所有配置为默认值吗？",
    resetSuccess: "配置重置成功",
    testUnavailable: "配置测试功能暂未接入后端",
  },

  // 智能体页面
  agents: {
    demo: {
      staticExample: "静态示例",
      questionLabel: "示例问题",
    },
    analyst: {
      title: "分析智能体",
      subtitle: "提交分析目标与数据集，生成结构化的生物信息学分析报告。",
      agentLabel: "分析流程",
      questionLabel: "分析问题",
      questionPlaceholder: "描述您需要的分析、物种与比较组",
      contextFilesLabel: "分析文件",
      contextFilesHint:
        "上传支持的文档或生物学数据，最多 {maxFiles} 个文件，每个文件不超过 {maxFileSize}。",
      submit: "开始分析运行",
      submitting: "正在提交…",
      reset: "开始新的运行",
      progress: "分析运行中",
      complete: "报告已就绪",
      degraded: "部分分析不可用，当前报告内容不完整。",
      unsupportedAssetFormat:
        "该智能体无法处理此数据格式；文件已完成上传，请选择该智能体支持的输入格式。",
      reportTitle: "分析报告",
      report: "报告",
      evidence: "证据",
      activity: "活动",
      downloads: "下载",
      download: "请求下载",
      noEvidence: "本次运行没有可用的结构化证据。",
      noDownloads: "本次运行没有可用的安全下载内容。",
      emptyReport: "分析报告尚未生成。",
      capabilityLoading: "正在检查分析能力…",
      unavailableTitle: "分析智能体暂不可用",
      unavailableMessage: "此路由受能力开关保护，尚未创建任何结果。",
      questionRequired: "提交前请输入分析问题。",
      questionTooLong: "分析问题过长。",
      submitFailed: "分析运行提交失败，请重试。",
      downloadFailed: "下载请求未能完成。",
      sectionsLabel: "分析报告分区",
    },
    data: {
      title: "数据智能体",
      subtitle: "数据智能体 - 提供多组学数据分析和处理服务",
      tableCaptions: {
        transcript: "静态示例输出 — 转录本 ID",
        cdsLength: "静态示例输出 — CDS 长度",
        homologs: "静态示例输出 — 同源基因",
      },
    },
    review: {
      title: "综述智能体",
      subtitle: "综述智能体 - 提供面向植物科研主题的结构化文献综述服务",
    },
    briefGene: {
      title: "基因综述智能体",
      subtitle: "基因综述智能体 - 提供基因功能与研究线索的快速综述服务",
    },
    knowledge: {
      title: "知识智能体",
      subtitle: "知识智能体 - 提供生物信息学知识查询和分析服务",
    },
    deepGenome: {
      title: "基因深度分析智能体",
      subtitle: "基因深度分析智能体 - 提供物种和基因的深度分析服务",
      taskCreated: "任务创建成功",
      downloadPDF: "下载 PDF",
      downloadMD: "下载 Markdown",
      imageViewerTitle: "图片查看",
      references: "参考文献",
      noReferences: "暂无参考文献。",
    },
    geneNetwork: {
      title: "基因网络智能体",
      subtitle: "基因网络智能体 - 提供基因网络分析和表型性状关联服务",
      sampleTask: "静态示例任务 ID",
      sampleResult: "静态示例结果",
      downloadResults: "开始下载请求",
      startingDownload: "正在启动第 {current} 个下载，共 {total} 个",
      allDownloadsStarted: "五个下载请求均已启动",
      agentLabel: "基因网络流程",
      questionLabel: "网络分析问题",
      questionPlaceholder: "描述您希望探索的性状网络分析",
      traitLabel: "植物性状本体目标",
      traitPlaceholder: "选择受支持的性状",
      speciesLabel: "物种",
      speciesPlaceholder: "选择受支持的物种",
      submit: "开始网络分析",
      submitting: "正在提交…",
      reset: "开始新的运行",
      progress: "基因网络分析运行中",
      complete: "基因网络报告已就绪",
      degraded: "部分分析不可用，当前基因网络报告内容不完整。",
      trackingDegraded: "运行跟踪降级，当前显示内容可能不是 Bot 的最新状态。",
      reportTitle: "基因网络报告",
      report: "报告",
      evidence: "证据",
      activity: "活动",
      downloads: "下载",
      download: "请求下载",
      noEvidence: "本次运行没有可用的结构化证据。",
      noDownloads: "本次运行没有可用的安全下载内容。",
      emptyReport: "基因网络报告尚未生成。",
      capabilityLoading: "正在检查基因网络能力…",
      unavailableTitle: "基因网络智能体暂不可用",
      unavailableMessage: "此路由受能力开关保护，尚未创建任何结果。",
      questionRequired: "提交前请输入网络分析问题。",
      questionTooLong: "网络分析问题过长。",
      traitValidation: "请选择受支持的植物性状本体目标。",
      speciesValidation: "请选择受支持的物种。",
      submitFailed: "基因网络分析提交失败，请重试。",
      downloadFailed: "下载请求未能完成。",
      sectionsLabel: "基因网络报告分区",
      traits: {
        nitrogenSensitivity: "氮敏感性",
        seedlingHeight: "幼苗高度",
        panicleLength: "穗长",
        harvestIndex: "收获指数",
        plantHeight: "植株高度",
        germinationRate: "发芽率",
      },
      species: {
        arabidopsis: "拟南芥",
        rice: "水稻",
        maize: "玉米",
        sorghum: "高粱",
        soybean: "大豆",
      },
    },
    digitalDesign: {
      title: "智能设计智能体",
      subtitle: "智能设计智能体 - 提供基于基因ID的蛋白质结构预测和设计服务",
      sampleTask: "静态示例任务 ID",
      sampleResult: "静态示例结果",
      downloadResults: "开始下载请求",
      agentLabel: "智能设计流程",
      questionLabel: "设计问题",
      questionPlaceholder: "描述您希望探索的蛋白质或启动子设计",
      geneIdLabel: "基因 ID",
      geneIdPlaceholder: "例如 AT1G01010",
      speciesCodeLabel: "物种代码",
      speciesCodePlaceholder: "例如 ath",
      contextFilesLabel: "上下文文件（可选）",
      contextFilesHint:
        "可上传任意格式的生物学数据或文本，最多 10 个文件，每个文件不超过 10 GiB。",
      submit: "开始设计运行",
      submitting: "正在提交…",
      reset: "开始新的运行",
      progress: "设计运行中",
      complete: "设计报告已就绪",
      degraded: "部分分析不可用，当前设计报告内容不完整。",
      unsupportedAssetFormat:
        "该智能体无法处理此数据格式；文件已完成上传，请选择该智能体支持的输入格式。",
      trackingDegraded: "运行跟踪降级，当前显示内容可能不是 Bot 的最新状态。",
      reportTitle: "智能设计报告",
      report: "报告",
      evidence: "证据",
      activity: "活动",
      downloads: "下载",
      download: "请求下载",
      noEvidence: "本次运行没有可用的结构化证据。",
      noDownloads: "本次运行没有可用的安全下载内容。",
      emptyReport: "设计报告尚未生成。",
      capabilityLoading: "正在检查智能设计能力…",
      unavailableTitle: "智能设计智能体暂不可用",
      unavailableMessage: "此路由受能力开关保护，尚未创建任何结果。",
      fileValidation:
        "部分文件未通过校验，请检查文件元数据和 10 GiB 大小限制。",
      fileCountValidation: "最多上传 10 个文件。",
      questionRequired: "提交前请输入设计问题。",
      questionTooLong: "设计问题过长。",
      geneIdValidation:
        "请输入有效的基因 ID，只能包含字母、数字、点、下划线或连字符，长度不超过 128 个字符。",
      speciesCodeValidation:
        "请输入有效的物种代码，只能包含小写字母、数字、下划线或连字符，长度不超过 32 个字符。",
      submitFailed: "设计运行提交失败，请重试。",
      downloadFailed: "下载请求未能完成。",
      sectionsLabel: "智能设计报告分区",
    },
    design: {
      title: "设计智能体",
      subtitle: "设计智能体 - 能力开关控制的智能设计流程兼容路由",
      unavailableTitle: "设计智能体暂未开放",
      unavailableMessage:
        "此旧路由暂不可用。能力开启后，请使用智能设计智能体路由。",
    },
    research: {
      title: "虚拟研究智能体",
      agentLabel: "研究流程",
      subtitle: "提交研究问题和上下文材料，生成可复核的研究报告。",
      questionLabel: "研究问题",
      questionPlaceholder: "描述您希望复现或探索的研究",
      contextFilesLabel: "论文与上下文文件",
      contextFilesHint:
        "可上传任意格式的论文或生物学数据，最多 {maxFiles} 个文件，每个文件不超过 {maxFileSize}。",
      submit: "开始研究运行",
      submitting: "正在提交…",
      reset: "开始新的运行",
      progress: "研究运行中",
      complete: "报告已就绪",
      degraded: "部分分析不可用，当前报告内容不完整。",
      unsupportedAssetFormat:
        "该智能体无法处理此数据格式；文件已完成上传，请选择该智能体支持的输入格式。",
      reportTitle: "研究报告",
      report: "报告",
      evidence: "证据",
      activity: "活动",
      downloads: "下载",
      download: "请求下载",
      noEvidence: "本次运行没有可用的结构化证据。",
      noDownloads: "本次运行没有可用的安全下载内容。",
      emptyReport: "研究报告尚未生成。",
      capabilityLoading: "正在检查研究能力…",
      unavailableTitle: "研究智能体暂不可用",
      unavailableMessage: "此路由受能力开关保护，尚未创建任何结果。",
      fileValidation:
        "部分文件未通过校验，请检查文件元数据和 10 GiB 大小限制。",
      fileCountValidation: "最多上传 10 个文件。",
      questionRequired: "提交前请输入研究问题。",
      questionTooLong: "研究问题过长。",
      submitFailed: "研究运行提交失败，请重试。",
      downloadFailed: "下载请求未能完成。",
      sectionsLabel: "研究报告分区",
    },
  },

  // 帮助中心
  help: {
    title: "帮助中心",
    tableOfContents: "目录",
    goBackTokenExpired: "登录已过期，请重新登录",
    goBackFailed: "返回上一页失败",
    toc: {
      whatIs: "什么是农科发现大模型？",
      gettingStarted: "快速开始",
      howItWorks: "农科发现大模型如何工作？",
      resources: "农科发现大模型整合了哪些资源？",
      limitations: "使用限制与最佳实践",
    },
    doc: {
      whatIs: {
        heading: "1. 什么是农科发现大模型？",
        body: `农科发现大模型是一套面向植物科学发现与设计的智能体式 AI 系统，能够帮助研究人员显著加速科学发现，包括：

-   以自然语言直接回答各类科学问题；
-   从超过 400 万篇全文科学文献中挖掘洞见，提取可靠结论，并给出带来源引用的直接答案；
-   整合并分析覆盖 65 个植物物种的 14 类组学数据，生成精准的数字化洞见；
-   接收用户提交的数据与任务需求，自主规划并执行生物信息学分析；

在这些核心能力之上，农科发现大模型可以完成复杂的科研任务，包括但不限于：

-   自动整合文献并生成领域综述报告；
-   整合多维信息解析基因功能并撰写专业报告；
-   自动化复现已发表科研工作的关键步骤；
-   发现新的生物学通路（如激素-基因-表型网络分析）；
-   设计与优化等位基因和蛋白质（包括基因启动子与蛋白质工程）；
-   **……**`,
      },
      gettingStarted: {
        heading: "2. 快速开始：如何使用农科发现大模型",
        body: `使用农科发现大模型是一个对话式、任务驱动的过程。按照以下简单步骤即可开始您的研究：

### 第一步：明确并提交您的问题

开始使用农科发现大模型时，第一步是清晰地明确您的研究问题。您需要选择对应的 **智能体** 按钮，并尽可能精确地描述您的具体目标——无论涉及文献检索、数据提取还是分析任务。清晰、详细的指令能确保农科发现大模型准确把握您的研究需求并交付高质量结果。

### 第二步：监控并管理您的任务

提交问题后，您可以通过 **任务管理** 模块实时监控其进度。该模块提供已提交任务的概览，包括原始问题、任务状态和最近更新时间。

### 第三步：查看并探索结果

任务完成后，您可以直接在系统中查看结果。例如，在探索特定基因时，深度基因收录模块提供针对目标基因的全面、整合视图，包括基本信息、文献摘要、互作网络和表达热图。您可以下载结果以供进一步使用，或将其导出为不同格式。为便于长期研究，已完成的任务还可收藏保存，方便您随时回顾和复用。`,
      },
      howItWorks: {
        heading: "3. 农科发现大模型如何工作？理解其架构与能力",
        body: `### 双 LLM 核心

**Phytomni-Hub** 模块是整个系统的中枢智能。该模块整合了两个领域专用大语言模型——**Phyto-Chatbot** 与 **Phyto-Reasoner**，二者均基于农科发现大模型资源模块的知识进行预训练，并以高质量数据微调。**Phyto-Chatbot** 负责意图识别与发起数据检索，**Phyto-Reasoner** 负责推理、规划与知识综合。两者协同工作，支撑自动化的生物信息学操作。

### AI 智能体团队及其应用

农科发现大模型通过编排一支专业智能体团队来完成任务。以下是每个智能体的职责及其使用方式：

-   **对话智能体** 是您与农科发现大模型交互的主要对话界面。它以自然语言回答各类研究问题，解释复杂的生物学概念，并就实验设计或数据分析提供指导，帮助研究人员无需手动检索多个数据库即可快速获得可操作的洞见。

-   **知识智能体** 构建于跨越百年的农业知识库之上，整合了超过 400 万篇全文文献、2700 万篇摘要和近 20 万份结构化专利。它支持自然语言查询以检索和提取全文信息，生成带完整来源引用的循证答案——将碎片化的植物研究转化为可访问、权威的发现基础。

-   **数据智能体** 由覆盖 65 个植物物种和 14 类组学数据的多组学数据库驱动。它统一了 21 种标识符类型，纠正错误、去除冗余并标准化条目，能将您的自然语言查询智能转换为精确的数据库查询（SQL），以提取、交叉关联并可视化以基因为中心或系统层级的生物学数据，实现对植物基因组、表达谱和蛋白质互作的无缝探索。

-   **分析智能体** 如同一位自动化的生物信息学家，集成了 120 余种精选生物信息学工具。它规划并执行复杂任务（如序列分析或基因表达谱分析），将经专家验证的流程嵌入易用界面，无需手动安装或配置软件即可实现端到端的多组学分析。

-   **综述智能体** 针对特定研究主题自动生成全面的文献综述。它解析用户查询以构建综述计划，借助知识智能体通过迭代检索收集多模态证据，并利用其推理能力将信息组织为带引用支撑的报告，节省数周的人工整理工作，为课题申请、论文发表或实验设计提供即用型基础。

-   **虚拟研究智能体** 通过协调其他智能体，实现已发表研究的自动化复现。它还能生成 \`reproduce.sh\` 脚本，从干净环境一键重新执行工作流，确保科学可复现性。除复现外，它还支持探索性分析——研究人员可修改数据集、参数或物种以验证发现或探索新假设，既是复现引擎，也是假设检验平台。

-   **基因网络智能体** 接受用户自定义的基因列表，识别互作伙伴、调控关系和功能关联。它将这些信息综合为连贯的网络（如激素-基因-表型图谱），实现按需构建候选基因网络，帮助揭示生物学通路并将分子互作与表型关联起来。

-   **基因综述智能体** 为目标基因快速生成带引用依据的研究概览，归纳已知功能、关键证据和可继续验证的研究线索，适合在启动完整基因报告前快速建立方向。

-   **基因深度分析智能体** 通过整合文献、多组学数据和网络信息，为目标基因生成深入的功能综述。其最终产出是一份以基因为中心的综述报告，涵盖基因功能、调控、已知变异及潜在育种应用——为研究人员提供一站式参考。

-   **智能设计智能体** 借助其他智能体进行等位基因与蛋白质工程。通过自然语言查询，它支持蛋白质序列改造和基因启动子优化，预测有益突变，并生成具有增强性状的蛋白质变体。它衔接计算设计与实验验证，加速合成生物学、功能基因组学和作物改良。

### 如何选择合适的输入

**推荐起始输入与附件说明：**

-   **对话智能体：** 明确的科研问题，并补充物种与实验背景。可选用受支持的文档或图片补充上下文。
-   **知识智能体：** 文献问题、关键词、时间范围和证据范围。可选用受支持的文档限定证据范围。
-   **数据智能体：** 物种、基因或其他实体标识符，以及希望查询的字段或关系。它直接查询内置生物数据库，无需上传表格。
-   **分析智能体：** 分析目标、数据类型、物种，以及每个数据集的说明或位置。仅使用该智能体明确提供的数据集入口。
-   **综述智能体：** 综述主题、范围、物种、时间范围和报告重点。可选用受支持的文档作为综述起点。
-   **虚拟研究智能体：** 待复现的论文或假设、预期结果及数据集说明或位置。仅使用该智能体明确提供的数据集入口。
-   **基因网络智能体：** 基因列表、物种，以及可选的性状或表型标识符。按提示说明每个列表或数据集的含义。
-   **基因综述智能体：** 基因标识符、物种和希望快速了解的方向。可选用受支持的文档补充本地证据。
-   **基因深度分析智能体：** 基因标识符、物种，以及希望关注的功能或育种方向。综合使用内置文献与多组学证据。
-   **智能设计智能体：** 目标基因或蛋白质序列、设计目标和实验约束。仅使用该智能体明确提供的序列或数据集入口。

通用对话附件当前支持 PDF、Word、Excel、PowerPoint、TXT 和 PNG 文件，最多 10 个，单个文件不超过 25 MB，总计不超过 50 MB。CSV 不是所有对话智能体通用的附件格式；仅当某个智能体的数据集入口明确标注支持 CSV 时使用。`,
      },
      resources: {
        heading: "4. 农科发现大模型整合了哪些资源？",
        body: `-   **知识库**：收录 1900—2025 年间发表的 400 余万篇农业与植物生物学全文研究论文，以及超过 2700 万篇摘要和近 20 万份专利。
-   **生物数据库**：覆盖 65 个植物物种（包括水稻、玉米、小麦、大豆、*拟南芥* 等）和 14 种组学方法（如基因组学、转录组学、表观组学、表型组学等）。
-   **生物信息学工具箱**：包含 125 种生物信息学工具，其中 25 个模型和 100 个命令行工具，涵盖多种生物学场景。`,
      },
      limitations: {
        heading: "5. 使用限制与最佳实践",
        body: `-   **实验验证不可或缺：** 尽管农科发现大模型提供强大的 *计算机模拟* 预测，其输出可能存在理论空白或需要真实场景背景。通过实验验证其建议，对于保证其在实际场景中的可靠性至关重要。
-   **迭代优化是关键：** 对于复杂任务，请根据初步结果和反馈优化您的查询、输入参数或提示词，逐步提升输出的相关性与质量。
-   **提供具体背景：** 提供详细背景（如任务目标、物种、实验条件、背景信息），帮助 AI 清晰理解您的意图，减少歧义并提高回答准确度。`,
      },
    },
  },
};
