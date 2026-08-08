import { CircleCheck, CircleX, Download, LoaderCircle, RefreshCw, TriangleAlert } from "lucide-react";
import { Button, Dialog, Heading, Modal, ModalOverlay } from "react-aria-components";
import type { DoctorCheck, OperationFreshness } from "@pi67/domain";
import type {
  DesktopRecoverySnapshot,
  RendererAcknowledgementDiagnostics,
  RuntimeDiagnostics
} from "@pi67/protocol";
import { messages } from "../localization/message-catalog.js";
import { useOperationFreshnessStore } from "../operation/operation-freshness-store.js";
import { useShellStore } from "../shell/shell-store.js";
import { runRuntimeDoctor, saveRuntimeDiagnostics } from "./runtime-diagnostics-controller.js";
import { useDoctorStore } from "./use-doctor-store.js";

const checkLabels: Record<DoctorCheck["id"], string> = {
  platform: messages.doctor.checks.platform,
  node: messages.doctor.checks.node,
  "pi-sdk": messages.doctor.checks.piSdk,
  "sqlite-runtime": messages.doctor.checks.sqliteRuntime,
  "session-catalog": messages.doctor.checks.sessionCatalog,
  shell: messages.doctor.checks.shell,
  git: messages.doctor.checks.git
};

const statusLabels: Record<DoctorCheck["status"], string> = {
  pass: messages.doctor.statuses.pass,
  warning: messages.doctor.statuses.warning,
  fail: messages.doctor.statuses.fail
};

export function DoctorDialog() {
  const open = useShellStore((state) => state.doctorDialogOpen);
  const setOpen = useShellStore((state) => state.setDoctorDialogOpen);
  const report = useDoctorStore((state) => state.report);
  const diagnostics = useDoctorStore((state) => state.diagnostics);
  const recovery = useDoctorStore((state) => state.recovery);
  const renderer = useDoctorStore((state) => state.renderer);
  const operationFreshness = useOperationFreshnessStore((state) => state.freshness);
  const running = useDoctorStore((state) => state.running);
  const recoveryLoading = useDoctorStore((state) => state.recoveryLoading);
  const error = useDoctorStore((state) => state.error);
  const recoveryError = useDoctorStore((state) => state.recoveryError);

  if (!open) return null;
  const recoveryRows = buildRecoveryChecks(recovery, diagnostics);
  const healthRows = buildRuntimeHealthChecks(recovery, diagnostics, renderer, operationFreshness);
  const hasResults = Boolean(report || recovery || diagnostics || renderer);
  const failing = (report?.checks.filter((check) => check.status === "fail").length ?? 0)
    + (hasResults ? [...recoveryRows, ...healthRows].filter((check) => check.status === "fail").length : 0);
  const warnings = (report?.checks.filter((check) => check.status === "warning").length ?? 0)
    + (hasResults ? [...recoveryRows, ...healthRows].filter((check) => check.status === "warning").length : 0);
  const busy = running || recoveryLoading;

  return (
    <ModalOverlay className="modal-overlay" isOpen isDismissable={!busy} onOpenChange={setOpen}>
      <Modal className="modal-surface doctor-dialog">
        <Dialog aria-label={messages.doctor.title}>
          <div className="diagnostic-dialog-content">
            <span className="dialog-eyebrow">{messages.doctor.eyebrow}</span>
            <Heading slot="title">{messages.doctor.title}</Heading>
            <p className="dialog-message">
              {busy
                ? messages.doctor.runningDescription
                : error || recoveryError
                  ? messages.doctor.incompleteDescription
                  : !hasResults
                    ? messages.doctor.initialDescription
                  : failing > 0
                    ? messages.doctor.failingDescription(failing)
                    : warnings > 0
                      ? messages.doctor.warningDescription(warnings)
                      : messages.doctor.passedDescription}
            </p>

            <div className="doctor-results-scroll">
              {busy ? (
                <div className="doctor-loading" role="status">
                  <LoaderCircle className="spin" size={18} aria-hidden="true" />
                  <span>{messages.doctor.running}</span>
                </div>
              ) : null}

              {!busy ? [error, recoveryError].filter(Boolean).map((detail, index) => (
                <div className="doctor-error" role="alert" key={`${index}:${detail}`}>
                  <CircleX size={17} aria-hidden="true" />
                  <span>{detail}</span>
                </div>
              )) : null}

              {report ? (
                <div className="doctor-section">
                  <h3>{messages.doctor.environmentHeading}</h3>
                  <div className="doctor-checks" aria-label={messages.doctor.results}>
                    {report.checks.map((check) => <DoctorCheckRow check={check} key={check.id} />)}
                  </div>
                </div>
              ) : null}

              {hasResults ? (
                <div className="doctor-section">
                  <h3>{messages.doctor.healthHeading}</h3>
                  <div className="doctor-checks" aria-label={messages.doctor.healthResults}>
                    {healthRows.map((check) => <StatusCheckRow check={check} key={check.id} />)}
                  </div>
                </div>
              ) : null}

              {hasResults ? (
                <div className="doctor-section">
                  <h3>{messages.doctor.recoveryHeading}</h3>
                  <div className="doctor-checks" aria-label={messages.doctor.recoveryResults}>
                    {recoveryRows.map((check) => <StatusCheckRow check={check} key={check.id} />)}
                  </div>
                </div>
              ) : null}
            </div>

            <div className="dialog-actions">
              <Button className="secondary-button" onPress={() => setOpen(false)} isDisabled={busy}>{messages.common.close}</Button>
              <Button className="secondary-button" onPress={() => void saveRuntimeDiagnostics()} isDisabled={busy}>
                <Download size={14} aria-hidden="true" />
                {messages.doctor.export}
              </Button>
              <Button className="primary-button" onPress={() => void runRuntimeDoctor()} isDisabled={busy}>
                <RefreshCw size={14} aria-hidden="true" />
                {hasResults || error || recoveryError ? messages.doctor.rerun : messages.doctor.run}
              </Button>
            </div>
          </div>
        </Dialog>
      </Modal>
    </ModalOverlay>
  );
}

