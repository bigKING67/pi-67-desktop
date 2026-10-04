import type { AutoRoutingPart } from "@pi67/domain";
import { Sparkles } from "lucide-react";
import styles from "./MessageCard.module.css";

const reasons: Record<AutoRoutingPart["reason"], string> = {
  standard: "判断为常规任务", complex: "判断为复杂任务", "image-capability": "任务包含图片，选择支持图片的候选模型",
  "judge-failed": "判断请求失败", "invalid-decision": "判断结果无效", cancelled: "判断已取消", "timed-out": "判断超时"
};

export function AutoRoutingEvidence({ part }: { part: AutoRoutingPart }) {
  return <details className={styles.visionEvidence} data-testid="auto-routing-evidence">
    <summary><Sparkles aria-hidden="true" size={14} /><span>
      <strong>{part.status === "selected" ? "Auto 已选择模型" : "Auto 未能选择模型"}</strong>
      <small>{part.selected ? `${part.selected.provider} / ${part.selected.model}` : "任务模型尚未调用"} · {reasons[part.reason]}</small>
    </span></summary>
    <div>
      <p>判断模型：{part.judge.provider} / {part.judge.model}</p>
      <p>{part.totalTokens === undefined ? "判断用量未返回" : `判断用量：${part.totalTokens} tokens`}
        {part.totalCost === undefined ? "" : ` · Pi 记录费用 $${part.totalCost.toFixed(6)}`}</p>
      {part.inputTruncated ? <p>判断仅使用任务文本的前 16,000 个字符。</p> : null}
      {part.status === "selected" ? <p>本任务的工具续接和重试保持该模型；这里记录的是路由选择，实际完成状态见后续结果。</p> : null}
    </div>
  </details>;
}
