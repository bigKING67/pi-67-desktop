import {
  experienceMethodComplete,
  type ExperienceCandidateSummary,
  type ExperienceResult
} from "@pi67/domain";
import type { ExperienceCandidateReview } from "@pi67/protocol";
import { Check } from "lucide-react";
import { Button, Checkbox, Input, Label, TextArea, TextField } from "react-aria-components";
import styles from "./MemoryInspectorPanel.module.css";

export interface CandidateReviewDraft {
  taskType: string;
  title: string;
  problem: string;
  strategy: string;
  result: "" | ExperienceResult;
  confidence: string;
  sensitivity: "project" | "team" | "company";
  preconditions: string;
  steps: string;
  tools: string;
  validationGates: string;
  completionCriteria: string;
  failureModes: string;
  rollback: string;
  applicableWhen: string;
  notApplicableWhen: string;
  confirmOutcome: boolean;
  confirmRedaction: boolean;
}

export function experienceCandidateNeedsReview(item: ExperienceCandidateSummary): boolean {
  return item.status === "candidate"
    || (item.status === "validated" && !experienceMethodComplete(item.method));
}

export function ExperienceCandidateReviewForm({ busy, draft, onCancel, onChange, onSubmit }: {
  busy: boolean;
  draft: CandidateReviewDraft;
  onCancel: () => void;
  onChange: (draft: CandidateReviewDraft) => void;
  onSubmit: () => void;
}) {
  const update = <Key extends keyof CandidateReviewDraft>(key: Key, value: CandidateReviewDraft[Key]): void => {
    onChange({ ...draft, [key]: value });
  };
  return <section aria-label="经验候选人工审核" className={styles.reviewForm}>
    <header>
      <div><span className="section-label">Human Review</span><strong>确认结果、边界与脱敏</strong></div>
      <small>本机审核记录不会自动发布。</small>
    </header>
    <div className={styles.reviewGrid}>
      <ReviewTextField label="任务类型" value={draft.taskType} onChange={(value) => update("taskType", value)} />
      <ReviewTextField label="候选标题" value={draft.title} onChange={(value) => update("title", value)} />
      <label className={styles.field}>
        <span>任务结果</span>
        <select disabled={busy} value={draft.result} onChange={(event) => update("result", event.currentTarget.value as CandidateReviewDraft["result"])}>
          <option value="">请选择并确认</option>
          <option value="success">成功</option>
          <option value="partial">部分完成</option>
          <option value="failed">失败</option>
          <option value="rolled-back">已回滚</option>
        </select>
      </label>
      <label className={styles.field}>
        <span>共享敏感级别</span>
        <select disabled={busy} value={draft.sensitivity} onChange={(event) => update("sensitivity", event.currentTarget.value as CandidateReviewDraft["sensitivity"])}>
          <option value="project">仅当前企业项目</option>
          <option value="team">团队</option>
          <option value="company">企业</option>
        </select>
      </label>
      <ReviewTextField label="置信度（0–1）" type="number" value={draft.confidence} onChange={(value) => update("confidence", value)} />
    </div>
    <ReviewTextArea label="问题与任务背景" value={draft.problem} onChange={(value) => update("problem", value)} />
    <ReviewTextArea label="经过验证的策略" value={draft.strategy} onChange={(value) => update("strategy", value)} />
    <section className={styles.methodFields} aria-label="可复用经验方法">
      <header><strong>可复用方法</strong><small>这些内容随经验共享，但不会自动成为 SOP。</small></header>
      <ReviewTextArea description="每行一个明确前提。" label="前置条件" value={draft.preconditions} onChange={(value) => update("preconditions", value)} />
      <ReviewTextArea description="按执行顺序每行一步。" label="关键步骤" value={draft.steps} onChange={(value) => update("steps", value)} />
      <ReviewTextArea description="每行一个工具；没有可留空。" isRequired={false} label="所需工具" value={draft.tools} onChange={(value) => update("tools", value)} />
      <ReviewTextArea description="每行一个必须通过的检查。" label="验证门禁" value={draft.validationGates} onChange={(value) => update("validationGates", value)} />
      <ReviewTextArea description="每行一个可判定的完成条件。" label="完成标准" value={draft.completionCriteria} onChange={(value) => update("completionCriteria", value)} />
      <ReviewTextArea description="每行一个已知失败方式。" label="失败模式" value={draft.failureModes} onChange={(value) => update("failureModes", value)} />
      <ReviewTextArea description="填写回滚方法；不可回滚时说明原因。" label="回滚或不适用说明" value={draft.rollback} onChange={(value) => update("rollback", value)} />
    </section>
    <ReviewTextArea description="每行一个条件。" label="适用条件" value={draft.applicableWhen} onChange={(value) => update("applicableWhen", value)} />
    <ReviewTextArea description="至少填写一个明确边界。" label="不适用条件" value={draft.notApplicableWhen} onChange={(value) => update("notApplicableWhen", value)} />
    <div className={styles.confirmations}>
      <Checkbox className={styles.checkbox!} isDisabled={busy} isSelected={draft.confirmOutcome} onChange={(value) => update("confirmOutcome", value)}>
        <span aria-hidden="true" className={styles.checkboxIndicator}><Check size={11} /></span>
        <span><strong>我已核对任务结果</strong><small>成功、部分完成、失败或回滚与真实证据一致。</small></span>
      </Checkbox>
      <Checkbox className={styles.checkbox!} isDisabled={busy} isSelected={draft.confirmRedaction} onChange={(value) => update("confirmRedaction", value)}>
        <span aria-hidden="true" className={styles.checkboxIndicator}><Check size={11} /></span>
        <span><strong>我已核对脱敏结果</strong><small>不包含凭据、客户隐私、个人信息、本机路径或内部账号。</small></span>
      </Checkbox>
    </div>
    <footer className={styles.reviewActions}>
      <Button className="secondary-button" isDisabled={busy} onPress={onCancel}>取消</Button>
      <Button className="primary-button" isDisabled={busy} onPress={onSubmit}>{busy ? "正在保存…" : "保存人工审核"}</Button>
    </footer>
  </section>;
}