function DoctorCheckRow({ check }: { check: DoctorCheck }) {
  const StatusIcon = check.status === "pass" ? CircleCheck : check.status === "warning" ? TriangleAlert : CircleX;
  return (
    <div className={`doctor-check status-${check.status}`}>
      <StatusIcon size={17} aria-hidden="true" />
      <div>
        <strong>{checkLabels[check.id]}</strong>
        <code>{check.detail}</code>
      </div>
      <span>{statusLabels[check.status]}</span>
    </div>
  );
}

interface StatusCheck {
  id: string;
  label: string;
  status: DoctorCheck["status"];
  detail: string;
}

function StatusCheckRow({ check }: { check: StatusCheck }) {
  const StatusIcon = check.status === "pass" ? CircleCheck : check.status === "warning" ? TriangleAlert : CircleX;
  return (
    <div className={`doctor-check status-${check.status}`}>
      <StatusIcon size={17} aria-hidden="true" />
      <div>
        <strong>{check.label}</strong>
        <code>{check.detail}</code>
      </div>
      <span>{statusLabels[check.status]}</span>
    </div>
  );
}

function buildRecoveryChecks(
  desktop: DesktopRecoverySnapshot | undefined,
  diagnostics: RuntimeDiagnostics | undefined
): StatusCheck[] {
  const host = diagnostics?.host;
  const workspaceIssues = desktop
    ? desktop.workspaces.missing
      + desktop.workspaces.identityChanged
      + desktop.workspaces.needsConfirmation
      + desktop.workspaces.unavailable
    : 0;
  const journal = host?.workspaces.reduce((summary, workspace) => {
    const state = workspace.sessionCreationJournal;
    summary.entries += state.entryCount;
    summary.pending += state.stateCounts.reserved + state.stateCounts.materializing;
    summary.ambiguous += state.stateCounts.ambiguous;
    summary.invalid += state.invalidEntryCount;
    summary.truncated ||= state.truncated;
    return summary;
  }, { entries: 0, pending: 0, ambiguous: 0, invalid: 0, truncated: false });
  const catalogs = host?.workspaces.map((workspace) => workspace.sessionCatalog) ?? [];
  const unavailableCatalogs = catalogs.filter((catalog) => catalog.state === "unavailable").length;
  const degradedCatalogs = catalogs.filter((catalog) => (
    catalog.state !== "ready" || catalog.incomplete || catalog.skippedCount > 0
  )).length;
  const attachmentIssues = desktop
    ? desktop.attachmentStaging.invalidEntryCount + Number(desktop.attachmentStaging.truncated)
    : 0;

  return [
    {
      id: "workspace",
      label: messages.doctor.recoveryChecks.workspace,
      status: desktop ? (workspaceIssues > 0 ? "warning" : "pass") : "warning",
      detail: desktop
        ? `共 ${desktop.workspaces.total} 个；可用 ${desktop.workspaces.available}；需核对 ${desktop.workspaces.identityChanged + desktop.workspaces.needsConfirmation}；离线 ${desktop.workspaces.missing + desktop.workspaces.unavailable}`
        : "Desktop 状态不可用"
    },
    {
      id: "journal",
      label: messages.doctor.recoveryChecks.journal,
      status: !journal
        ? "warning"
        : journal.ambiguous > 0 || journal.invalid > 0
          ? "fail"
          : journal.pending > 0 || journal.truncated
            ? "warning"
            : "pass",
      detail: journal
        ? `记录 ${journal.entries}；处理中 ${journal.pending}；待核对 ${journal.ambiguous}；无效 ${journal.invalid}${journal.truncated ? "；扫描已截断" : ""}`
        : "Agent Host 状态不可用"
    },
    {
      id: "catalog",
      label: messages.doctor.recoveryChecks.catalog,
      status: !host
        ? "warning"
        : unavailableCatalogs > 0
          ? "fail"
          : degradedCatalogs > 0 || host.workspacesTruncated
            ? "warning"
            : "pass",
      detail: host
        ? `Workspace ${catalogs.length}；降级 ${degradedCatalogs}；不可用 ${unavailableCatalogs}${host.workspacesTruncated ? "；列表已截断" : ""}`
        : "Agent Host 状态不可用"
    },
    {
      id: "writerLease",
      label: messages.doctor.recoveryChecks.writerLease,
      status: !host
        ? "warning"
        : host.writerLeases.compromised
          ? "fail"
          : host.writerLeases.pendingCount > 0
            ? "warning"
            : "pass",
      detail: host
        ? `活动 ${host.writerLeases.activeCount}；等待 ${host.writerLeases.pendingCount}；完整性 ${host.writerLeases.compromised ? "异常" : "正常"}`
        : "Agent Host 状态不可用"
    },
    {
      id: "hostAuthority",
      label: messages.doctor.recoveryChecks.hostAuthority,
      status: !host
        || desktop?.previousRunExitStatus === "unclean"
        || desktop?.previousRunExitStatus === "unknown"
        || host.workspacesTruncated
        ? "warning"
        : "pass",
      detail: host
        ? `Epoch ${host.hostEpoch}；Task ${host.taskCount}；Runtime ${host.liveRuntimeCount}；Operation ${host.activeOperationCount}；上次退出 ${previousRunExitLabel(desktop?.previousRunExitStatus)}`
        : "Agent Host 状态不可用"
    },
    {
      id: "attachments",
      label: messages.doctor.recoveryChecks.attachments,
      status: desktop ? (attachmentIssues > 0 ? "warning" : "pass") : "warning",
      detail: desktop
        ? `草稿 ${desktop.attachmentStaging.draftCount}；已认领 ${desktop.attachmentStaging.claimedCount}；无效 ${desktop.attachmentStaging.invalidEntryCount}${desktop.attachmentStaging.truncated ? "；扫描已截断" : ""}`
        : "Desktop 状态不可用"
    }
  ];
}

