import type { NativeSubagentView } from "@pi67/domain";
import { Bot, CircleStop, CornerDownRight, LoaderCircle, RotateCcw, Send } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { agentConnectionController } from "../connection/AgentConnectionController.js";
import {
  selectedWorkbenchTask,
  useWorkbenchStore,
  type RendererWorkbenchTask
} from "../workbench/workbench-store.js";
import { workbenchProtocolContextForTask } from "../workbench/workbench-protocol-context.js";
import { useSubagentStore } from "./subagent-store.js";

export function SubagentsPanel() {
  const task = useWorkbenchStore(selectedWorkbenchTask);
  const currentTask = isSessionReadyTask(task) ? task : undefined;
  const roster = useSubagentStore((state) => currentTask ? state.byTaskId[currentTask.id] : undefined);
  const replace = useSubagentStore((state) => state.replace);
  const upsert = useSubagentStore((state) => state.upsert);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();
  const [busyId, setBusyId] = useState<string>();
  const [steerId, setSteerId] = useState<string>();
  const [steerText, setSteerText] = useState("");
  const listRequestRevision = useRef(0);
  const taskRevision = useRef(0);

  useEffect(() => {
    taskRevision.current += 1;
    listRequestRevision.current += 1;
    setLoading(false);
    setBusyId(undefined);
    setError(undefined);
    setSteerId(undefined);
    setSteerText("");
    if (currentTask) void loadRoster(currentTask, listRequestRevision.current);
  }, [currentTask?.id, currentTask?.sessionId, currentTask?.sessionGeneration]);

  const items = useMemo(() => {
    if (!currentTask || !roster) return [];
    return roster.sessionId === currentTask.sessionId
      && roster.sessionGeneration === currentTask.sessionGeneration
      ? roster.items
      : [];
  }, [roster, currentTask?.sessionId, currentTask?.sessionGeneration]);

  if (!currentTask) {
    return <p className="context-empty">打开一个已建立 Pi Session 的任务后，可查看原生子代理。</p>;
  }

  return (
    <div className="inspector-agents">
      <header className="inspector-agents-header">
        <div>
          <span className="section-label">当前任务</span>
          <strong>{items.length > 0 ? `${items.length} 个原生子代理` : "原生子代理"}</strong>
        </div>
        <button disabled={loading} onClick={() => void loadRoster(currentTask, ++listRequestRevision.current)} type="button">
          {loading ? <LoaderCircle className="spin" size={13} /> : <RotateCcw size={13} />}
          刷新
        </button>
      </header>
      <p className="inspector-agents-help">
        子代理是独立 Pi JSONL Session；它不等于 Browser Profile，也不占用顶层任务名额。
      </p>
      {error ? <p className="inspector-error" role="alert">{error}</p> : null}
      {loading && roster === undefined ? (
        <div className="inspector-loading" role="status"><LoaderCircle className="spin" size={16} />正在读取子代理名册</div>
      ) : items.length === 0 ? (
        <div className="inspector-empty-graphic">
          <Bot size={20} />
          <span>Pi 调用原生 subagent Tool 后，子代理会显示在这里。</span>
        </div>
      ) : (
        <div aria-label="当前任务的原生子代理" className="inspector-agent-list" role="list">
          {items.map((item) => (
            <article className="inspector-agent-card" key={item.runId} role="listitem">
              <div className="inspector-agent-title-row">
                <span aria-hidden="true" className={`inspector-agent-state is-${item.state}`} />
                <div>
                  <strong>{roleLabel(item.role)}</strong>
                  <small>{stateLabel(item.state)} · 第 {item.depth} 层 · {item.mode === "background" ? "后台" : "前台"}</small>
                </div>
                <code title={item.childId}>{shortId(item.childId)}</code>
              </div>
              <dl className="inspector-agent-meta">
                <div><dt>模型</dt><dd>{item.model ? `${item.model.provider} / ${item.model.id}` : "继承父任务"}</dd></div>
                <div><dt>推理</dt><dd>{item.reasoning ?? "继承"}</dd></div>
                <div><dt>耗时</dt><dd>{durationLabel(item)}</dd></div>
                <div><dt>用量</dt><dd>{usageLabel(item)}</dd></div>
              </dl>
              {item.parentChildId ? (
                <p className="inspector-agent-lineage"><CornerDownRight size={12} />父子代理 {shortId(item.parentChildId)}</p>
              ) : null}
              {item.worktreePath ? <p className="inspector-agent-path" title={item.worktreePath}>Worktree · {item.worktreePath}</p> : null}
              {item.result ? <p className="inspector-agent-result">{item.result}</p> : null}
              {item.error ? <p className="inspector-agent-error" role="status">{item.error}</p> : null}
              <div className="inspector-agent-actions">
                {isLive(item) ? (
                  <>
                    <button
                      disabled={busyId !== undefined}
                      onClick={() => {
                        setSteerId(steerId === item.runId ? undefined : item.runId);
                        setSteerText("");
                      }}
                      type="button"
                    ><Send size={12} />引导</button>
                    <button
                      className="is-danger"
                      disabled={busyId !== undefined}
                      onClick={() => void mutate(currentTask, item.runId, "stop")}
                      type="button"
                    ><CircleStop size={12} />停止</button>
                  </>
                ) : item.state !== "completed" ? (
                  <button
                    disabled={busyId !== undefined}
                    onClick={() => void mutate(currentTask, item.runId, "resume")}
                    type="button"
                  ><RotateCcw size={12} />继续</button>
                ) : null}
              </div>
              {steerId === item.runId ? (
                <form className="inspector-agent-steer" onSubmit={(event) => {
                  event.preventDefault();
                  if (steerText.trim()) void mutate(currentTask, item.runId, "steer", steerText.trim());
                }}>
                  <label htmlFor={`subagent-steer-${item.runId}`}>追加引导</label>
                  <textarea
                    autoFocus
                    id={`subagent-steer-${item.runId}`}
                    maxLength={16_384}
                    onChange={(event) => setSteerText(event.target.value)}
                    placeholder="补充范围、证据或停止条件"
                    rows={3}
                    value={steerText}
                  />
                  <div>
                    <button onClick={() => setSteerId(undefined)} type="button">取消</button>
                    <button disabled={!steerText.trim() || busyId !== undefined} type="submit">发送引导</button>
                  </div>
                </form>
              ) : null}
            </article>
          ))}
        </div>
      )}
    </div>
  );

  async function loadRoster(currentTask: SessionReadyTask, revision: number) {
    setLoading(true);
    setError(undefined);
    try {
      const result = await agentConnectionController.request(
        "subagent.list",
        {},
        [],
        { context: workbenchProtocolContextForTask(currentTask) }
      );
      if (listRequestRevision.current !== revision) return;
      replace(
        currentTask.id,
        currentTask.sessionId,
        currentTask.sessionGeneration,
        result.items
      );
    } catch (cause) {
      if (listRequestRevision.current === revision) setError(errorMessage(cause));
    } finally {
      if (listRequestRevision.current === revision) setLoading(false);
    }
  }

  async function mutate(
    currentTask: SessionReadyTask,
    id: string,
    action: "stop" | "resume" | "steer",
    text?: string
  ) {
    const revision = taskRevision.current;
    setBusyId(id);
    setError(undefined);
    try {
      const item = action === "stop"
        ? await agentConnectionController.request(
            "subagent.stop",
            { id },
            [],
            { context: workbenchProtocolContextForTask(currentTask) }
          )
        : action === "resume"
          ? await agentConnectionController.request(
              "subagent.resume",
              { id, mode: "background" },
              [],
              { context: workbenchProtocolContextForTask(currentTask) }
            )
          : await agentConnectionController.request(
              "subagent.steer",
              { id, text: text ?? "" },
              [],
              { context: workbenchProtocolContextForTask(currentTask) }
            );
      upsert(currentTask.id, currentTask.sessionId, currentTask.sessionGeneration, item);
      if (taskRevision.current === revision) {
        setSteerId(undefined);
        setSteerText("");
      }
    } catch (cause) {
      if (taskRevision.current === revision) setError(errorMessage(cause));
    } finally {
      if (taskRevision.current === revision) setBusyId(undefined);
    }
  }
}

