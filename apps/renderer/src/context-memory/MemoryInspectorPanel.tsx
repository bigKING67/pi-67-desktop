import type {
  ContextRecallMetrics,
  ContextRecallItem,
  ContextRuntimeStatus,
  ContextSessionStatus,
  MemoryEntrySummary,
  RecallFeedbackKind
} from "@pi67/domain";
import { Search } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button, Input, SearchField } from "react-aria-components";
import { selectSessionGeneration, selectSessionId } from "../session/session-projection-selectors.js";
import { useSessionProjectionStore } from "../session/session-projection-store.js";
import { useWorkbenchStore } from "../workbench/workbench-store.js";
import {
  loadContextMemoryOverview,
  loadContextSession,
  loadRecallMetrics,
  loadRecallItems,
  searchPrivateMemories,
  submitRecallFeedback
} from "./context-memory-controller.js";
import { archiveOutcomeMessage, archiveWithFeedback } from "./context-archive-feedback.js";
import { watchMemoryInspector } from "./memory-inspector-refresh.js";
import styles from "./MemoryInspectorPanel.module.css";

export function MemoryInspectorPanel() {
  const workspaceId = useWorkbenchStore((state) => state.currentWorkspaceId);
  return <WorkspaceMemoryInspector key={workspaceId ?? "no-workspace"} workspaceId={workspaceId} />;
}