export function buildRuntimeHealthChecks(
  desktop: DesktopRecoverySnapshot | undefined,
  diagnostics: RuntimeDiagnostics | undefined,
  renderer: RendererAcknowledgementDiagnostics | undefined,
  freshness: OperationFreshness | undefined
): StatusCheck[] {
  const host = diagnostics?.host;
  const scheduler = host?.scheduler;
  const operations = host?.operations;
  const main = desktop?.health;
  const repository = main?.repository;
  const queuedCommands = scheduler
    ? scheduler.queuedControlCount + scheduler.queuedPromptCount
    : 0;
  const repositoryDisposed = repository
    ? repository.mutationScheduler.disposed
      || repository.gitRunner.disposed
      || repository.workingTree.disposed
    : false;

  return [
    {
      id: "mainLifecycle",
      label: messages.doctor.healthChecks.mainLifecycle,
      status: !main
        ? "warning"
        : main.agentHost.phase === "failed"
          ? "fail"
          : main.agentHost.phase === "running"
            ? "pass"
            : "warning",
      detail: main
        ? `阶段 ${main.agentHost.phase}；重启 ${main.agentHost.restartCount}；Port ${main.agentHost.portHandoffCount}；Runtime 替换 ${main.agentHost.poisonedRuntimeReplacementCount}${main.agentHost.lastSpawnDurationMs === undefined ? "" : `；最近启动 ${main.agentHost.lastSpawnDurationMs} ms`}`
        : "Main 生命周期状态不可用"
    },
    {
      id: "scheduler",
      label: messages.doctor.healthChecks.scheduler,
      status: !scheduler
        ? "warning"
        : scheduler.closedCount > 0
          ? "fail"
          : queuedCommands >= 16
            ? "warning"
            : "pass",
      detail: scheduler
        ? `Task ${scheduler.taskCount}；查询 ${scheduler.activeQueryCount}；控制 排队 ${scheduler.queuedControlCount}/运行 ${scheduler.runningControlCount}；Prompt 排队 ${scheduler.queuedPromptCount}/运行 ${scheduler.runningPromptCount}；Turn 准入 ${scheduler.turnAdmissionCount}`
        : "Scheduler 状态不可用"
    },
    {
      id: "operations",
      label: messages.doctor.healthChecks.operations,
      status: !operations
        ? "warning"
        : operations.poisonedCount > 0
          ? "fail"
          : operations.terminatingCount > 0 || (
            operations.heartbeatTrackedCount > 0 && operations.maxQuietForMs >= 60_000
          )
            ? "warning"
            : "pass",
      detail: operations
        ? `Registry ${operations.registryCount}；接受中 ${operations.acceptingCount}；活动 ${operations.activeCount}；终止中 ${operations.terminatingCount}；Poisoned ${operations.poisonedCount}；Heartbeat ${operations.heartbeatTrackedCount}；最长静默 ${operations.maxQuietForMs} ms`
        : "Operation 状态不可用"
    },
    {
      id: "operationFreshness",
      label: messages.doctor.healthChecks.operationFreshness,
      status: freshness?.phase === "stalled"
        ? "fail"
        : freshness && freshness.phase !== "fresh"
          ? "warning"
          : host && host.activeOperationCount > 0 && !freshness
            ? "warning"
            : "pass",
      detail: freshness
        ? `阶段 ${freshness.phase}；观测 ${freshness.observedAt}${freshness.reason ? `；原因 ${freshness.reason}` : ""}`
        : host && host.activeOperationCount > 0 ? "活动 Operation 尚无 Renderer freshness 投影" : "当前无活动 Operation"
    },
    {
      id: "rendererAcknowledgement",
      label: messages.doctor.healthChecks.rendererAcknowledgement,
      status: !renderer
        ? "warning"
        : (renderer.lastAcknowledgementLatencyMs ?? 0) >= renderer.slowThresholdMs
          || renderer.activeRequestCount > 0
          ? "warning"
          : "pass",
      detail: renderer
        ? `样本 ${renderer.sampleCount}；活动 ${renderer.activeRequestCount}；最近 ${renderer.lastAcknowledgementLatencyMs ?? 0} ms；最大 ${renderer.maxAcknowledgementLatencyMs ?? 0} ms；慢响应 ${renderer.slowAcknowledgementCount}`
        : "Renderer acknowledgement 状态不可用"
    },
    {
      id: "repositoryRuntime",
      label: messages.doctor.healthChecks.repositoryRuntime,
      status: !repository
        ? "warning"
        : repositoryDisposed
          ? "fail"
          : repository.mutationScheduler.fencedRepositoryCount > 0
            ? "warning"
            : "pass",
      detail: repository
        ? `Git 进程 ${repository.gitRunner.activeProcessCount}；变更快照 ${repository.workingTree.cachedSnapshotCount}；Mutation 排队 ${repository.mutationScheduler.queuedCount}/运行 ${repository.mutationScheduler.runningCount}；Fence ${repository.mutationScheduler.fencedRepositoryCount}`
        : "Repository runtime 状态不可用"
    },
    {
      id: "promptStashRuntime",
      label: messages.doctor.healthChecks.promptStashRuntime,
      status: !main ? "warning" : main.promptStashImages.disposed ? "fail" : "pass",
      detail: !main
        ? "Prompt Stash image store 状态不可用"
        : main.promptStashImages.disposed ? "图片加密存储已停止" : "图片加密存储可用"
    }
  ];
}

function previousRunExitLabel(status: DesktopRecoverySnapshot["previousRunExitStatus"] | undefined): string {
  switch (status) {
    case "not-run": return "首次运行";
    case "clean": return "正常";
    case "unclean": return "非正常结束";
    case "unknown": return "无法确认";
    default: return "状态不可用";
  }
}
