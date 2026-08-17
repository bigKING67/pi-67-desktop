import type { UsageReport, UsageWindow } from "@pi67/domain";
import { AlertTriangle, BarChart3, LoaderCircle, RefreshCw } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "react-aria-components";
import { useAppStore } from "../app/app-store.js";
import { agentConnectionController } from "../connection/AgentConnectionController.js";
import { rendererWorkbenchStore, useWorkbenchStore } from "../workbench/workbench-store.js";
import { registerRendererWorkspaceWithHost } from "../workbench/workspace-host-registration-controller.js";
import { SettingsNotice, SettingsSectionBlock } from "./SettingsPrimitives.js";
import {
  createDailyUsageSeries,
  showUsageDateLabel,
  usageAxisMaximum,
  usageAxisTicks,
  type DailyUsagePoint
} from "./usage-daily-series.js";
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
  const [refreshRevision, setRefreshRevision] = useState(0);
  const requestRevision = useRef(0);

  useEffect(() => {
    const revision = ++requestRevision.current;
    setReport(undefined);
    setError(undefined);
    setLoading(false);
    if (!workspace || !connected || hostEpoch === undefined) return;

    const controller = new AbortController();
    const expectedWorkspaceId = workspace.id;
    const expectedHostEpoch = hostEpoch;
    const requestedWindow = window;
    const isCurrentRequest = () => {
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
    };

    setLoading(true);
    void (async () => {
      try {
        await registerRendererWorkspaceWithHost(workspace, { queryCatalog: false });
        if (controller.signal.aborted || !isCurrentRequest()) return;
        const next = await agentConnectionController.request(
          "workspace.usage.report",
          { window: requestedWindow },
          [],
          {
            context: { scope: "workspace", workspaceId: expectedWorkspaceId },
            ackTimeoutMs: 8_000,
            signal: controller.signal
          }
        );
        if (
          controller.signal.aborted
          || !isCurrentRequest()
          || next.workspaceId !== expectedWorkspaceId
        ) return;
        setReport(next);
      } catch (cause) {
        if (!controller.signal.aborted && isCurrentRequest()) {
          setError(cause instanceof Error ? cause.message : "无法重建 Pi JSONL 用量统计。");
        }
      } finally {
        if (!controller.signal.aborted && isCurrentRequest()) setLoading(false);
      }
    })();

    return () => {
      controller.abort();
      if (requestRevision.current === revision) requestRevision.current += 1;
    };
  }, [workspace, connected, hostEpoch, window, refreshRevision]);

  const daily = useMemo(() => report ? createDailyUsageSeries(report) : [], [report]);
  const modelRows = report?.models ?? [];

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
        <Button
          className="secondary-button"
          isDisabled={loading || !workspace || !connected}
          onPress={() => setRefreshRevision((current) => current + 1)}
        >
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
          <header>
            <div><BarChart3 aria-hidden="true" size={15} /><strong>每日 Token</strong></div>
            <span>连续 {daily.length} 天 · UTC 日期</span>
          </header>
          {report.buckets.length === 0 ? <p className={styles.empty}>当前窗口没有可用 usage 记录。</p> : (
            <DailyUsageChart daily={daily} window={report.window} />
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

}

function Metric({ label, value }: { label: string; value: string }) {
  return <div><span>{label}</span><strong>{value}</strong></div>;
}

function DailyUsageChart({ daily, window }: { daily: DailyUsagePoint[]; window: UsageWindow }) {
  const [activeDate, setActiveDate] = useState<string>();
  const active = daily.find((point) => point.date === activeDate);
  const axisMaximum = usageAxisMaximum(daily);
  const ticks = usageAxisTicks(axisMaximum);

  return <div className={styles.chart}>
    <div aria-hidden="true" className={styles.chartDetail}>
      {active ? <>
        <time>{formatUtcDateLong(active.date)}</time>
        <span>总计 <strong>{formatNumber(active.totals.total)}</strong></span>
        <span>输入 / 输出 <strong>{formatNumber(active.totals.input)} / {formatNumber(active.totals.output)}</strong></span>
        <span>缓存读 / 写 <strong>{formatNumber(active.totals.cacheRead)} / {formatNumber(active.totals.cacheWrite)}</strong></span>
        <span>记录成本 <strong>{active.totals.recordedCost === undefined ? "无记录" : `$${active.totals.recordedCost.toFixed(4)}`}</strong></span>
      </> : <span>悬停柱形或使用 Tab 键查看每日明细</span>}
    </div>
    <div className={styles.chartFrame}>
      <div aria-hidden="true" className={styles.yAxis}>
        {ticks.map((tick) => <span key={tick}>{formatAxisNumber(tick)}</span>)}
      </div>
      <div className={styles.plot}>
        <div aria-hidden="true" className={styles.gridLines}>
          {ticks.map((tick) => <span key={tick} />)}
        </div>
        <div
          aria-label="每日 Token 柱状图"
          className={styles.columns}
          role="list"
          style={{ gridTemplateColumns: `repeat(${daily.length}, minmax(0, 1fr))` }}
        >
          {daily.map((point) => {
            const percentage = point.totals.total === 0 ? 0 : Math.max(1.5, point.totals.total / axisMaximum * 100);
            const label = dailyUsageAriaLabel(point);
            return <div
              aria-label={label}
              className={styles.dailyColumn}
              key={point.date}
              onFocus={() => setActiveDate(point.date)}
              onMouseEnter={() => setActiveDate(point.date)}
              role="listitem"
              tabIndex={0}
              title={label}
            >
              <span className={styles.dailyBar} style={{ height: `${percentage}%` }} />
            </div>;
          })}
        </div>
      </div>
      <div
        aria-hidden="true"
        className={styles.xAxis}
        style={{ gridTemplateColumns: `repeat(${daily.length}, minmax(0, 1fr))` }}
      >
        {daily.map((point, index) => (
          <time className={styles.xLabel} key={point.date}>
            {showUsageDateLabel(index, window) ? formatUtcDateShort(point.date) : ""}
          </time>
        ))}
      </div>
    </div>
  </div>;
}

function dailyUsageAriaLabel(point: DailyUsagePoint): string {
  return [
    formatUtcDateLong(point.date),
    `总 Token ${formatNumber(point.totals.total)}`,
    `输入 ${formatNumber(point.totals.input)}`,
    `输出 ${formatNumber(point.totals.output)}`,
    `缓存读取 ${formatNumber(point.totals.cacheRead)}`,
    `缓存写入 ${formatNumber(point.totals.cacheWrite)}`,
    `记录成本 ${point.totals.recordedCost === undefined ? "无记录" : `$${point.totals.recordedCost.toFixed(4)}`}`
  ].join("，");
}

function formatUtcDateShort(date: string): string {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "numeric",
    day: "numeric",
    timeZone: "UTC"
  }).format(new Date(`${date}T00:00:00.000Z`));
}

function formatUtcDateLong(date: string): string {
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "UTC"
  }).format(new Date(`${date}T00:00:00.000Z`));
}

function formatAxisNumber(value: number): string {
  if (value >= 1_000_000) return `${trimAxisFraction(value / 1_000_000)}M`;
  if (value >= 1_000) return `${trimAxisFraction(value / 1_000)}K`;
  return formatNumber(value);
}

function trimAxisFraction(value: number): string {
  return value.toFixed(value >= 10 || Number.isInteger(value) ? 0 : 1);
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 0 }).format(value);
}