type SessionReadyTask = RendererWorkbenchTask & {
  sessionFileIdentity: string;
  sessionGeneration: number;
};

function isSessionReadyTask(task: RendererWorkbenchTask | undefined): task is SessionReadyTask {
  return task !== undefined
    && !task.sessionId.startsWith("pending:")
    && task.sessionFileIdentity !== undefined
    && task.sessionGeneration !== undefined;
}

function roleLabel(role: NativeSubagentView["role"]): string {
  if (role === "explorer") return "探索代理";
  if (role === "worker") return "实施代理";
  if (role === "reviewer") return "审查代理";
  return "通用代理";
}

function stateLabel(state: NativeSubagentView["state"]): string {
  return {
    pending: "准备中",
    running: "运行中",
    waiting: "等待中",
    idle: "空闲",
    completed: "已完成",
    failed: "失败",
    cancelled: "已停止",
    interrupted: "已中断"
  }[state];
}

function isLive(item: NativeSubagentView): boolean {
  return item.state === "pending"
    || item.state === "running"
    || item.state === "waiting"
    || item.state === "idle";
}

function shortId(value: string): string {
  return value.length <= 10 ? value : value.slice(0, 8);
}

function durationLabel(item: NativeSubagentView): string {
  if (!item.startedAt) return "尚未开始";
  const end = item.settledAt ?? Date.now();
  const seconds = Math.max(0, Math.round((end - item.startedAt) / 1_000));
  if (seconds < 60) return `${seconds} 秒`;
  return `${Math.floor(seconds / 60)} 分 ${seconds % 60} 秒`;
}

function usageLabel(item: NativeSubagentView): string {
  if (!item.usage) return "尚无";
  return `${item.usage.input + item.usage.output} tokens`;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "无法控制原生子代理";
}
