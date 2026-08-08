export const zhCNRepositoryEnvironmentMessages = {
  inspect: "检查 Git",
  inspectDetail: "使用内置 Git 检查当前工作区的 Repository 与 Worktree 关系",
  inspecting: "正在检查 Git",
  refreshing: "正在更新 Git",
  inspectingDetail: "正在只读检查 Repository 与 Worktree 状态",
  primary: "主工作树",
  linked: "链接工作树",
  detached: "Detached HEAD",
  branchUnknown: "分支未知",
  readyDetail: (kind: string, branch: string, count: number) => (
    `${kind}，${branch}，Repository 共 ${count} 个 Worktree。点击刷新 Git 状态。`
  ),
  nonGit: "非 Git 目录",
  nonGitDetail: "当前工作区不是 Git Repository；Pi 会话仍可正常使用。点击刷新 Git 状态。",
  toolchainUnavailable: "内置 Git 不可用",
  toolchainUnavailableDetail: "私有 Git 工具链缺失或无效；这不会阻断普通 Pi 会话。点击刷新 Git 状态。",
  workspaceMissing: "目录不可用",
  workspaceMissingDetail: "当前工作区目录缺失或尚未重新确认。",
  stale: "Git 状态待更新",
  staleDetail: "保留上次可用的 Worktree 信息，本次只读刷新未完成。点击重试。",
  catalogUnavailable: "Git 缓存不可用",
  catalogUnavailableDetail: "当前只读检查已完成，但 Worktree 缓存未能更新；下次会从 Git 重新检查。",
  stateUnavailable: "Git 绑定待保存",
  stateUnavailableDetail: "当前只读检查已完成，但 Workspace 与 Repository 的持久绑定未能保存。点击重试。",
  failed: "Git 检查失败",
  failedDetail: "无法完成只读 Repository 检查；普通 Workspace 与 Session 不受影响。点击重试。"
} as const;
