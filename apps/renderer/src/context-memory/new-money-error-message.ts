/** Presentation only. Never changes authorization or retries a failed operation. */
export function newMoneyErrorMessage(error: unknown, fallback: string): string {
  if (!(error instanceof Error)) return fallback;
  const message = error.message;
  if (message === "The current model is not authorized to process this team's shared content.") {
    return "当前模型尚未获得团队共享内容的处理授权。请在网页端检查团队模型政策，并确认本地模型配置符合政策。";
  }
  if (message === "The New Money team does not have permission for this operation.") {
    return "当前团队不允许此操作。请检查团队状态、成员角色及项目访问权限。";
  }
  if (message === "Team Tool admission requires a currently authorized model request.") {
    return "本次模型请求没有有效的团队授权。请确认当前是团队会话，并检查所选模型的团队授权；登录账户不会自动把私人会话变成团队会话。";
  }
  if (/^Team worker lifecycle unavailable(?: \([a-z-]+\))?\.$/u.test(message)) {
    return `本地团队运行任务未能完成。请检查团队运行包和模型配置；若仍失败，请查看运行诊断。技术信息：${message}`;
  }
  return message || fallback;
}
