/** An expired sign-in leaves private memory usable, so callers present it as a warning, not a failure. */
export const NEW_MONEY_SIGN_IN_EXPIRED_MESSAGE = "New Money 登录已过期或被拒绝，请到「账户与数据」重新登录；私人记忆不受影响。";

/** Presentation only. Never changes authorization or retries a failed operation. */
export function newMoneyErrorMessage(error: unknown, fallback: string): string {
  if (!(error instanceof Error)) return fallback;
  const message = error.message;
  if (message === "New Money sign-in expired or was rejected.") return NEW_MONEY_SIGN_IN_EXPIRED_MESSAGE;
  const failedStatus = /^New Money request failed \((\d{3})\)\.$/u.exec(message)?.[1];
  if (failedStatus) return `New Money 请求失败（${failedStatus}），请稍后重试。`;
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