function WorkspaceMemoryInspector({ workspaceId }: { workspaceId: string | undefined }) {
  const searchGeneration = useRef(0);
  const sessionId = useSessionProjectionStore(selectSessionId);
  const sessionGeneration = useSessionProjectionStore(selectSessionGeneration);
  const [status, setStatus] = useState<ContextRuntimeStatus>();
  const [session, setSession] = useState<ContextSessionStatus>();
  const [recalls, setRecalls] = useState<ContextRecallItem[]>([]);
  const [metrics, setMetrics] = useState<ContextRecallMetrics>();
  const [memories, setMemories] = useState<MemoryEntrySummary[]>([]);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [archiving, setArchiving] = useState(false);
  const [archiveError, setArchiveError] = useState<string>();
  const [archiveMessage, setArchiveMessage] = useState<string>();
  const archiveController = useRef<AbortController | undefined>(undefined);
  const [feedbackBusyId, setFeedbackBusyId] = useState<string>();

  useEffect(() => {
    archiveController.current?.abort();
    setArchiving(false);
    setArchiveMessage(undefined);
    setArchiveError(undefined);
    setBusy(true);
    setError(undefined);
    setStatus(undefined);
    setSession(undefined);
    setRecalls([]);
    setMetrics(undefined);
    let needsOverview = true;
    const stop = watchMemoryInspector({ workspaceId, sessionId, sessionGeneration }, async (isCurrent) => {
      const overview = needsOverview ? await loadContextMemoryOverview(workspaceId) : undefined;
      if (!isCurrent()) return;
      if (workspaceId) {
        const [nextSession, nextRecalls, nextMetrics] = await Promise.all([
          sessionId ? loadContextSession(workspaceId, sessionId) : Promise.resolve(undefined),
          loadRecallItems(workspaceId, sessionId),
          loadRecallMetrics(workspaceId)
        ]);
        if (isCurrent()) {
          setSession(nextSession);
          setRecalls(nextRecalls);
          setMetrics(nextMetrics);
        }
      } else if (isCurrent()) {
        setSession(undefined);
        setRecalls([]);
        setMetrics(undefined);
      }
      if (isCurrent()) {
        if (overview) setStatus(overview.status);
        needsOverview = false;
        setError(undefined);
        setBusy(false);
      }
    }, (cause) => {
      needsOverview = true;
      setStatus(undefined);
      setSession(undefined);
      setRecalls([]);
      setMetrics(undefined);
      setBusy(false);
      setError(cause.message);
    });
    return () => { stop(); archiveController.current?.abort(); };
  }, [workspaceId, sessionId, sessionGeneration]);

  const archive = async (): Promise<void> => {
    if (!workspaceId || !sessionId || archiving || (archiveController.current && !archiveController.current.signal.aborted)) return;
    const controller = new AbortController();
    archiveController.current = controller;
    setArchiving(true);
    setArchiveError(undefined);
    setArchiveMessage("正在提交归档请求…");
    try {
      const outcome = await archiveWithFeedback(workspaceId, sessionId, controller.signal,
        () => setArchiveMessage("归档请求已受理，正在等待处理结果；这还不代表记忆抽取完成。"));
      if (!controller.signal.aborted) setArchiveMessage(archiveOutcomeMessage[outcome]);
    } catch (cause) {
      if (!controller.signal.aborted) {
        setArchiveMessage(undefined);
        setArchiveError(cause instanceof Error ? cause.message : "归档请求未能受理。");
      }
    } finally {
      if (!controller.signal.aborted) setArchiving(false);
      controller.abort();
    }
  };

  const search = async (): Promise<void> => {
    if (!workspaceId || !query.trim()) return;
    setBusy(true);
    setError(undefined);
    const generation = ++searchGeneration.current;
    try {
      const result = await searchPrivateMemories(workspaceId, query.trim());
      if (generation === searchGeneration.current) setMemories(result);
    } catch (cause) {
      if (generation === searchGeneration.current) setError(cause instanceof Error ? cause.message : "记忆搜索失败。");
    } finally {
      if (generation === searchGeneration.current) setBusy(false);
    }
  };

  const recordFeedback = async (item: ContextRecallItem, feedback: RecallFeedbackKind): Promise<void> => {
    if (!workspaceId) return;
    setFeedbackBusyId(item.id);
    setError(undefined);
    try {
      const recorded = await submitRecallFeedback(workspaceId, item.id, feedback, sessionId);
      setRecalls((current) => current.map((candidate) => candidate.id === item.id
        ? { ...candidate, feedback: recorded.feedback }
        : candidate));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "召回反馈保存失败。");
    } finally {
      setFeedbackBusyId(undefined);
    }
  };

  return <div className={styles.panel} data-testid="memory-inspector">
    <section className={styles.hero}>
      <span className="section-label">OpenViking</span>
      <strong>{status ? healthLabel(status.health) : busy ? "正在读取…" : "未连接"}</strong>
      <p>{status?.owner === "pi67-openviking"
        ? "OpenViking 服务可连接；当前会话的捕获情况以已读取的统计为准。"
        : "当前使用 Pi 默认上下文回退；Memory 不会阻止对话。"}</p>
    </section>

    <section className={styles.section} aria-label="当前会话归档">
      <header><span className="section-label">当前会话</span>
        <Button className="secondary-button" isDisabled={!workspaceId || !sessionId || archiving} onPress={() => void archive()}>{archiving ? "等待归档结果…" : "立即归档"}</Button>
      </header>
      <p className={styles.metricNote}>{sessionId ? "归档当前会话，并在后台提取记忆。" : "打开会话后可归档。"}</p>
      {archiveMessage ? <p className={`${styles.notice} ${styles.archiveStatus}`} role="status">{archiveMessage}</p> : null}
      {archiveError ? <p className={styles.error} role="alert">{archiveError}</p> : null}
    </section>

    <dl className="metric-list">
      <div><dt>已捕获消息数</dt><dd>{session?.capturedTurns ?? "未知"}</dd></div>
      <div><dt>Pending Tokens</dt><dd>{session?.pendingTokens.toLocaleString() ?? "未知"}</dd></div>
      <div><dt>Live Tail</dt><dd>{session ? `${session.liveTailTurns} Turns` : "-"}</dd></div>
      <div><dt>Takeover</dt><dd>{session ? session.takeoverActive ? "Active" : "Fallback" : "未知"}</dd></div>
    </dl>

    <section className={styles.section} aria-label="召回质量">
      <header><span className="section-label">召回质量</span><strong>{metrics?.sampleCount ?? 0} 个样本</strong></header>
      <dl className="metric-list">
        <div><dt>p50</dt><dd>{latencyLabel(metrics?.p50Ms)}</dd></div>
        <div><dt>p95</dt><dd data-state={metrics?.withinTarget === false ? "warning" : "normal"}>{latencyLabel(metrics?.p95Ms)}</dd></div>
        <div><dt>自动召回</dt><dd>{rateLabel(metrics?.automaticRecallRate)}</dd></div>
        <div><dt>按需搜索</dt><dd>{rateLabel(metrics?.toolSearchRate)}</dd></div>
      </dl>
      <p className={styles.metricNote}>目标 p95 ≤ {metrics?.targetP95Ms ?? 1_500} ms；只记录路由、耗时、数量和哈希，不记录查询或记忆正文。</p>
    </section>

    <section className={styles.section}>
      <header><span className="section-label">本轮召回</span><strong>{recalls.length} 项</strong></header>
      {recalls.length === 0
        ? <p className="context-empty">当前没有可展示的 Recall 诊断；这不代表 OpenViking 没有捕获 Session。</p>
        : <div className={styles.list}>{recalls.map((item) => <RecallRow
            busy={feedbackBusyId === item.id}
            item={item}
            key={item.id}
            onFeedback={(feedback) => void recordFeedback(item, feedback)}
          />)}</div>}
    </section>

    <section className={styles.section}>
      <header><span className="section-label">私人记忆</span><strong>{memories.length} 项</strong></header>
      <SearchField aria-label="搜索私人记忆" className={styles.search!} value={query} onChange={setQuery} onSubmit={() => void search()}>
        <Search aria-hidden="true" size={13} />
        <Input placeholder="搜索当前项目的私人记忆" />
        <Button isDisabled={busy || !query.trim()} onPress={() => void search()}>搜索</Button>
      </SearchField>
      {error ? <p className={styles.error} role="alert">{error}</p> : null}
      {memories.length > 0 ? <div className={styles.list}>{memories.map((item) => <MemoryRow item={item} key={item.id} />)}</div> : null}
    </section>
  </div>;
}

