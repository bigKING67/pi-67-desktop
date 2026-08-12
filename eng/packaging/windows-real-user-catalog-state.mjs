export function catalogStateFromText(text, itemCount) {
  if (text.includes("Session 索引正在恢复")) return "fallback-recovering";
  if (text.includes("Session 索引暂时不可用")) return "fallback";
  if (text.includes("正在建立 Session 目录")) return "rebuilding";
  if (text.includes("未能读取全部 Session")) return "incomplete-empty";
  if (text.includes("这个工作区还没有会话")) return "ready-empty";
  if (itemCount > 0) return "ready";
  return undefined;
}
