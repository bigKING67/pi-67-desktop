import { classifyToolCall, describeRisk } from "./risk-policy.mjs";

export default function pi67DesktopSafety(pi) {
  if (process.env.PI67_DESKTOP !== "1") return;

  pi.on("tool_call", async (event, ctx) => {
    let risk;
    try {
      risk = await classifyToolCall(event, ctx.cwd);
    } catch {
      return { block: true, reason: "Pi-67 Desktop could not establish a safe canonical path." };
    }
    if (!risk.approvalRequired) return undefined;
    if (!ctx.hasUI) return { block: true, reason: "Pi-67 Desktop approval UI is unavailable." };

    const exactTarget = risk.command ?? risk.canonicalPath ?? event.toolName;
    const preview = exactTarget.length > 1200 ? `${exactTarget.slice(0, 1200)}...` : exactTarget;
    const allowed = await ctx.ui.confirm(
      describeRisk(risk),
      `${preview}\n\n仅允许本次操作；拒绝后当前会话仍可继续。`,
    );
    return allowed ? undefined : { block: true, reason: `Blocked by user: ${risk.category}` };
  });
}
