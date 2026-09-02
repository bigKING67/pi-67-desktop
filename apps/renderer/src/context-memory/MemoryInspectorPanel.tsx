import type {
  ContextRecallItem,
  ContextRuntimeStatus,
  ContextSessionStatus,
  MemoryEntrySummary
} from "@pi67/domain";
import { Search } from "lucide-react";
import { useEffect, useState } from "react";
import { Button, Input, SearchField } from "react-aria-components";
import { selectSessionId } from "../session/session-projection-selectors.js";
import { useSessionProjectionStore } from "../session/session-projection-store.js";
import { useWorkbenchStore } from "../workbench/workbench-store.js";
import {
  loadContextMemoryOverview,
  loadContextSession,
  loadRecallItems,
  searchPrivateMemories
} from "./context-memory-controller.js";
import styles from "./MemoryInspectorPanel.module.css";

export function MemoryInspectorPanel() {
  const workspaceId = useWorkbenchStore((state) => state.currentWorkspaceId);
  const sessionId = useSessionProjectionStore(selectSessionId);
  const [status, setStatus] = useState<ContextRuntimeStatus>();
  const [session, setSession] = useState<ContextSessionStatus>();
  const [recalls, setRecalls] = useState<ContextRecallItem[]>([]);
  const [memories, setMemories] = useState<MemoryEntrySummary[]>([]);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  useEffect(() => {
    let active = true;
    setBusy(true);
    setError(undefined);
    void loadContextMemoryOverview(workspaceId).then(async (overview) => {
      if (!active) return;
      setStatus(overview.status);
      if (workspaceId && sessionId) {
        const [nextSession, nextRecalls] = await Promise.all([
          loadContextSession(workspaceId, sessionId),
          loadRecallItems(workspaceId, sessionId)
        ]);
        if (active) {
          setSession(nextSession);
          setRecalls(nextRecalls);
        }
      }
    }).catch((cause) => {
      if (active) setError(cause instanceof Error ? cause.message : "无法读取记忆状态。");
    }).finally(() => { if (active) setBusy(false); });
    return () => { active = false; };
  }, [workspaceId, sessionId]);

  const search = async (): Promise<void> => {
    if (!workspaceId || !query.trim()) return;
    setBusy(true);
    setError(undefined);
    try {
      setMemories(await searchPrivateMemories(workspaceId, query.trim()));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "记忆搜索失败。");
    } finally {
      setBusy(false);
    }
  };

  return <div className={styles.panel} data-testid="memory-inspector">
    <section className={styles.hero}>
      <span className="section-label">OpenViking</span>
      <strong>{status ? healthLabel(status.health) : busy ? "正在读取…" : "未连接"}</strong>
      <p>{status?.owner === "pi67-openviking"
        ? "当前 Session 由 OpenViking 管理；Pi JSONL 保留完整事实。"
        : "当前使用 Pi 默认上下文回退；Memory 不会阻止对话。"}</p>
    </section>

    <dl className="metric-list">
      <div><dt>Captured Turns</dt><dd>{session?.capturedTurns ?? 0}</dd></div>
      <div><dt>Pending Tokens</dt><dd>{session?.pendingTokens.toLocaleString() ?? "0"}</dd></div>
      <div><dt>Live Tail</dt><dd>{session ? `${session.liveTailTurns} Turns` : "-"}</dd></div>
      <div><dt>Takeover</dt><dd>{session?.takeoverActive ? "Active" : "Fallback"}</dd></div>
    </dl>

    <section className={styles.section}>
      <header><span className="section-label">本轮召回</span><strong>{recalls.length} 项</strong></header>
      {recalls.length === 0
        ? <p className="context-empty">当前没有可展示的 Recall 诊断；这不代表 OpenViking 没有捕获 Session。</p>
        : <div className={styles.list}>{recalls.map((item) => <RecallRow item={item} key={item.id} />)}</div>}
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

function RecallRow({ item }: { item: ContextRecallItem }) {
  return <article className={styles.row}>
    <div><strong>{item.title}</strong><small>{sourceLabel(item.source)} · {item.scope}</small></div>
    <span>{item.score.toFixed(2)}</span>
    <p>{item.reason}</p>
  </article>;
}

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
