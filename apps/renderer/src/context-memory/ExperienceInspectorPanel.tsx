import type {
  EnterpriseIdentityStatus,
  EnterpriseWorkspaceBinding,
  ExperienceCandidateSummary,
  ExperienceResult
} from "@pi67/domain";
import type { ExperienceCandidateReview } from "@pi67/protocol";
import { Check, RefreshCw, Send, ShieldCheck } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Button, Checkbox, Input, Label, TextArea, TextField } from "react-aria-components";
import { agentConnectionController } from "../connection/AgentConnectionController.js";
import { publishNotification } from "../notifications/notification-store.js";
import { useWorkbenchStore } from "../workbench/workbench-store.js";
import {
  loadContextMemoryOverview,
  loadPrivateExperiences,
  rejectExperienceCandidate,
  reviewExperienceCandidate,
  submitExperienceCandidate
} from "./context-memory-controller.js";
import styles from "./MemoryInspectorPanel.module.css";

export interface CandidateReviewDraft {
  taskType: string;
  title: string;
  problem: string;
  strategy: string;
  result: "" | ExperienceResult;
  confidence: string;
  sensitivity: "project" | "team" | "company";
  applicableWhen: string;
  notApplicableWhen: string;
  confirmOutcome: boolean;
  confirmRedaction: boolean;
}

export function ExperienceInspectorPanel() {
  const workspaceId = useWorkbenchStore((state) => state.currentWorkspaceId);
  const [identity, setIdentity] = useState<EnterpriseIdentityStatus>({ state: "signed-out" });
  const [binding, setBinding] = useState<EnterpriseWorkspaceBinding>();
  const [items, setItems] = useState<ExperienceCandidateSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();

  const refresh = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(undefined);
    try {
      const overview = await loadContextMemoryOverview(workspaceId);
      setIdentity(overview.identity);
      setBinding(overview.binding);
      setItems(workspaceId ? await loadPrivateExperiences(workspaceId) : []);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "无法读取经验候选。");
    } finally {
      setLoading(false);
    }
  }, [workspaceId]);

  useEffect(() => { void refresh(); }, [refresh]);

  useEffect(() => agentConnectionController.subscribe({
    onEvent: (event, envelope) => {
      if (!workspaceId || envelope.context.scope !== "workspace" || envelope.context.workspaceId !== workspaceId) return;
      if (event.type === "experience.candidateCreated"
        || event.type === "experience.candidateValidated"
        || event.type === "experience.candidateRejected") {
        setItems((current) => upsertCandidate(current, event.payload));
      } else if (event.type === "experience.candidatePromoted") {
        setItems((current) => upsertCandidate(current, event.payload.candidate));
        publishNotification({
          level: "success",
          title: "经验候选已提交企业审核",
          message: "提交不等于共享；只有企业审核通过并发布后，其他成员才能召回。"
        });
      } else if (event.type === "experience.candidatePromotionFailed") {
        setError(`候选提交失败：${event.payload.detail}`);
      } else if (event.type === "experience.candidateAssemblyFailed") {
        setError(`候选生成失败：${event.payload.detail}`);
      }
    }
  }), [workspaceId]);

  const enterpriseReady = identity.state === "signed-in" && binding?.state === "bound";
  const pendingCount = items.filter((item) => item.status === "candidate").length;
  const validatedCount = items.filter((item) => item.status === "validated").length;

  return <div className={styles.panel} data-testid="experience-inspector">
    <section className={styles.hero}>
      <span className="section-label">Experience Governance</span>
      <strong>{identity.state === "signed-in" ? "企业经验已连接" : "本地私人经验"}</strong>
      <p>{identity.state === "signed-in"
        ? `项目${binding?.state === "bound" ? "已绑定" : "未绑定"}；候选仍需脱敏、验证和企业审核后才能共享。`
        : "无需登录即可保留私人经验；登录不会自动公开已有记忆。"}</p>
    </section>

    <dl className="metric-list">
      <div><dt>私人经验</dt><dd>{items.filter((item) => item.status === "private").length}</dd></div>
      <div><dt>待人工审核</dt><dd>{pendingCount}</dd></div>
      <div><dt>可提交候选</dt><dd>{validatedCount}</dd></div>
      <div><dt>项目绑定</dt><dd>{binding?.state === "bound" ? "已绑定" : "未绑定"}</dd></div>
    </dl>

    <section className={styles.section}>
      <header>
        <span className="section-label">经验候选</span>
        <div className={styles.sectionActions}>
          <strong>{items.length} 项</strong>
          <Button aria-label="刷新经验候选" className={styles.iconButton!} isDisabled={loading} onPress={() => void refresh()}>
            <RefreshCw aria-hidden="true" className={loading ? styles.spinning : undefined} size={13} />
          </Button>
        </div>
      </header>
      {error ? <p className={styles.error} role="alert">{error}</p> : null}
      {loading && items.length === 0 ? <p className="context-empty">正在核对 OpenViking Commit 与本地候选…</p> : null}
      {!loading && items.length === 0 ? <p className="context-empty">尚无经验候选。只有完整学习模式下、带精确 Commit 证据并通过本地脱敏的任务才会进入这里。</p>
        : <div className={styles.list}>{items.map((item) => <ExperienceCandidateCard
            enterpriseReady={enterpriseReady}
            item={item}
            key={item.id}
            onChanged={(candidate) => setItems((current) => upsertCandidate(current, candidate))}
            {...(workspaceId === undefined ? {} : { workspaceId })}
          />)}</div>}
    </section>

    <section className={styles.boundary}>
      <strong>共享边界</strong>
      <p>私人 Session 与 Memory 不跨用户读取。这里提交的是新建的脱敏候选；“已提交”仍不等于“已共享”，企业发布资产保留独立撤回和审计记录。</p>
    </section>
  </div>;
}