export function createReviewDraft(item: ExperienceCandidateSummary): CandidateReviewDraft {
  return {
    taskType: item.taskType,
    title: item.title,
    problem: item.problem,
    strategy: item.strategy,
    result: "",
    confidence: item.confidence.toFixed(2),
    sensitivity: item.sensitivity === "private" ? "project" : item.sensitivity,
    preconditions: item.method.preconditions.join("\n"),
    steps: item.method.steps.join("\n"),
    tools: item.method.tools.join("\n"),
    validationGates: item.method.validationGates.join("\n"),
    completionCriteria: item.method.completionCriteria.join("\n"),
    failureModes: item.method.failureModes.join("\n"),
    rollback: item.method.rollback,
    applicableWhen: item.applicableWhen.join("\n"),
    notApplicableWhen: item.notApplicableWhen.join("\n"),
    confirmOutcome: false,
    confirmRedaction: false
  };
}

export function buildExperienceCandidateReview(
  item: ExperienceCandidateSummary,
  draft: CandidateReviewDraft
): ExperienceCandidateReview | string {
  const confidence = Number(draft.confidence);
  const applicableWhen = lines(draft.applicableWhen);
  const notApplicableWhen = lines(draft.notApplicableWhen);
  const method = {
    preconditions: lines(draft.preconditions),
    steps: lines(draft.steps),
    tools: lines(draft.tools),
    validationGates: lines(draft.validationGates),
    completionCriteria: lines(draft.completionCriteria),
    failureModes: lines(draft.failureModes),
    rollback: draft.rollback.trim()
  };
  if (!draft.taskType.trim() || !draft.title.trim() || !draft.problem.trim() || !draft.strategy.trim()) {
    return "请完整填写任务类型、标题、问题和策略。";
  }
  if (!draft.result) return "请选择并确认真实任务结果。";
  if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) return "置信度必须在 0 到 1 之间。";
  if (applicableWhen.length === 0 || notApplicableWhen.length === 0) return "适用条件和不适用条件都至少需要一项。";
  if (method.preconditions.length === 0 || method.steps.length === 0) return "前置条件和关键步骤都至少需要一项。";
  if (method.validationGates.length === 0 || method.completionCriteria.length === 0) return "验证门禁和完成标准都至少需要一项。";
  if (method.failureModes.length === 0 || !method.rollback) return "请填写失败模式和回滚或不适用说明。";
  if (!draft.confirmOutcome || !draft.confirmRedaction) return "请完成结果确认和脱敏确认。";
  return {
    id: item.id,
    expectedUpdatedAt: item.updatedAt,
    taskType: draft.taskType.trim(),
    title: draft.title.trim(),
    problem: draft.problem.trim(),
    strategy: draft.strategy.trim(),
    result: draft.result,
    confidence,
    sensitivity: draft.sensitivity,
    method,
    applicableWhen,
    notApplicableWhen,
    evidence: [],
    confirmOutcome: true,
    confirmRedaction: true
  };
}

function ReviewTextField({ label, onChange, type = "text", value }: {
  label: string;
  onChange: (value: string) => void;
  type?: "text" | "number";
  value: string;
}) {
  return <TextField className={styles.field!} isRequired value={value} onChange={onChange}>
    <Label>{label}</Label>
    <Input min={type === "number" ? 0 : undefined} max={type === "number" ? 1 : undefined} step={type === "number" ? 0.05 : undefined} type={type} />
  </TextField>;
}

function ReviewTextArea({ description, isRequired = true, label, onChange, value }: {
  description?: string;
  isRequired?: boolean;
  label: string;
  onChange: (value: string) => void;
  value: string;
}) {
  return <TextField className={styles.field!} isRequired={isRequired} value={value} onChange={onChange}>
    <Label>{label}</Label>
    {description ? <small>{description}</small> : null}
    <TextArea />
  </TextField>;
}

function lines(value: string): string[] {
  return [...new Set(value.split(/\r?\n/u).map((item) => item.trim()).filter(Boolean))];
}
