import type {
  EnterpriseIdentityStatus,
  EnterpriseWorkspaceBinding,
  ExperienceCandidateSummary
} from "@pi67/domain";
import {
  assessSopReadiness,
  experienceMethodComplete,
  type SopReadinessReason
} from "@pi67/domain";
import { Check, RefreshCw, Send, ShieldCheck } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "react-aria-components";
import { agentConnectionController } from "../connection/AgentConnectionController.js";
import { publishNotification } from "../notifications/notification-store.js";
import { rendererWorkbenchStore, useWorkbenchStore } from "../workbench/workbench-store.js";
import {
  loadContextMemoryOverview,
  loadPrivateExperiences,
  rejectExperienceCandidate,
  reviewExperienceCandidate,
  submitExperienceCandidate
} from "./context-memory-controller.js";
import {
  ExperienceCandidateReviewForm,
  buildExperienceCandidateReview,
  createReviewDraft,
  experienceCandidateNeedsReview,
  type CandidateReviewDraft
} from "./ExperienceCandidateReviewForm.js";
import styles from "./MemoryInspectorPanel.module.css";

export function ExperienceInspectorPanel() {
  const workspaceId = useWorkbenchStore((state) => state.currentWorkspaceId);
  const [identity, setIdentity] = useState<EnterpriseIdentityStatus>({ state: "signed-out" });
  const [binding, setBinding] = useState<EnterpriseWorkspaceBinding>();
  const [items, setItems] = useState<ExperienceCandidateSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();

  const refreshGeneration = useRef(0);

  const refresh = useCallback(async (): Promise<void> => {
    const generation = ++refreshGeneration.current;
    setLoading(true);
    setError(undefined);
    try {
      const overview = await loadContextMemoryOverview(workspaceId);
      const candidates = workspaceId ? await loadPrivateExperiences(workspaceId) : [];
      if (generation !== refreshGeneration.current) return;
      setIdentity(overview.identity);
      setBinding(overview.binding);
      setItems(candidates);
    } catch (cause) {
      if (generation !== refreshGeneration.current) return;
      setError(cause instanceof Error ? cause.message : "无法读取经验候选。");
    } finally {
      if (generation === refreshGeneration.current) setLoading(false);
    }
  }, [workspaceId]);

  useEffect(() => {
    setItems([]);
    setBinding(undefined);
    setIdentity({ state: "signed-out" });
    void refresh();
    return () => { refreshGeneration.current += 1; };
  }, [refresh]);

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
  const validatedCount = items.filter((item) => (
    item.status === "validated" || item.status === "submitted" || item.status === "shared"
  )).length;
  const caseCount = items.reduce((total, item) => total + item.sourceCases.length, 0);
  const sopReadyCount = items.filter((item) => assessSopReadiness(item).state === "candidate-ready").length;

  return <div className={styles.panel} data-testid="experience-inspector">
    <section className={styles.hero}>
      <span className="section-label">Experience Governance</span>
      <strong>{identity.state === "signed-in" ? "Case 与企业经验已连接" : "本地 Case 与私人经验"}</strong>
      <p>{identity.state === "signed-in"
        ? `项目${binding?.state === "bound" ? "已绑定" : "未绑定"}；一次成功只形成任务 Case，经过验证才成为经验，多个独立 Case 才可能晋升 SOP。`
        : "无需登录即可保留私人经验；一次任务不会自动成为 SOP，登录也不会公开已有记忆。"}</p>
    </section>

    <dl className="metric-list">
      <div><dt>任务 Case</dt><dd>{caseCount}</dd></div>
      <div><dt>经验候选</dt><dd>{pendingCount}</dd></div>
      <div><dt>已验证经验</dt><dd>{validatedCount}</dd></div>
      <div><dt>SOP 候选</dt><dd>{sopReadyCount}</dd></div>
    </dl>

    <section className={styles.section}>
      <header>
        <span className="section-label">Case 与经验候选</span>
        <div className={styles.sectionActions}>
          <strong>{items.length} 项</strong>
          <Button aria-label="刷新经验候选" className={styles.iconButton!} isDisabled={loading} onPress={() => void refresh()}>
            <RefreshCw aria-hidden="true" className={loading ? styles.spinning : undefined} size={13} />
          </Button>
        </div>
      </header>
      {error ? <p className={styles.error} role="alert">{error}</p> : null}
      {loading && items.length === 0 ? <p className="context-empty">正在核对 OpenViking Commit 与本地候选…</p> : null}
      {!loading && items.length === 0 ? <p className="context-empty">尚无任务 Case 或经验候选。完整学习模式下，带精确 Commit 证据的任务会先成为 Case；人工核对后才成为可提交经验。</p>
        : <div className={styles.list}>{items.map((item) => <ExperienceCandidateCard
            enterpriseReady={enterpriseReady}
            item={item}
            key={item.id}
            onChanged={(candidate) => {
              if (rendererWorkbenchStore.getState().currentWorkspaceId === workspaceId) {
                setItems((current) => upsertCandidate(current, candidate));
              }
            }}
            {...(workspaceId === undefined ? {} : { workspaceId })}
          />)}</div>}
    </section>

    <section className={styles.boundary}>
      <strong>晋升与共享边界</strong>
      <p>私人 Session 与 Memory 不跨用户读取。Case 经审核成为经验；经验提交后仍不等于共享，更不等于 SOP。SOP 至少需要 3 个成功 Case、2 个 Workspace 和独立的版本治理。</p>
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
    && item.sensitivity !== "private"
    && experienceMethodComplete(item.method);
  const needsReview = experienceCandidateNeedsReview(item);
  const sopReadiness = assessSopReadiness(item);

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
      <span>Case：{item.sourceCases.length}</span>
      <span>证据：{item.evidence.length}</span>
      <span>脱敏：{redactionLabel(item.redactionStatus)}</span>
    </div>
    <div className={styles.sopReadiness} data-ready={sopReadiness.state === "candidate-ready"}>
      <strong>{sopReadiness.state === "candidate-ready" ? "具备 SOP 候选条件" : "尚不是 SOP"}</strong>
      <small>{sopReadiness.state === "candidate-ready"
        ? `已汇总 ${sopReadiness.caseCount} 个 Case；仍需企业 Owner、版本和发布审核。`
        : sopReadinessText(sopReadiness.reasons)}</small>
    </div>

    {needsReview ? <div className={styles.candidateActions}>
      <Button className="secondary-button" isDisabled={busy !== undefined} onPress={() => setReviewOpen((value) => !value)}>
        <ShieldCheck aria-hidden="true" size={13} />{reviewOpen
          ? "收起审核"
          : item.status === "validated" ? "补全经验方法" : "审核候选"}
      </Button>
      <Button className="secondary-button" isDisabled={busy !== undefined} onPress={() => void keepPrivate()}>
        {busy === "reject" ? "处理中…" : "仅保留私人"}
      </Button>
    </div> : null}

    {item.status === "validated" ? <div className={styles.candidateActions}>
      <Button className="primary-button" isDisabled={!canSubmit || busy !== undefined} onPress={() => void submit()}>
        <Send aria-hidden="true" size={13} />{busy === "submit" ? "正在提交…" : "提交企业审核"}
      </Button>
      {!enterpriseReady
        ? <small>请先登录企业账户并绑定当前项目。</small>
        : item.result !== "success"
          ? <small>只有已确认成功的经验可以提交。</small>
          : !experienceMethodComplete(item.method)
            ? <small>请先补全前置条件、步骤、验证门禁、完成标准、失败模式和回滚方式。</small>
            : null}
    </div> : null}

    {item.status === "submitted" ? <div className={styles.submittedNotice}>
      <Check aria-hidden="true" size={13} />已提交企业审核，尚未进入共享经验池。
    </div> : null}
    {item.status === "private" ? <div className={styles.privateNotice}>仅存在于当前用户的 OpenViking 私人空间。</div> : null}
    {item.status === "rejected" ? <div className={styles.privateNotice}>已从企业候选流程移除，私人 Experience 不受影响。</div> : null}
    {notice ? <p className={styles.notice} role="status">{notice}</p> : null}
    {error ? <p className={styles.error} role="alert">{error}</p> : null}
    {reviewOpen ? <ExperienceCandidateReviewForm
      busy={busy !== undefined}
      draft={draft}
      onCancel={() => setReviewOpen(false)}
      onChange={setDraft}
      onSubmit={() => void saveReview()}
    /> : null}
  </article>;
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

function sopReadinessText(reasons: SopReadinessReason[]): string {
  const labels = reasons.map((reason) => {
    if (reason === "experience-not-validated") return "经验尚未验证";
    if (reason === "insufficient-independent-cases") return "不足 3 个独立 Case";
    if (reason === "insufficient-independent-workspaces") return "不足 2 个 Workspace";
    if (reason === "case-outcome-not-successful") return "仍有未成功 Case";
    if (reason === "missing-preconditions") return "缺前置条件";
    if (reason === "missing-steps") return "缺关键步骤";
    if (reason === "missing-validation-gates") return "缺验证门禁";
    if (reason === "missing-completion-criteria") return "缺完成标准";
    if (reason === "missing-failure-modes") return "缺失败模式";
    return "缺回滚说明";
  });
  return [...new Set(labels)].slice(0, 3).join(" · ");
}
