export const zhCNRuntimeMessages = {
  unknownError: "未知错误",
  session: {
    creating: "正在创建 Pi 新会话",
    createFailed: "无法创建 Pi 会话",
    starting: "正在启动 Pi 会话",
    rollingBack: "正在回退 Pi 会话",
    rolledBack: "Pi 会话已回退",
    rollbackFailed: "无法回退 Pi 会话"
  },
  workbench: {
    restoreFailedTitle: "无法恢复工作台",
    layoutNotSavedTitle: "工作台布局未保存",
    workspaceIdentityChanged: "工作区需要重新确认",
    workspaceUnavailable: "工作区当前不可用",
    sessionPendingOpen: "会话待打开",
    workspaceRestored: "工作区已恢复",
    unnamedSession: "未命名会话",
    sessionReady: "Pi 会话已就绪"
  },
  connection: {
    restoringSession: "正在恢复 Pi 会话",
    restoreSessionFailed: "无法恢复 Pi 会话",
    sessionRestored: "Pi 会话已恢复",
    runtimeConnectionInterrupted: "Pi 运行服务连接已中断",
    runtimeConnectionRecovering: "Pi 运行服务连接已中断，正在等待恢复",
    restoreConnectionFailed: "无法恢复 Pi 运行服务连接",
    restoreConnectionFailedDetail: (detail: string) => `无法恢复 Pi 运行服务连接：${detail}`,
    systemReconnect: "系统已恢复，正在重新连接 Pi 运行服务",
    systemReconnectFailed: "系统恢复后无法连接 Pi 运行服务",
    systemReconnectFailedDetail: (detail: string) => `系统恢复后无法连接 Pi 运行服务：${detail}`,
    resyncGap: "检测到状态事件缺口，正在重新同步",
    resyncGapReady: "Pi 状态已重新同步",
    resyncGapFailed: "无法重新同步 Pi 状态",
    resyncPower: "系统已恢复，正在重新同步 Pi 状态",
    resyncPowerReady: "系统恢复后 Pi 状态已重新同步",
    resyncPowerFailed: "系统恢复后无法同步 Pi 状态",
    hostExitedRecovering: (attempt: number) => `Pi 运行服务已退出，正在进行第 ${attempt} 次恢复`,
    hostExitedStopped: "Pi 运行服务连续退出，自动恢复已停止",
    hostExitedTitle: "Pi 运行服务已退出",
    missingRuntimeReady: "Pi 运行服务未发送 authoritative runtime.ready 事件。"
  }
} as const;