function ExperienceCandidateCard({
  enterpriseReady,
  item,
  onChanged,
  workspaceId
}: {
  enterpriseReady: boolean;
  item: ExperienceCandidateSummary;
  onChanged: (candidate: ExperienceCandidateSummary) => void;
  workspaceId?: string;
}) {
  const [reviewOpen, setReviewOpen] = useState(false);
  const [draft, setDraft] = useState<CandidateReviewDraft>(() => createReviewDraft(item));
  const [busy, setBusy] = useState<"review" | "submit" | "reject">();
  const [notice, setNotice] = useState<string>();
  const [error, setError] = useState<string>();

  const saveReview = async (): Promise<void> => {
    if (!workspaceId) return;
    const review = buildExperienceCandidateReview(item, draft);
    if (typeof review === "string") {
      setError(review);
      return;
    }
    setBusy("review");
    setError(undefined);
    setNotice(undefined);
    try {
      const saved = await reviewExperienceCandidate(workspaceId, review);
      onChanged(saved);
      setReviewOpen(false);
      setNotice("人工审核已记录；尚未提交企业。请再次确认后提交审核。");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "经验候选审核失败。");
    } finally {
      setBusy(undefined);
    }
  };

  const submit = async (): Promise<void> => {
    if (!workspaceId) return;
    setBusy("submit");
    setError(undefined);
    setNotice(undefined);
    try {
      await submitExperienceCandidate(workspaceId, item.id);
      setNotice("提交已被 Agent Host 接收；正在等待企业 Gateway 回执。");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "经验候选提交失败。");
    } finally {
      setBusy(undefined);
    }
  };

  const keepPrivate = async (): Promise<void> => {
    if (!workspaceId) return;
    setBusy("reject");
    setError(undefined);
    try {
      onChanged(await rejectExperienceCandidate(workspaceId, item.id, "User chose to keep this Experience private"));
      setReviewOpen(false);
      setNotice("该候选不会提交企业；OpenViking 私人经验保持不变。");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "无法更新候选状态。");
    } finally {
      setBusy(undefined);
    }
  };

  const canSubmit = enterpriseReady
    && item.status === "validated"
    && item.result === "success"
    && item.redactionStatus === "passed"
    && item.sensitivity !== "private";

  return <article className={`${styles.row} ${styles.experienceRow}`} data-status={item.status}>
    <div className={styles.candidateHeading}>
      <strong>{item.title}</strong>
      <small>{statusLabel(item.status)} · 置信度 {item.confidence.toFixed(2)}</small>
    </div>
    <span className={styles.statusPill} data-status={item.status}>{statusLabel(item.status)}</span>
    <p>{item.strategy}</p>
    <div className={styles.candidateMeta}>
      <span>结果：{resultLabel(item.result)}</span>
      <span>范围：{sensitivityLabel(item.sensitivity)}</span>
      <span>证据：{item.evidence.length}</span>
      <span>脱敏：{redactionLabel(item.redactionStatus)}</span>
    </div>

    {item.status === "candidate" ? <div className={styles.candidateActions}>
      <Button className="secondary-button" isDisabled={busy !== undefined} onPress={() => setReviewOpen((value) => !value)}>
        <ShieldCheck aria-hidden="true" size={13} />{reviewOpen ? "收起审核" : "审核候选"}
      </Button>
      <Button className="secondary-button" isDisabled={busy !== undefined} onPress={() => void keepPrivate()}>
        {busy === "reject" ? "处理中…" : "仅保留私人"}
      </Button>
    </div> : null}

    {item.status === "validated" ? <div className={styles.candidateActions}>
      <Button className="primary-button" isDisabled={!canSubmit || busy !== undefined} onPress={() => void submit()}>
        <Send aria-hidden="true" size={13} />{busy === "submit" ? "正在提交…" : "提交企业审核"}
      </Button>
      {!enterpriseReady ? <small>请先登录企业账户并绑定当前项目。</small> : item.result !== "success" ? <small>只有已确认成功的经验可以提交。</small> : null}
    </div> : null}

    {item.status === "submitted" ? <div className={styles.submittedNotice}>
      <Check aria-hidden="true" size={13} />已提交企业审核，尚未进入共享经验池。
    </div> : null}
    {item.status === "private" ? <div className={styles.privateNotice}>仅存在于当前用户的 OpenViking 私人空间。</div> : null}
    {item.status === "rejected" ? <div className={styles.privateNotice}>已从企业候选流程移除，私人 Experience 不受影响。</div> : null}
    {notice ? <p className={styles.notice} role="status">{notice}</p> : null}
    {error ? <p className={styles.error} role="alert">{error}</p> : null}
    {reviewOpen ? <CandidateReviewForm
      busy={busy !== undefined}
      draft={draft}
      onCancel={() => setReviewOpen(false)}
      onChange={setDraft}
      onSubmit={() => void saveReview()}
    /> : null}
  </article>;
}

