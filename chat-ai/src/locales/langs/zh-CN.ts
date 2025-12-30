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
    confirm: '确认',
    cancel: '取消',
    search: '搜索',
    add: '新增',
    edit: '编辑',
    delete: '删除',
    success: '成功',
    failed: '失败',
    warning: '警告',
    info: '信息',
    loading: '加载中',
    noData: '暂无数据',
    save: '保存',
    reset: '重置',
    back: '返回',
    more: '更多',
    submit: '提交',
    close: '关闭',
    view: '查看',
    index: '序号',
    operation: '操作',
    running: '运行中',
    waiting: '等待中',
    finished: "已完成",
    Tip: "(AI 生成)"
  },

  // 应用信息
  app: {
    title: '农科院育种大模型智能平台',
  },

  // 互动教程
      tutorial: {
      step1: {
        title: '欢迎使用 Phytomni！',
        content: '首先，让我们了解一下导航功能。快速访问功能："开始新对话"启动全新任务，"基因展示"让您查看基因信息，"收藏夹"用于收集常用内容，还有按时间分类的历史交互记录，帮助您高效查找过往记录。',
        button: '点击"下一步"继续探索！'
      },
      step2: {
        title: '智能代理演示',
        content: '底部的这些按钮是不同智能代理的演示。您可以点击查看具体使用案例。',
        button: '点击"下一步"了解对话区域。'
      },
      step3: {
        title: '对话窗口',
        content: '这是与 Phytomni 交流的"窗口"。您可以直接输入问题，或者自主选择不同的智能助手，如"ChatAgent"和"KnowledgeAgent"。试试点击输入框。准备好开始探索了吗？',
        button: '点击"完成"结束引导！'
      },
      nextStep: '下一步',
      prevStep: '上一步',
      complete: '完成',
      skip: '跳过教程',
      startTutorial: '开始教学',
      restartTutorial: '重新开始教学',
      navigationHint: '💡 提示：使用 ← → 方向键或空格键导航，ESC键退出'
    },

  // 菜单
  menu: {
    geneDisplay: '基因展示',
    favorites: '收藏夹',
    feedback: '用户反馈',
    userList: '用户列表',
    logList: '系统监控',
    permissionManage: '权限管理',
    taskManager: '任务管理',
    globalConfig: '全局策略配置',
    adminManagement: '管理员管理'
  },

  // 错误码
  errorCode: {
    401: '认证失败，无法访问系统资源',
    403: '当前操作没有权限',
    404: '访问资源不存在',
    default: '系统未知错误，请反馈给管理员',
  },

  // 修改密码
  changePassword: {
    usernamePlaceholder: '请输入用户名',
    oldPassword: '旧密码',
    oldPasswordPlaceholder: '请输入旧密码',
    newPassword: '新密码',
    newPasswordPlaceholder: '请输入新密码',
    confirmPassword: '确认新密码',
    confirmPasswordPlaceholder: '请再次输入新密码',
    confirm: '确认修改',
    success: '密码修改成功！',
    usernameRequired: '请输入用户名',
    oldPasswordRequired: '请输入旧密码',
    newPasswordRequired: '请输入新密码',
    confirmPasswordRequired: '请再次输入新密码',
    passwordMinLength: '密码长度不能小于6个字符',
    passwordMinLength8: '密码长度不能小于8个字符',
    passwordNeedUppercase: '密码必须包含大写字母',
    passwordNeedLowercase: '密码必须包含小写字母',
    passwordNeedNumber: '密码必须包含数字',
    passwordNeedSpecial: '密码必须包含特殊符号',
    passwordSame: '新密码不能与旧密码相同',
    passwordMismatch: '两次输入的密码不一致',
    formValidationFailed: '请检查表单填写是否正确',
  },

  // 登录模块
  login: {
    title: 'Phytomni',
    subtitle: 'A multi-agent system for scientific discovery and plant design',
    registerTitle: '注册育种智能平台',
    email: '邮箱',
    emailPlaceholder: '请输入邮箱地址',
    password: '密码',
    passwordPlaceholder: '8-16个字符长，区分大小写',
    forgotPassword: '忘记密码?',
    loginButton: '登 录',
    registerButton: '注 册',
    noAccount: '没有账户?',
    hasAccount: '已有账户?',
    register: '注册',
    login: '登录',
    loginSuccess: '登录成功',
    registerSuccess: '注册成功',
    loginFailed: '登录失败',
    registerFailed: '注册失败',
    passwordWarningTitle: '密码安全提醒',
    accountLockedTitle: '账户已锁定',
    accountLockedMessage: '由于多次登录失败，您的账户已被锁定 {minutes} 分钟，请稍后再试。',
    remainingAttempts: '登录失败，您还有 {count} 次尝试机会',
    firstLoginTitle: '首次登录提醒',
    firstLoginMessage: '检测到您是首次登录，为了账户安全，请先修改初始密码。',
    agreement: {
      prefix: '登录即表示您同意我们的',
      terms: '服务条款',
      and: '和',
      privacy: '隐私政策',
    },
    validation: {
      emailRequired: '请输入邮箱地址',
      emailFormat: '请输入正确的邮箱格式',
      passwordRequired: '请输入密码',
      passwordLength: '密码长度在8-16个字符之间',
    },
    slogan: {
      main: '用生命科学基础大模型',
      sub: '解码生命',
    },
  },

  // 注册模块
  register: {
    title: '注册账户',
    subtitle: '创建您的Phytomni账户',
    email: '邮箱',
    emailPlaceholder: '请输入邮箱地址',
    password: '密码',
    passwordPlaceholder: '请输入密码',
    confirmPassword: '确认密码',
    confirmPasswordPlaceholder: '请再次输入密码',
    registerButton: '注 册',
    haveAccount: '已有账户?',
    login: '登录',
    agreement: {
      prefix: '注册即表示您同意我们的',
      terms: '服务条款',
      and: '和',
      privacy: '隐私政策',
    },
    validation: {
      emailRequired: '请输入邮箱地址',
      emailFormat: '请输入正确的邮箱格式',
      passwordRequired: '请输入密码',
      passwordLength: '密码长度在8-16个字符之间',
      passwordMinLength8: '密码长度不能小于8个字符',
      passwordMaxLength16: '密码长度不能超过16个字符',
      passwordNeedUppercase: '密码必须包含大写字母',
      passwordNeedLowercase: '密码必须包含小写字母',
      passwordNeedNumber: '密码必须包含数字',
      passwordNeedSpecial: '密码必须包含特殊符号',
      confirmPasswordRequired: '请确认密码',
      confirmPasswordMismatch: '两次输入的密码不一致',
      formValidationFailed: '请检查表单填写是否正确',
    },
  },

  // 忘记密码模块
  forgotPassword: {
    title: '忘记密码',
    subtitle: '重置您的账户密码',
    email: '邮箱',
    emailPlaceholder: '请输入注册时的邮箱地址',
    verificationCode: '验证码',
    codePlaceholder: '请输入验证码',
    newPassword: '新密码',
    newPasswordPlaceholder: '请输入新密码',
    confirmPassword: '确认密码',
    confirmPasswordPlaceholder: '请再次输入新密码',
    sendResetEmail: '发送重置邮件',
    verifyCode: '验证验证码',
    resetPassword: '重置密码',
    backToLogin: '返回登录',
    successTitle: '密码重置成功',
    successMessage: '您的密码已成功重置，请使用新密码登录',
    agreement: {
      prefix: '重置密码即表示您同意我们的',
      terms: '服务条款',
      and: '和',
      privacy: '隐私政策',
    },
    validation: {
      emailRequired: '请输入邮箱地址',
      emailFormat: '请输入正确的邮箱格式',
      codeRequired: '请输入验证码',
      codeLength: '验证码长度在4-6位之间',
      passwordRequired: '请输入新密码',
      passwordLength: '密码长度在8-16个字符之间',
      confirmPasswordRequired: '请确认新密码',
      confirmPasswordMismatch: '两次输入的密码不一致',
    },
  },

  // 用户管理
  user: {
    list: '用户列表',
    add: '新增用户',
    edit: '编辑用户',
    username: '用户名',
    password: '密码',
    role: '角色',
    roleSelect: '请选择角色',
    superAdmin: '超级管理员',
    admin: '管理员',
    normalUser: '普通用户',
    addSuccess: '新增成功',
    editSuccess: '编辑成功',
    addFailed: '新增失败',
    editFailed: '编辑失败',
    detail: '用户详情',
    changePassword: '修改密码',
    feedback: '用户反馈',
    logout: '登出',
    history: '历史记录',
    profile: '个人资料',
    cloudStorage: '网盘空间',
    systemMonitor: '系统监控',
    globalConfig: '全局策略配置',
    adminManagement: '管理员管理',
    unlock: '解锁',
    unlockConfirmTitle: '解锁用户',
    unlockConfirmMessage: '确定要解锁用户 {email} 吗？',
    unlockSuccess: '用户解锁成功',
    unlockFailed: '用户解锁失败',
    phone: '手机号',
    phonePlaceholder: '请输入手机号',
    organization: '所属机构',
    organizationPlaceholder: '请输入所属机构',
    position: '职位',
    positionPlaceholder: '请输入职位',
    lastLoginAt: '最后登录',
    notLoggedIn: '未登录',
    validation: {
      emailRequired: '请输入用户名',
      emailFormat: '请输入正确的邮箱地址',
      passwordRequired: '请输入密码',
      passwordLength: '长度在8到16个字符',
      passwordMinLength8: '密码长度不能小于8个字符',
      passwordMaxLength16: '密码长度不能超过16个字符',
      passwordNeedUppercase: '密码必须包含大写字母',
      passwordNeedLowercase: '密码必须包含小写字母',
      passwordNeedNumber: '密码必须包含数字',
      passwordNeedSpecial: '密码必须包含特殊符号',
      roleRequired: '请选择角色',
      formValidationFailed: '请检查表单填写是否正确',
    },
    logs: {
      formValidationFailed: '表单验证失败',
    },
  },

  // 基因展示
  gene: {
    title: '基因详情',
    id: 'ID',
    loadFailed: '加载失败',
    summary: '概要',
    details: '详细内容',
    notFound: '未找到基因详情',
    searchPlaceholder: '请输入生物代码进行搜索',
    getFailed: '获取基因详情失败',
    geneName: '文件名称',
    description: '描述',
    synopsis: '概要',
    biocode: '生物代码',
    geneId: '基因ID',
    picture: '图片',
    logs: {
      fetchDataFailed: '获取数据失败:',
      fetchDetailFailed: '获取基因详情失败:',
    },
  },

  // 聊天模块
  chat: {
    title: '使用说明',
    appTitle: 'Phytomni',
    welcome: '欢迎使用，可直接输入您想问的问题',
    inputPlaceholder: '请输入您的问题...',
    send: '发 送',
    detailInfo: '详细信息',
    relatedLinks: '相关链接',
    newChat: '开启新对话',
    knowledgeBase: '知识库',
    geneDetail: '基因展示',
    thinkingSteps: '思考步骤',
    useTool: '使用工具',
    stepResult: '步骤结果',
    finalAnswer: '最终回答',
    sendFailed: '发送消息失败，请稍后重试。',
    generationStopped: '已停止生成',
    relatedDocuments: '参考资料',
    welcomeTitle: "嗨，我是Phytomni，很高兴见到您！",
    welcomeSubtitle: "我可以检索信息并为您执行自动化分析，请随时给我您的任务。",
    inputPlaceholderTip: '请输入您的问题',
    uploadFile: '支持文件上传(最多10个，接受.pdf,.doc,.xlsx,.ppt,.txt,.png)',
    timeGroup: {
      today: '今天',
      yesterday: '昨天',
      week: '7 天内',
      older: '一周前',
    },
    features: {
      title: '您可以使用，我们提供',
      research: '深度研究',
      analysis: '生物分析',
      knowledge: '知识检索',
      design: '数据设计',
      organize: '数据整理',
      assistant: '实验助手',
    },
    agents: {
      title: '智能代理',
      description: '功能描述',
      capabilities: '核心能力',
      usage: '使用方法',
      RAG: 'RAG',
      BI: 'BI',
      GA: 'GA',
      search: '联网搜索',
      geneFunction: '基因功能代理',
      review: '审查代理人',
      chatAgent: '您的农业科研智能助手，用自然语言解答各类研究问题。',
      knowledgeAgent: '提供权威农业知识库，精准匹配科研需求。',
      dataAgent: '高效管理海量农业数据，助力高效分析。',
      analystAgent: '从数据到洞察，一键生成农业研究分析结果。',
      reviewAgent: '自动整合文献，生成领域综述报告，快速把握研究趋势。',
      deepGenomeAgent: '解析植物基因组，为育种研究提供智能支持。',
      inSilicoResearchAgent: '通过数字模拟加速农业实验，降低研发成本。',
      geneNetworkAgent: '解析基因调控网络，揭示农作物抗逆性与高产的关键通路。',
      digitalDesignAgent: '智能化设计基因启动子与蛋白质结构，为合成生物学和分子育种提供精准方案。',
    },
    suggestions: {
      brca1: 'BRCA1基因突变会导致乳腺癌的发生率有多少?',
      mapk: 'MAPK信号通路在细胞生长分化中的作用有哪些?',
      tp53: 'TP53基因的突变会造成哪些疾病?',
    },
    links: {
      brca1: 'BRCA1基因与乳腺癌研究',
      mapk: 'MAPK信号通路详解',
      tp53: 'TP53基因数据库',
    },
    logs: {
      openChatAgent: '打开聊天代理',
      openKnowledgeAgent: '打开知识代理人',
      openDatabaseAgent: '打开数据库代理',
      openAnalysisAgent: '打开分析代理',
      openGeneFunctionAgent: '打开基因功能代理',
      openReviewAgent: '打开审查代理人',
      openKnowledgeBase: '打开知识库',
      sendMessageFailed: '发送消息失败:',
    },
    downloadURL: "下载链接",
    copySuccess: '复制成功',
    copyFailed: "复制失败",
    copy: '复制',
    ladingInner: '正在处理您的请求：检索数据、分析信息并生成回答，请稍候',
    footer: '内容由 AI 生成，请仔细甄别。',
    followUpQuestions: '问题建议：',
    more: '更多',
    actions: {
      rename: '重命名',
      favorite: '收藏',
      unfavorite: '取消收藏',
      delete: '删除',
      deleteConfirm: '确认删除',
      deleteWarning: '确定要删除这个对话吗？此操作不可撤销。',
      enterNewTitle: '请输入新的标题',
      titleRequired: '标题不能为空',
    },
    favorites: '收藏',
    favoritesDescription: '管理您收藏的对话，快速访问重要内容',
    noFavorites: '暂无收藏',
    noFavoritesDescription: '您还没有收藏任何对话，开始聊天并收藏您喜欢的内容吧',
    startChat: '开始聊天',
    favoritesCount: '共 {count} 个收藏',
    openChat: '打开对话',
    refresh: '刷新',
  },

  // 历史记录模块
  history: {
    noHistory: '暂无历史记录',
    noHistoryDescription: '您还没有任何聊天历史记录，开始聊天并查看您的对话历史吧',
    historyCount: '共 {count} 条历史记录',
  },

  // 个人资料管理模块
  profile: {
    title: '个人资料管理',
    description: '管理您的个人信息、账户安全和使用统计',
    basicInfo: {
      title: '基本信息',
      username: '用户名',
      email: '邮箱',
      phone: '手机号',
      organization: '所属机构',
      position: '职位',
    },
    security: {
      title: '账户安全',
      password: '登录密码',
      passwordDescription: '定期更换密码，确保账户安全',
      changePassword: '修改密码',
      permission: '用户权限',
      permissionDescription: '当前账户的权限级别',
      oldPassword: '旧密码',
      oldPasswordPlaceholder: '请输入旧密码',
      newPassword: '新密码',
      newPasswordPlaceholder: '请输入新密码',
      confirmPassword: '确认密码',
      confirmPasswordPlaceholder: '请再次输入新密码',
    },
    usage: {
      title: '使用统计',
      totalChats: '总对话数',
      totalFiles: '总文件数',
      storageUsed: '已用存储',
      lastLogin: '最后登录',
    },
  },

  // 网盘空间模块
  cloudStorage: {
    totalFiles: '总文件数',
    usedStorage: '已用存储',
    availableStorage: '可用存储',
    usagePercentage: '使用率',
    storageUsage: '存储使用情况',
    uploadFiles: '上传文件',
    createFolder: '创建文件夹',
    searchPlaceholder: '搜索文件或文件夹...',
    viewMode: {
      list: '列表视图',
      grid: '网格视图',
    },
    noFiles: '暂无文件',
    noFilesDescription: '当前文件夹为空，上传您的第一个文件或创建文件夹开始使用',
    uploadFirstFile: '上传第一个文件',
    folderName: '文件夹名称',
    folderNamePlaceholder: '请输入文件夹名称',
    newName: '新名称',
    newNamePlaceholder: '请输入新名称',
    actions: {
      download: '下载',
      rename: '重命名',
      move: '移动',
      share: '分享',
      delete: '删除',
      deleteConfirm: '确认删除',
      deleteWarning: '确定要删除这个文件吗？此操作不可撤销。',
    },
  },

  // 日志管理
  log: {
    list: '日志列表',
  },

  // 权限管理
  permission: {
    title: '权限管理',
  },

  // 分页
  pagination: {
    total: '共 {total} 条',
    jump: '前往',
    page: '页',
    item: '条/页',
    items: '条',
  },
  // 任务管理
  taskManager: {
    question: '问题',
    status: "状态",
    updated_at: '更新时间',
    downloadURL: '下载链接',
    dialogue_link: '跳转至对话',
    getFailed: '获取列表失败',
    logs: {
      fetchDataFailed: '获取数据列表失败'
    },
    operate: '操作',
  },

  // 用户反馈
  feedback: {
    title: '用户反馈',
    description: '我们非常重视您的意见和建议，请告诉我们您的想法',
    placeholder: '请详细描述您的问题、建议或反馈...',
    submit: '提交反馈',
    submitSuccess: '反馈提交成功，感谢您的宝贵意见！',
    submitFailed: '提交失败，请重试',
  },

  // 全局策略配置
  globalConfig: {
    description: '管理系统全局策略和安全配置',
    systemSettings: '系统设置',
    basicSettings: '基础配置',
    securitySettings: '安全策略',
    featureSettings: '功能配置',
    systemName: '系统名称',
    systemNamePlaceholder: '请输入系统名称',
    maxFileSize: '最大文件大小',
    sessionTimeout: '会话超时时间',
    minutes: '分钟',
    passwordPolicy: '密码策略',
    requireUppercase: '必须包含大写字母',
    requireLowercase: '必须包含小写字母',
    requireNumbers: '必须包含数字',
    requireSymbols: '必须包含特殊字符',
    loginAttempts: '最大登录尝试次数',
    attempts: '次',
    ipWhitelist: 'IP白名单',
    ipWhitelistPlaceholder: '请输入IP地址，每行一个',
    enableRegistration: '启用用户注册',
    enableFileUpload: '启用文件上传',
    enableChatHistory: '启用聊天历史',
    maxChatHistory: '最大聊天历史记录数',
    records: '条',
    testConfig: '测试配置',
    configHistory: '配置历史',
    timestamp: '时间',
    operator: '操作人',
    changes: '变更内容',
    historyDetail: '历史详情',
    saveSuccess: '配置保存成功',
    saveFailed: '配置保存失败',
    resetConfirm: '确定要重置所有配置为默认值吗？',
    resetSuccess: '配置重置成功',
    testSuccess: '配置测试通过',
    testFailed: '配置测试失败',
  },

  // 智能体页面
  agents: {
    analyst: {
      title: 'Analyst Agent',
      subtitle: '分析智能体 - 提供生物信息学数据分析和解读服务'
    },
    data: {
      title: 'Data Agent', 
      subtitle: '数据智能体 - 提供多组学数据分析和处理服务'
    },
    briefReview: {
      title: 'Brief Review Agent',
      subtitle: '简要综述智能体 - 提供研究主题的快速综述和总结服务'
    },
    knowledge: {
      title: 'Knowledge Agent',
      subtitle: '知识智能体 - 提供生物信息学知识查询和分析服务'
    },
    deepGenome: {
      title: 'Deep Genome Agent',
      subtitle: '深度基因组智能体 - 提供物种和基因的深度分析服务'
    },
    geneNetwork: {
      title: 'Gene Network Agent',
      subtitle: '基因网络智能体 - 提供基因网络分析和表型性状关联服务'
    },
    digitalDesign: {
      title: 'Digital Design Agent',
      subtitle: '数字设计智能体 - 提供基于基因ID的蛋白质结构预测和设计服务'
    }
  },

  // 帮助中心
  help: {
    title: '帮助中心',
    subtitle: 'Phytomni 使用指南与功能说明',
    quickStart: {
      title: '快速开始',
      step1: {
        title: '登录系统',
        description: '使用您的邮箱和密码登录 Phytomni 平台'
      },
      step2: {
        title: '开始对话',
        description: '在聊天界面输入您的问题，AI 助手将为您提供专业回答'
      },
      step3: {
        title: '上传文件',
        description: '支持上传 PDF、Word、Excel 等格式文件进行分析'
      },
      step4: {
        title: '使用智能代理',
        description: '选择不同的专业代理来协助您完成特定任务'
      }
    },
    features: {
      title: '核心功能',
      research: {
        title: '深度研究',
        description: '基于海量文献和数据库进行深度研究分析',
        item1: '文献检索与综述',
        item2: '研究趋势分析',
        item3: '专家知识整合'
      },
      analysis: {
        title: '生物分析',
        description: '专业的生物信息学分析工具和算法',
        item1: '基因功能分析',
        item2: '蛋白质结构预测',
        item3: '代谢通路分析'
      },
      design: {
        title: '数据设计',
        description: '智能化的实验设计和数据分析方案',
        item1: '实验方案设计',
        item2: '数据可视化',
        item3: '结果解释与建议'
      }
    },
    agents: {
      title: '智能代理',
      capabilities: '核心能力',
      usage: '使用方法',
      chat: {
        name: '聊天代理',
        description: '您的AI助手，用自然语言解答植物科学研究问题',
        capability1: '自然语言理解',
        capability2: '多轮对话',
        capability3: '上下文记忆',
        usage: '直接输入问题，获得专业回答和建议'
      },
      knowledge: {
        name: '知识代理',
        description: '提供权威的植物科学知识库和文献检索',
        capability1: '知识检索',
        capability2: '文献分析',
        capability3: '专家知识整合',
        usage: '查询特定领域的专业知识和最新研究进展'
      },
      data: {
        name: '数据代理',
        description: '处理和分析植物相关的各类数据',
        capability1: '数据处理',
        capability2: '统计分析',
        capability3: '结果可视化',
        usage: '上传数据文件，获得专业的分析结果和图表'
      },
      analysis: {
        name: '分析代理',
        description: '提供深度的生物信息学分析服务',
        capability1: '基因分析',
        capability2: '蛋白质分析',
        capability3: '代谢分析',
        usage: '输入基因序列或蛋白质信息，获得详细的功能分析'
      }
    },
    tips: {
      title: '使用技巧',
      question: {
        title: '提问技巧',
        description: '使用具体、清晰的问题描述，可以获得更准确的回答'
      },
      upload: {
        title: '文件上传',
        description: '支持多种格式文件，建议文件大小不超过10MB'
      },
      followup: {
        title: '追问功能',
        description: '基于AI的回答，可以继续深入提问获得更详细的信息'
      },
      save: {
        title: '保存对话',
        description: '重要对话可以收藏保存，方便后续查看和分享'
      }
    },
    faq: {
      title: '常见问题',
      q1: {
        question: '如何获得更准确的回答？',
        answer: '建议您提供具体、详细的问题描述，包括相关的背景信息和具体需求。同时可以上传相关的文档或数据文件来获得更精准的分析结果。'
      },
      q2: {
        question: '支持哪些文件格式？',
        answer: '我们支持 PDF、Word、Excel、PowerPoint、TXT、PNG 等常见格式的文件上传，单个文件大小建议不超过10MB。'
      },
      q3: {
        question: '如何选择合适的智能代理？',
        answer: '根据您的具体需求选择：聊天代理用于一般问答，知识代理用于文献检索，数据代理用于数据分析，分析代理用于生物信息学分析。'
      },
      q4: {
        question: '数据安全如何保障？',
        answer: '我们采用企业级安全措施保护您的数据，包括数据加密、访问控制、定期备份等，确保您的数据安全和隐私保护。'
      }
    },
    contact: {
      title: '联系我们',
      email: '技术支持邮箱',
      documentation: '在线文档',
      documentationDesc: '查看详细的使用文档和API说明'
    }
  },
};