export function RecallRow({
  item,
  busy = false,
  onFeedback = () => undefined
}: {
  item: ContextRecallItem;
  busy?: boolean;
  onFeedback?: (feedback: RecallFeedbackKind) => void;
}) {
  return <article className={styles.row}>
    <div><strong>{item.title}</strong><small>{sourceLabel(item.source)} · {item.scope}</small></div>
    <span>{item.score.toFixed(2)}</span>
    <p>{item.reason}</p>
    <div className={styles.feedback} aria-label={`评价召回：${item.title}`}>
      {FEEDBACK_OPTIONS.map((option) => <Button
        data-selected={item.feedback === option.value || undefined}
        isDisabled={busy}
        key={option.value}
        onPress={() => onFeedback(option.value)}
      >{option.label}</Button>)}
    </div>
  </article>;
}

const FEEDBACK_OPTIONS: ReadonlyArray<{ value: RecallFeedbackKind; label: string }> = [
  { value: "helpful", label: "有用" },
  { value: "irrelevant", label: "无关" },
  { value: "outdated", label: "过期" },
  { value: "wrong-scope", label: "错范围" },
  { value: "incorrect", label: "错误" }
];

function MemoryRow({ item }: { item: MemoryEntrySummary }) {
  return <article className={styles.row}>
    <div><strong>{item.title}</strong><small>{item.scope} · OpenViking</small></div>
    <p>{item.summary || "该条目没有摘要。"}</p>
  </article>;
}

function healthLabel(value: ContextRuntimeStatus["health"]): string {
  if (value === "healthy") return "运行正常";
  if (value === "conflict") return "Context Owner 冲突";
  if (value === "disabled") return "记忆已关闭";
  if (value === "degraded") return "降级运行";
  return "服务不可用";
}

function sourceLabel(value: ContextRecallItem["source"]): string {
  if (value === "private-memory") return "私人记忆";
  if (value === "private-experience") return "私人经验";
  if (value === "shared-experience") return "团队经验";
  return "资源";
}

function latencyLabel(value: number | undefined): string {
  return value === undefined ? "-" : `${value.toLocaleString()} ms`;
}

function rateLabel(value: number | undefined): string {
  return value === undefined ? "-" : `${Math.round(value * 100)}%`;
}
