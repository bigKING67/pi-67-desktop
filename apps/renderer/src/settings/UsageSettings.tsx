import type { UsageBucket, UsageReport, UsageWindow } from "@pi67/domain";
import { AlertTriangle, BarChart3, LoaderCircle, RefreshCw } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "react-aria-components";
import { useAppStore } from "../app/app-store.js";
import { agentConnectionController } from "../connection/AgentConnectionController.js";
import { rendererWorkbenchStore, useWorkbenchStore } from "../workbench/workbench-store.js";
import { registerRendererWorkspaceWithHost } from "../workbench/workspace-host-registration-controller.js";
import { SettingsNotice, SettingsSectionBlock } from "./SettingsPrimitives.js";
import { isUsageReportRequestCurrent } from "./usage-report-request.js";
import styles from "./UsageSettings.module.css";

const WINDOWS: Array<{ id: UsageWindow; label: string }> = [
  { id: "7d", label: "7 天" },
  { id: "30d", label: "30 天" },
  { id: "90d", label: "90 天" }
];

export function UsageSettings() {
  const workspaceId = useWorkbenchStore((state) => state.settingsWorkspaceId ?? state.currentWorkspaceId);
  const workspace = useWorkbenchStore((state) => workspaceId ? state.workspaces[workspaceId] : undefined);
  const connected = useAppStore((state) => state.connected);
  const hostEpoch = useAppStore((state) => state.hostEpoch);
  const [window, setWindow] = useState<UsageWindow>("30d");
  const [report, setReport] = useState<UsageReport>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();
  const requestRevision = useRef(0);

  useEffect(() => {
    requestRevision.current += 1;
    setReport(undefined);
    setError(undefined);
    setLoading(false);
    if (workspace && connected && hostEpoch !== undefined) void loadReport();
  }, [workspace?.id, hostEpoch, window]);

  const daily = useMemo(() => aggregateDaily(report?.buckets ?? []), [report]);
  const modelRows = report?.models ?? [];
  const maxDaily = Math.max(1, ...daily.map((item) => item.total));

  return (
    <SettingsSectionBlock
      title="Pi JSONL 用量分析"
      description="每次从当前工作区的 Pi 会话重新构建；不读取 Claude、Codex、Cursor 或其他 Runtime 的记录。"
      actions={<div className={styles.actions}>
        <div aria-label="统计窗口" className={styles.segmented} role="group">
          {WINDOWS.map((item) => (
            <Button
              aria-pressed={window === item.id}
              className={window === item.id ? styles.selected! : ""}
              key={item.id}
              onPress={() => setWindow(item.id)}
            >{item.label}</Button>
          ))}
        </div>
        <Button className="secondary-button" isDisabled={loading || !workspace || !connected} onPress={() => void loadReport()}>
          {loading ? <LoaderCircle aria-hidden="true" className={styles.spin} size={13} /> : <RefreshCw aria-hidden="true" size={13} />}
          重建
        </Button>
      </div>}
    >
      {!workspace ? <SettingsNotice tone="warning">请先选择一个工作区。</SettingsNotice> : null}
      {!connected ? <SettingsNotice tone="warning">Agent Host 未连接，暂时无法扫描 Pi JSONL。</SettingsNotice> : null}
      {error ? <SettingsNotice tone="danger">{error}</SettingsNotice> : null}
      {report && !report.coverage.complete ? (
        <SettingsNotice tone="warning">
          <AlertTriangle aria-hidden="true" size={13} />
          统计覆盖不完整：发现 {report.coverage.discoveredSessions} 个会话，成功扫描 {report.coverage.scannedSessions} 个，
          跳过 {report.coverage.skippedSessions + report.coverage.unavailableSessions + report.coverage.invalidSessions} 个。
        </SettingsNotice>
      ) : null}

      {loading && !report ? <div className={styles.loading}><LoaderCircle className={styles.spin} size={18} />正在扫描 Pi JSONL</div> : null}
      {report ? <>
        <div className={styles.metrics}>
          <Metric label="Pi 记录 token" value={formatNumber(report.totals.total)} />
          <Metric label="输入 / 输出" value={`${formatNumber(report.totals.input)} / ${formatNumber(report.totals.output)}`} />
          <Metric label="缓存读 / 写" value={`${formatNumber(report.totals.cacheRead)} / ${formatNumber(report.totals.cacheWrite)}`} />
          <Metric
            label="Pi 记录成本（非账单）"
            value={report.totals.recordedCost === undefined ? "无可用记录" : `$${report.totals.recordedCost.toFixed(4)}`}
          />
        </div>

        <section className={styles.chartSection}>
          <header><div><BarChart3 size={15} /><strong>每日 token</strong></div><span>UTC 日期</span></header>
          {daily.length === 0 ? <p className={styles.empty}>当前窗口没有可用 usage 记录。</p> : (
            <div className={styles.chart}>
              {daily.map((item) => (
                <div className={styles.barRow} key={item.date}>
                  <time>{item.date}</time>
                  <span><i style={{ width: `${Math.max(2, item.total / maxDaily * 100)}%` }} /></span>
                  <b>{formatNumber(item.total)}</b>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className={styles.tableSection}>
          <header><strong>Provider / 模型</strong><span>所有已扫描 JSONL entries，包括 compaction 与 branch summary</span></header>
          <div className={styles.table} role="table" aria-label="Provider 和模型用量">
            <div className={styles.tableHeader} role="row"><span>Provider / Model</span><span>会话</span><span>条目</span><span>Token</span><span>记录成本</span></div>
            {modelRows.map((row) => (
              <div key={`${row.provider}:${row.model}`} role="row">
                <span><strong>{row.provider}</strong><small>{row.model}</small></span>
                <span>{row.sessions}</span>
                <span>{row.turns}</span>
                <span>{formatNumber(row.totals.total)}</span>
                <span>{row.totals.recordedCost === undefined ? "-" : `$${row.totals.recordedCost.toFixed(4)}`}</span>
              </div>
            ))}
          </div>
        </section>

        <footer className={styles.coverage}>
          生成于 {new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium", timeStyle: "short" }).format(new Date(report.generatedAt))}
          {report.coverage.futureVersionSessions > 0 ? ` · ${report.coverage.futureVersionSessions} 个较新格式会话` : ""}
          {report.coverage.undatedUsageEntries > 0 ? ` · ${report.coverage.undatedUsageEntries} 条 usage 无日期` : ""}
        </footer>
      </> : null}
    </SettingsSectionBlock>
  );

  async function loadReport(): Promise<void> {
    const expectedHostEpoch = useAppStore.getState().hostEpoch;
    if (!workspace || !useAppStore.getState().connected || expectedHostEpoch === undefined || loading) return;
    const revision = ++requestRevision.current;
    setLoading(true);
    setError(undefined);
    try {
      await registerRendererWorkspaceWithHost(workspace, { queryCatalog: false });
      if (!isCurrentRequest(revision, expectedHostEpoch, workspace.id)) return;
      const next = await agentConnectionController.request(
        "workspace.usage.report",
        { window },
        [],
        { context: { scope: "workspace", workspaceId: workspace.id }, ackTimeoutMs: 8_000 }
      );
      if (!isCurrentRequest(revision, expectedHostEpoch, workspace.id) || next.workspaceId !== workspace.id) return;
      setReport(next);
    } catch (cause) {
      if (isCurrentRequest(revision, expectedHostEpoch, workspace.id)) {
        setError(cause instanceof Error ? cause.message : "无法重建 Pi JSONL 用量统计。");
      }
    } finally {
      if (isCurrentRequest(revision, expectedHostEpoch, workspace.id)) setLoading(false);
    }
  }

  function isCurrentRequest(revision: number, expectedHostEpoch: number, expectedWorkspaceId: string): boolean {
    const workbench = rendererWorkbenchStore.getState();
    const app = useAppStore.getState();
    return isUsageReportRequestCurrent({
      revision,
      hostEpoch: expectedHostEpoch,
      workspaceId: expectedWorkspaceId
    }, {
      revision: requestRevision.current,
      connected: app.connected,
      hostEpoch: app.hostEpoch,
      workspaceId: workbench.settingsWorkspaceId ?? workbench.currentWorkspaceId
    });
  }
}

function Metric({ label, value }: { label: string; value: string }) {
  return <div><span>{label}</span><strong>{value}</strong></div>;
}

function aggregateDaily(buckets: UsageBucket[]): Array<{ date: string; total: number }> {
  const totals = new Map<string, number>();
  for (const bucket of buckets) {
    if (!bucket.date) continue;
    totals.set(bucket.date, (totals.get(bucket.date) ?? 0) + bucket.totals.total);
  }
  return [...totals].map(([date, total]) => ({ date, total })).sort((left, right) => left.date.localeCompare(right.date));
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 0 }).format(value);
}