function CandidateReviewForm({ busy, draft, onCancel, onChange, onSubmit }: {
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

function ReviewTextArea({ description, label, onChange, value }: {
  description?: string;
  label: string;
  onChange: (value: string) => void;
  value: string;
}) {
  return <TextField className={styles.field!} isRequired value={value} onChange={onChange}>
    <Label>{label}</Label>
    {description ? <small>{description}</small> : null}
    <TextArea />
  </TextField>;
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
  if (!draft.taskType.trim() || !draft.title.trim() || !draft.problem.trim() || !draft.strategy.trim()) {
    return "请完整填写任务类型、标题、问题和策略。";
  }
  if (!draft.result) return "请选择并确认真实任务结果。";
  if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) return "置信度必须在 0 到 1 之间。";
  if (applicableWhen.length === 0 || notApplicableWhen.length === 0) return "适用条件和不适用条件都至少需要一项。";
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
    applicableWhen,
    notApplicableWhen,
    evidence: [],
    confirmOutcome: true,
    confirmRedaction: true
  };
}

function lines(value: string): string[] {
  return [...new Set(value.split(/\r?\n/u).map((item) => item.trim()).filter(Boolean))];
}

function upsertCandidate(items: ExperienceCandidateSummary[], candidate: ExperienceCandidateSummary): ExperienceCandidateSummary[] {
  const index = items.findIndex((item) => item.id === candidate.id);
  if (index < 0) return [candidate, ...items];
  const next = [...items];
  next[index] = candidate;
  return next;
}

function statusLabel(value: ExperienceCandidateSummary["status"]): string {
  if (value === "private") return "私人经验";
  if (value === "candidate") return "待人工审核";
  if (value === "validated") return "已验证";
  if (value === "submitted") return "企业审核中";
  if (value === "shared") return "已共享";
  if (value === "rejected") return "仅保留私人";
  return "已撤回";
}

function resultLabel(value: ExperienceCandidateSummary["result"]): string {
  if (value === "success") return "成功";
  if (value === "partial") return "部分完成";
  if (value === "failed") return "失败";
  return "已回滚";
}

function sensitivityLabel(value: ExperienceCandidateSummary["sensitivity"]): string {
  if (value === "private") return "私人";
  if (value === "project") return "企业项目";
  if (value === "team") return "团队";
  return "企业";
}

function redactionLabel(value: ExperienceCandidateSummary["redactionStatus"]): string {
  if (value === "passed") return "已核对";
  if (value === "failed") return "失败";
  return "待核对";
}
