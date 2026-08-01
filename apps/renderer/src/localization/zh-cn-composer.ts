export const zhCNComposerMessages = {
  attachmentReadFailed: "无法读取附件。",
  selectedAttachmentReadFailed: "无法读取所选附件。",
  dropAttachments: "释放以添加附件",
  submissionFailed: "消息未发送。草稿和附件已保留。",
  editBlockedByDraft: "输入框已有草稿或附件，请先发送或清空后再编辑历史消息。",
  pendingAttachments: "待发送附件",
  removeAttachment: (name: string) => `移除附件：${name}`,
  inputLabel: "给 Pi 发送消息",
  streamingPlaceholder: "补充要求，/ 选择指令或技能…",
  idlePlaceholder: "描述任务，/ 选择指令或技能…",
  chooseAttachment: "选择附件",
  addAttachment: "添加附件",
  toolModeMenu: "工具执行模式",
  toolModeControl: (mode: string) => `工具执行模式：${mode}`,
  toolModeChanging: "切换中",
  toolModes: {
    ask: {
      label: "ASK",
      description: "只读自动，写入与命令询问"
    },
    auto: {
      label: "AUTO",
      description: "常规操作自动，高风险询问"
    },
    yolo: {
      label: "YOLO",
      description: "当前任务所有已注册工具自动执行"
    }
  },
  yoloConfirmationTitle: "为当前任务开启 YOLO？",
  yoloConfirmationDescription: "已等待和后续产生的所有工具将自动执行，包括工作区外访问、删除、系统和网络操作。",
  yoloRequiresTrustedWorkspace: "仅可信工作区可开启",
  enableYolo: "开启 YOLO",
  slashCatalogUnavailable: "Pi 指令目录尚未加载，请稍后重试。草稿已保留。",
  slashCatalogTruncated: "指令目录不完整，无法安全判断该 / 指令。请从候选列表选择。",
  slashRuntimeUnavailable: "扩展命令、提示词与技能需要连接 Pi 运行服务。",
  slashRuntimeLoading: "正在加载扩展命令、提示词与技能…",
  slashRuntimeFailed: "扩展命令、提示词与技能暂时无法加载；Pi 内置操作仍可使用。",
  slashPickerTitle: "Pi 操作、指令与技能",
  slashPickerFilterHint: "输入名称筛选",
  slashEmpty: "没有匹配的操作、指令或技能。",
  slashGroups: {
    builtin: "Pi 内置",
    extension: "扩展命令",
    prompt: "提示词",
    skill: "技能"
  },
  unsupportedPiBuiltin: (name: string) => `/${name} 是 Pi TUI 操作，当前 Desktop 尚未支持。`,
  piBuiltins: {
    new: "在当前工作区新建任务",
    model: "选择当前任务使用的模型",
    compact: "压缩当前会话上下文",
    resume: "查找并恢复已有会话",
    tree: "打开当前会话树",
    reload: "重新加载扩展、技能、提示词与上下文",
    settings: "打开 Desktop 设置"
  },
  piActionUnavailable: {
    disconnected: "Pi 运行服务尚未连接。",
    workspace: "请先打开可用工作区。",
    session: "当前 Pi 会话尚未就绪。",
    transition: "正在切换会话，请稍候。",
    running: "当前任务结束或停止后可用。",
    model: "当前没有已配置的可用模型。"
  },
  piActionUnexpectedArguments: (command: string) => `${command} 不接受附加参数。`,
  piModelNotFound: (target: string) => `未找到已配置模型 ${target}。请使用 /model 打开模型列表。`,
  commandUnavailableWhileRunning: "当前任务运行中，扩展指令不能排入立即纠偏或完成后执行。",
  commandAttachmentsUnsupported: "扩展指令暂不支持同时携带附件。请先执行指令，再发送附件任务。",
  commandFailed: "指令未执行。草稿已保留，请查看过程或通知中的错误。",
  streamingDelivery: "运行中消息处理方式",
  steerDetail: "发送给正在执行的 Pi，可能改变当前计划",
  steer: "立即纠偏",
  followUpDetail: "当前任务结束后再发送",
  followUp: "完成后执行",
  keyboardHint: "Enter 发送 · Shift+Enter 换行",
  sending: "发送中",
  send: "发送",
  queue: "消息队列",
  queueSummary: (steeringCount: number, followUpCount: number) => (
    `${steeringCount} 条立即纠偏 · ${followUpCount} 条完成后执行`
  ),
  collapseQueue: "收起队列内容",
  inspectQueue: "查看已排队的消息",
  clearingQueue: "正在清空",
  confirmClearQueue: "确认清空",
  clearQueue: "清空全部",
  hiddenQueueItems: (count: number) => (
    `另有 ${count} 条消息未挂载，以保持输入和滚动流畅。`
  ),
  emptyQueueItem: "（空消息）",
  queueItemTruncated: "内容已截断",
  runtimeSettings: "本次发送设置",
  modelTitle: "选择本次任务使用的 Pi 模型",
  modelLabel: "Pi 模型",
  selectModel: "选择模型",
  noAvailableModels: "没有可用模型",
  unauthenticatedModel: "（当前模型未认证）",
  configureProvider: "配置 Provider…",
  modelSwitching: (model: string) => `正在切换到 ${model}…`,
  confirmingModelSwitch: (model: string) => `正在确认 ${model} 的会话状态`,
  modelSwitched: (model: string) => `已切换到 ${model}`,
  modelSwitchFailed: (model: string, detail: string) => `切换到 ${model} 失败：${detail}`,
  modelSwitchConfirmationFailed: "无法确认模型切换",
  modelSwitchStateUnconfirmed: "Pi 返回后仍无法确认当前模型，请稍后重试。",
  thinkingTitle: "设置 Pi 的思考级别",
  thinkingLabel: "Pi 思考级别",
  thinking: {
    off: "思考：关闭",
    minimal: "思考：最低",
    low: "思考：低",
    medium: "思考：中",
    high: "思考：高",
    xhigh: "思考：很高",
    max: "思考：最高",
    fallback: (level: string) => `思考：${level}`
  }
} as const;
