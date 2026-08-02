import { zhCNCommandPaletteMessages } from "./zh-cn-command-palette.js";
import { zhCNComposerMessages } from "./zh-cn-composer.js";
import { zhCNExtensionPackageMessages } from "./zh-cn-extension-packages.js";
import { zhCNOperationMessages } from "./zh-cn-operation.js";
import { zhCNRuntimeMessages } from "./zh-cn-runtime.js";

export const zhCNMessages = {
  common: {
    appName: "π",
    cancel: "取消",
    close: "关闭",
    stop: "停止"
  },
  settings: {
    groups: {
      personal: "个人",
      application: "应用",
      pi: "Pi",
      support: "支持"
    },
    sections: {
      account: {
        label: "账户",
        summary: "管理登录状态、账户同步与本地数据边界。"
      },
      general: {
        label: "通用",
        summary: "调整外观、语言和桌面交互偏好。"
      },
      providers: {
        label: "模型服务",
        summary: "配置模型服务、认证、可用模型与默认模型。"
      },
      packages: {
        label: "扩展包",
        summary: "安装和管理通过 npm、Git 或本地目录提供的 Pi 扩展包。"
      },
      extensions: {
        label: "扩展",
        summary: "安装扩展包，并管理 Pi-67 Desktop 内置扩展和本地扩展。"
      },
      skills: {
        label: "技能",
        summary: "按可用范围查看技能；全局页统一汇总内置、受管和本地技能，项目页只显示当前项目专属技能。"
      },
      prompts: {
        label: "指令模板",
        summary: "查看可通过 /name 调用的指令模板及其来源。"
      },
      rules: {
        label: "规则与上下文",
        summary: "查看全局与项目 AGENTS.md、CLAUDE.md 以及桌面托管规则。"
      },
      mcp: {
        label: "MCP 服务",
        summary: "管理外部 MCP 服务的连接端点、认证凭据与本机配置状态。"
      },
      integrations: {
        label: "浏览器集成",
        summary: "准备并诊断 browser67 的依赖、扩展和真实受管浏览器连接。"
      },
      runtime: {
        label: "运行服务",
        summary: "查看并发、恢复和 Pi 运行服务状态。"
      },
      network: {
        label: "下载源与网络",
        summary: "管理私有 Node/npm/Git、公共镜像、官方回退和源可达性。"
      },
      updates: {
        label: "更新与诊断",
        summary: "检查版本更新并导出脱敏运行诊断。"
      },
      about: {
        label: "关于",
        summary: "查看 π 的产品边界、版本与运行架构。"
      }
    },
    emptySearchSuggestion: "尝试搜索主题、模型、技能、镜像或更新。",
    extensionPackages: zhCNExtensionPackageMessages
  },
  dateTime: {
    unknown: "时间未知",
    justNow: "刚刚",
    minutesAgo: (count: number) => `${count} 分钟前`,
    hoursAgo: (count: number) => `${count} 小时前`
  },
  transcript: {
    copyAnswer: "复制回答",
    copyMessage: "复制消息",
    copied: "已复制",
    copyFailed: "复制失败，请重试",
    noCopyText: "这条消息没有可复制的文字",
    continueInNewTask: "在新任务中继续",
    continueInNewTaskDetail: "保留当前任务，并在新任务中带着此前上下文继续",
    continuedTaskTitle: (title: string) => `接续：${title}`,
    continueFailed: "无法创建接续任务",
    continueCleanupFailed: (detail: string) => `新任务清理失败：${detail}`,
    editMessage: "编辑消息",
    editMessageDetail: "在原位置修改，发送后重新生成后续回答",
    editInputLabel: "编辑用户消息",
    editSend: "发送修改",
    editSending: "正在发送修改",
    editPreparedRetry: "会话已准备好，但修改内容尚未发送。请重试或取消。",
    restoringEditedMessage: "正在恢复编辑前的会话",
    restoreEditFailed: "无法取消消息修改",
    finishMessageEdit: "请先完成或取消当前消息修改",
    editAttachmentUnavailable: "包含附件的历史消息暂不支持编辑",
    actionWhileRunning: "当前任务结束或停止后可用",
    actionWhileTransitioning: "正在切换会话，请稍候",
    actionUnavailable: "当前会话暂不可用"
  },
  workspace: {
    eyebrow: "π",
    heading: "开始一个 Pi 会话",
    description: "选择一个工作区，继续已有 Pi 会话或开始新会话。",
    openAction: "选择工作区",
    existingConfiguration: "复用现有 Pi 配置和会话",
    existingConfigurationDetail: "无需迁移已有工作方式",
    localData: "数据保存在本机",
    localDataDetail: "工作区内容不会成为应用遥测"
  },
  shell: {
    sessionFallback: (id: string) => `会话 ${id}`,
    hideNavigation: "隐藏会话导航",
    showNavigation: "显示会话导航",
    currentStatus: (label: string) => `当前状态：${label}`,
    openCommandPalette: "打开命令面板",
    commandPalette: "命令面板",
    hideContext: "隐藏任务检查器",
    showContext: "显示任务检查器",
    hideContextPanel: "隐藏任务检查器",
    showContextPanel: "显示任务检查器",
    openMoreMenu: "打开更多菜单",
    more: "更多",
    moreApplicationActions: "更多应用操作",
    credentials: "Provider 与凭据",
    credentialsDetail: "查看认证状态或配置本次运行密钥",
    updates: "检查更新",
    updatesDetail: "查看 Unsigned Preview 更新状态",
    diagnostics: "导出脱敏诊断",
    diagnosticsDetail: "不包含 Prompt、源码或凭据",
    appearance: (label: string) => `外观：${label}`,
    selectedAppearance: (label: string, selected: boolean) => (
      `外观：${label}${selected ? "，当前选择" : ""}`
    ),
    appearanceDetail: "应用外观",
    themePersistenceUnavailable: "主题存储不可用；选择仅在本次运行有效。",
    themeSystem: "跟随系统",
    themeLight: "浅色",
    themeDark: "深色"
  },
  navigation: {
    region: "会话导航",
    workspace: "工作区",
    switchWorkspace: "切换工作区",
    createSession: "新建 Session",
    loadingMore: "正在加载更多…",
    search: "搜索会话",
    clearSearch: "清除会话搜索",
    refresh: "刷新会话",
    importSession: "导入 Pi Session",
    sessionList: "Pi 会话",
    matchingCount: (count: number) => `找到 ${count} 个匹配会话`,
    totalCount: (count: number) => `共有 ${count} 个会话`,
    catalogUnavailable: (detail: string) => `Session 目录不可用：${detail}`,
    catalogRebuilding: "正在建立 Session 目录…",
    catalogLoading: "正在加载 Session…",
    catalogTemporarilyUnavailable: "Session 目录暂不可用，尚未确认没有会话。",
    catalogIncompleteEmpty: "未能读取全部 Session，当前没有可显示结果。",
    noMatches: "没有匹配的会话。",
    noSessions: "还没有保存的 Pi 会话。",
    catalogRetry: "Session 目录暂不可用，可稍后刷新重试。",
    catalogFallback: "Session 索引暂时不可用，当前使用 Pi Session 扫描结果。",
    catalogFallbackRecovering: "Session 索引正在恢复，当前临时使用 Pi Session 扫描结果。",
    skippedSessions: (count: number) => `${count} 个 Session 无法读取，当前结果可能不完整。`,
    catalogIncomplete: "Session 目录结果可能不完整。",
    groupRunning: "正在运行",
    groupRecent: "最近",
    statusCurrent: "当前",
    statusRunning: "运行中",
    statusWaiting: "等待操作",
    statusInactive: "非当前会话",
    rowLabel: (name: string, status: string, count: number) => (
      `${name}，${status}，${count} 条消息`
    ),
    shortMessageCount: (count: number) => `${count} 条`
  },
  commandPalette: zhCNCommandPaletteMessages,
  doctor: {
    title: "运行环境诊断",
    menuDetail: "检查内置 Node、Pi SDK、SQLite、Shell 和 Git",
    eyebrow: "运行环境检查",
    runningDescription: "正在检查内置 Node.js、Pi SDK、SQLite、Shell 和 Git。",
    incompleteDescription: "检查未完成。Pi 会话状态没有被修改，可以重新运行。",
    initialDescription: "运行检查以确认内置 Node.js、Pi SDK、SQLite、Shell 和 Git 是否可用。",
    failingDescription: (count: number) => `${count} 项失败，请先处理后再开始需要 Shell 的任务。`,
    warningDescription: (count: number) => `核心运行环境可用，另有 ${count} 项需要注意。`,
    passedDescription: "当前运行环境的关键检查均已通过。",
    running: "正在运行检查…",
    results: "运行环境检查结果",
    rerun: "重新运行检查",
    run: "运行检查",
    loadingInterface: "正在加载运行环境诊断",
    interfaceFailureTitle: "运行环境诊断界面未能加载",
    interfaceFailureDescription: "运行环境诊断界面模块发生错误。可以关闭后继续使用，或重新加载界面恢复该功能。",
    runtimeFailureTitle: "Windows/macOS 运行环境检查失败",
    checks: {
      platform: "系统平台",
      node: "内置 Node.js",
      piSdk: "Pi SDK",
      sqliteRuntime: "内置 SQLite",
      sessionCatalog: "Session 目录",
      shell: "Pi Shell",
      git: "Git"
    },
    statuses: {
      pass: "通过",
      warning: "需注意",
      fail: "失败"
    }
  },
  credentials: {
    title: "Provider 与凭据",
    eyebrow: "Pi Provider 状态",
    privacyTitle: "已保存密钥仅在你主动查看时临时显示。",
    privacyDetail: "默认保持隐藏；显示值不会进入快照、诊断或日志，并会在切换 Provider、关闭弹窗或 15 秒后清除。保存时默认持久化到 Pi auth.json。",
    providerList: "Pi Provider 列表",
    providerSearch: "搜索 Provider",
    providerSearchPlaceholder: "搜索名称或 ID…",
    clearProviderSearch: "清除 Provider 搜索",
    noProviderMatches: "没有匹配的 Provider",
    modelCount: (count: number) => `${count} 个模型`,
    configured: "已配置",
    unconfigured: "未配置",
    loading: "正在从当前工作区加载 Pi Provider…",
    noWorkspace: "请先添加或选择一个工作区，再管理 Pi Provider 凭据。",
    empty: "Pi 没有返回可配置的 Provider。请检查 models.json 或 Extension Provider 配置。",
    loadFailed: "无法加载 Pi Provider",
    retry: "重试加载",
    enabling: "正在启用…",
    replaceRuntimeKey: "替换本次运行密钥",
    enableRuntimeKey: "启用本次运行密钥",
    editorLabel: (provider: string) => `${provider} 凭据`,
    currentAuthentication: "当前认证",
    notConfigured: "尚未配置",
    replaceKeyLabel: "输入新密钥以替换 Pi 持久凭据",
    addKeyLabel: "新增 Pi API 密钥",
    apiKeyLabel: "Provider API 密钥",
    showApiKey: "显示 API Key",
    hideApiKey: "隐藏 API Key",
    showSavedApiKey: "临时显示已保存 API Key",
    hideSavedApiKey: "隐藏已保存 API Key",
    revealingSavedApiKey: "正在读取已保存 API Key…",
    savedApiKeyNotFound: "当前没有可显示的持久 API Key。",
    savedApiKeyNotApiKey: "当前保存的是 OAuth 凭据，不能作为 API Key 显示。",
    savedApiKeyIndirect: "当前凭据由环境变量或命令提供，不能在这里直接显示。",
    savedApiKeyRevealFailed: "无法临时显示已保存 API Key。",
    keyPlaceholder: "输入后发送到 Pi 运行服务",
    keyPrivacyHelp: "至少 8 个字符。新输入不会进入会话快照、诊断或日志；已保存值只在主动查看时短暂进入当前窗口。",
    temporaryOrPiConfiguration: "可保存到 Pi auth.json，或仅在本次运行中使用。",
    runtimeSource: "来源：本次运行内存",
    storedSource: "来源：Pi AuthStorage",
    environmentSource: (label: string | undefined) => `来源：环境配置${label ? ` · ${label}` : ""}`,
    modelsJsonKeySource: "来源：Pi models.json 配置",
    modelsJsonCommandSource: "来源：Pi models.json 命令",
    fallbackSource: "来源：Provider 默认认证",
    providerSource: "来源：Pi Provider 配置",
    loadingInterface: "正在加载 Provider 凭据",
    interfaceFailureTitle: "Provider 凭据界面未能加载",
    interfaceFailureDescription: "Provider 凭据界面模块发生错误。未提交的凭据不会被保存或发送。",
    staleConfirmationTitle: "Provider API 密钥确认已过期",
    stateNeedsConfirmationTitle: "Provider API 密钥状态需要重新确认",
    enableFailedTitle: "无法启用 Provider API 密钥",
    enabledTitle: (provider: string) => `${provider} API 密钥已在本次运行中启用`,
    ephemeralNotice: "退出应用后不会保留。",
    clearedAfterHostReplacement: "任何仅在本次运行内存中的 Provider API 密钥均已清除。"
  },
  approval: {
    dialogLabel: "工具单次授权",
    eyebrow: "π 安全授权",
    title: "需要单次授权",
    suspiciousTitle: "检测到危险或不可见字符",
    suspiciousDescription: (count: number) => (
      `工具名称、来源、目标或工作目录中有 ${count} 个可疑字符。相关内容已改用安全转义视图；实际请求不会被改写。`
    ),
    suspiciousTypes: (labels: string) => `类型：${labels}`,
    tool: "工具",
    toolName: "工具名称",
    toolSource: "工具来源",
    risk: "风险",
    command: "命令",
    path: "路径",
    target: "目标",
    cwd: "工作目录",
    targetTruncated: "目标内容已按安全预算截断",
    cwdTruncated: "工作目录已按安全预算截断",
    approvalScope: "授权范围",
    singleToolCall: "仅此 Tool Call",
    denialNotice: "拒绝或关闭当前会话会阻止这次工具调用，不会自动允许后续同类操作。",
    yoloNotice: "本任务开启 YOLO 后，已等待和后续产生的工具会自动执行；任务停止或应用重启后恢复 AUTO。",
    submitting: "正在提交…",
    deny: "拒绝",
    allowOnce: "仅允许本次",
    enableTaskYolo: "本任务开启 YOLO",
    requestTimeoutTitle: "工具授权请求已超时",
    requestTimeoutMessage: "未收到有效响应，工具保持阻止。",
    responseTimeout: {
      title: "授权结果需要重新确认",
      message: "Pi 运行服务未在同步边界内确认响应；正在重新同步。未确认的授权不会放行。",
      recoveringDetail: "授权响应确认超时，正在重新同步 Pi 状态",
      readyDetail: "授权状态已重新同步",
      failureTitle: "无法确认授权结果"
    },
    unknownLiteral: "(未知)",
    emptyLiteral: "(空)",
    safeViewLabel: (label: string) => `${label}安全转义视图`,
    suspiciousLiteral: (count: number) => `安全转义视图 · ${count} 个可疑字符`,
    risks: {
      "workspace-read": "读取工作区",
      "resource-read": "读取当前会话已加载的 Pi 资源",
      "workspace-write": "修改工作区",
      "workspace-command": "执行工作区内的非破坏性命令",
      "capability-read": "检查当前会话已加载的工具能力",
      "external-path": "访问工作区之外的路径",
      "bulk-delete": "批量删除",
      "destructive-shell": "破坏性 Shell 命令",
      "system-configuration": "修改系统配置",
      "dependency-change": "修改依赖",
      "git-external-action": "远程 Git 操作",
      "download-and-execute": "下载并执行",
      "network-read": "读取外部网络信息",
      "network-side-effect": "产生网络副作用",
      "configured-operation": "执行当前任务已配置的工具能力",
      "persistent-state-write": "新增或更新持久化状态",
      "persistent-state-delete": "删除持久化状态",
      "external-submit": "向外部目标提交内容或操作",
      "credential-or-auth": "使用或修改凭据与授权状态",
      "unverified-tool": "工具来源或参数契约尚未验证",
      "ambiguous-command": "无法安全分类"
    },
    securityCategories: {
      bidi: "双向文本控制符",
      "zero-width": "零宽字符",
      ansi: "ANSI 控制序列",
      control: "控制字符",
      "line-separator": "非标准行分隔符"
    }
  },
  extensionUi: {
    requestDialogLabel: "Pi Extension 请求",
    defaultExtensionLabel: "Pi Extension",
    defaultTitle: "Pi Extension 需要输入",
    inputLabel: "Pi Extension 输入",
    editorLabel: "Pi Extension 编辑器",
    submitting: "正在提交",
    confirm: "确认",
    continue: "继续",
    unattributed: "未归属 Extension UI",
    staleTitle: "Extension 请求已过期",
    staleBeforeSend: "未向 Pi 运行服务发送响应。",
    staleRejected: "Pi 运行服务未接受这次响应；请求已不再有效，没有输入被执行。",
    submitFailed: "无法提交 Extension 响应",
    submitRetry: (detail: string) => `${detail}。请求仍保留，可以重试。`,
    connectionError: "Pi 运行服务连接异常",
    requestTimeoutTitle: "Extension 输入请求已超时",
    requestTimeoutMessage: "未收到有效响应，Extension 已取消该请求。",
    responseTimeout: {
      title: "Extension 响应需要重新确认",
      message: "Pi 运行服务未在同步边界内确认响应；正在重新同步，未确认的输入不会继续提交。",
      recoveringDetail: "Extension 响应确认超时，正在重新同步 Pi 状态",
      readyDetail: "Extension 输入状态已重新同步",
      failureTitle: "无法确认 Extension 响应"
    }
  },
  extensionCatalog: {
    heading: "Extension 目录",
    waiting: "等待 Extension 目录同步。",
    empty: "未发现用户 Extension。Desktop 内部安全扩展不会显示在这里。",
    countSummary: (commandCount: number, toolCount: number) => `${commandCount} 命令 · ${toolCount} 工具`,
    registeredTools: "已注册工具",
    moreTools: (count: number) => `另 ${count} 个`,
    executable: "可执行",
    executableWithLimitedPresentation: "执行可用 · 展示受限",
    adapterSummary: (packageName: string, version: string, commandCount: number, toolCount: number) => (
      `声明式 Adapter · ${packageName}@${version} · ${commandCount} 命令 / ${toolCount} 工具`
    ),
    surfaceAria: (surface: string, status: string, detail: string) => `${surface}：${status}。${detail}`,
    truncated: (visible: number, total: number) => `仅显示前 ${visible} 项；目录共有 ${total} 项。`,
    overall: {
      native: "原生支持",
      headless: "无界面",
      adapter: "已适配",
      partial: "部分支持",
      "tui-only": "仅 Pi TUI",
      unsupported: "不支持",
      unknown: "未评估"
    },
    surfaces: {
      commands: "命令",
      tools: "工具",
      "ui-primitives": "UI",
      "tui-custom": "TUI"
    },
    surfaceStatuses: {
      supported: "支持",
      partial: "部分",
      "tui-only": "仅 TUI",
      unsupported: "不支持",
      "not-present": "未注册",
      unknown: "未知"
    },
    scopes: {
      project: "项目",
      user: "用户",
      temporary: "临时",
      unknown: "来源未知"
    },
    packageOrigin: "Package",
    topLevelOrigin: "直接加载"
  },
  composer: zhCNComposerMessages,
  runtime: zhCNRuntimeMessages,
  operation: zhCNOperationMessages
} as const;
