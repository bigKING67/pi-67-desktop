using System.Globalization;

namespace Pi67.Desktop.Presentation.Shell;

public interface IShellTextProvider
{
    string Resolve(string key);

    string Format(string key, params object?[] arguments);
}

public sealed class ChineseShellTextProvider : IShellTextProvider
{
    private static readonly Dictionary<string, string> Values = new(StringComparer.Ordinal)
    {
        ["Workspace.None"] = "未选择项目",
        ["Runtime.Checking"] = "正在检查 Pi runtime",
        ["Runtime.Verified"] = "Pi runtime 已验证",
        ["Runtime.Unverified"] = "Pi runtime 版本未验证",
        ["Runtime.TooOld"] = "Pi runtime 版本过旧",
        ["Runtime.Unavailable"] = "Pi runtime 不可用",
        ["Runtime.CheckComplete"] = "环境检查完成",
        ["Runtime.PreparationRequired"] = "需要完成环境准备",
        ["Runtime.CheckFailed"] = "环境检查失败",
        ["Runtime.CheckRetry"] = "环境状态已保留，可重试检查",
        ["Trust.NotSelected"] = "尚未选择项目",
        ["Trust.NotTrusted"] = "项目资源尚未信任；工具审批仍独立生效",
        ["Trust.Once"] = "仅本次进程信任项目资源",
        ["Trust.PersistWhenAvailable"] = "将在 Pi 可用后持久化项目信任",
        ["Trust.DenyResources"] = "不加载项目本地 Pi 资源",
        ["Trust.Persisted"] = "已持久信任项目资源；工具审批仍独立生效",
        ["Trust.Process"] = "仅本次进程信任项目资源；工具审批仍独立生效",
        ["Trust.Denied"] = "已拒绝项目本地 Pi 资源",
        ["Trust.RequiresResources"] = "项目包含需要信任的 Pi 资源",
        ["Trust.NoResources"] = "项目没有需要信任的 Pi 资源",
        ["Operation.Ready"] = "准备就绪",
        ["Operation.ControlUnavailable"] = "Pi 设置桥接不可用",
        ["Operation.ControlUnavailableDetail"] = "Pi 设置桥接不可用：{0}",
        ["Operation.BootstrapBusy"] = "另一项环境准备正在运行",
        ["Operation.AwaitingConfirmation"] = "等待确认：{0}",
        ["Operation.RunningStep"] = "正在执行：{0}",
        ["Operation.StepComplete"] = "已完成：{0}",
        ["Operation.StepFailed"] = "环境准备失败：{0}",
        ["Operation.StepCancelled"] = "已取消：{0}",
        ["Operation.BootstrapCancelled"] = "环境准备已取消",
        ["Operation.ShuttingDown"] = "正在安全关闭 Pi RPC 会话",
        ["Operation.UnexpectedFailure"] = "操作未完成，当前状态已保留",
        ["Operation.RuntimeRequired"] = "请先完成 Pi runtime 环境准备",
        ["Operation.WorkspaceRequired"] = "请先选择项目文件夹",
        ["Operation.SafetyMissingCreate"] = "Desktop safety extension 缺失，未启动会话",
        ["Operation.SessionStarted"] = "Pi RPC 会话已启动",
        ["Operation.SessionStartFailed"] = "Pi RPC 启动失败：{0}",
        ["Operation.RuntimeOrWorkspaceMissing"] = "Pi runtime 或项目尚未准备完成",
        ["Operation.SafetyMissingOpen"] = "Desktop safety extension 缺失，未打开会话",
        ["Operation.SessionOpened"] = "已打开会话：{0}",
        ["Operation.SessionOpenedLimited"] = "已打开会话：{0}；界面显示最近 {1} 条消息",
        ["Operation.SessionOpenFailed"] = "打开 Pi 会话失败：{0}",
        ["Operation.ImageDuringFollowUp"] = "Pi 正在运行时不能把图片加入 follow-up；请停止或等待当前任务完成",
        ["Operation.PromptAccepted"] = "提示已交给 Pi",
        ["Operation.PromptRejected"] = "Pi 拒绝提示：{0}",
        ["Operation.SendCancelled"] = "发送已取消，输入内容已保留",
        ["Operation.SendFailed"] = "发送失败，输入内容已保留：{0}",
        ["Operation.StopRequested"] = "已请求停止当前 Pi 操作",
        ["Operation.ApiKeySaved"] = "已保存 {0} API key；密钥值不会显示或写入日志",
        ["Operation.LoggedOut"] = "已退出 {0}",
        ["Operation.OAuthCancelled"] = "已取消 {0} OAuth 登录",
        ["Operation.OAuthComplete"] = "{0} OAuth 登录已完成",
        ["Operation.DefaultModelUpdated"] = "默认模型已设为 {0}",
        ["Operation.ModelsRefreshed"] = "模型列表已刷新",
        ["Operation.AgentComplete"] = "Pi 已完成当前任务",
        ["Operation.ExtensionError"] = "Pi extension 报告错误；会话状态已保留",
        ["Operation.EventStreamStopped"] = "Pi RPC 事件流已停止；会话未标记完成：{0}",
        ["Operation.ExtensionNotice"] = "Pi extension 通知",
        ["Bootstrap.git.Name"] = "安装 Git",
        ["Bootstrap.git.Description"] = "工作区与 pi-67 源码操作需要 Git for Windows。",
        ["Bootstrap.node.Name"] = "安装 Node.js 24 LTS",
        ["Bootstrap.node.Description"] = "用于运行真实 Pi package 与 Desktop 控制桥接。",
        ["Bootstrap.pi.Name"] = "安装 upstream Pi",
        ["Bootstrap.pi.Description"] = "提供 Desktop 使用的唯一 Agent runtime。",
        ["Bootstrap.pi67-manager.Name"] = "安装 pi-67 manager",
        ["Bootstrap.pi67-manager.Description"] = "提供受支持的 pi-67 安装、诊断和更新流程。",
        ["Bootstrap.pi67-distro.Name"] = "安装 pi-67 distro",
        ["Bootstrap.pi67-distro.Description"] = "创建托管的 Pi agent checkout，不覆盖既有数据。",
        ["Model.NotRead"] = "尚未读取默认模型",
        ["Model.NotSelected"] = "尚未选择默认模型",
        ["Model.Default"] = "默认：{0}",
        ["Auth.NotConfigured"] = "未配置",
        ["Transcript.User"] = "你",
        ["Transcript.Pi"] = "Pi",
        ["Transcript.Attachments"] = "附件：{0}",
        ["Tool.ParametersHidden"] = "参数未显示",
        ["Tool.SensitiveHidden"] = "敏感或原始参数已隐藏",
        ["Tool.Running"] = "运行中",
        ["Tool.Failed"] = "失败",
        ["Tool.Complete"] = "完成",
        ["Extension.RequestTitle"] = "Pi 请求",
    };

    public string Resolve(string key) => Values.TryGetValue(key, out string? value) ? value : key;

    public string Format(string key, params object?[] arguments) =>
        string.Format(CultureInfo.CurrentCulture, Resolve(key), arguments);
}

public static class ShellTextProviderExtensions
{
    public static string Get(this IShellTextProvider provider, string key) => provider.Resolve(key);
}
