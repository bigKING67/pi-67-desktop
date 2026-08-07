import { CircleCheck, CircleX, Download, LoaderCircle, RefreshCw, TriangleAlert } from "lucide-react";
import { Button, Dialog, Heading, Modal, ModalOverlay } from "react-aria-components";
import type { DoctorCheck } from "@pi67/domain";
import type { DesktopRecoverySnapshot, RuntimeDiagnostics } from "@pi67/protocol";
import { messages } from "../localization/message-catalog.js";
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
  const running = useDoctorStore((state) => state.running);
  const recoveryLoading = useDoctorStore((state) => state.recoveryLoading);
  const error = useDoctorStore((state) => state.error);
  const recoveryError = useDoctorStore((state) => state.recoveryError);

  if (!open) return null;
  const recoveryRows = buildRecoveryChecks(recovery, diagnostics);
  const hasResults = Boolean(report || recovery || diagnostics);
  const failing = (report?.checks.filter((check) => check.status === "fail").length ?? 0)
    + (hasResults ? recoveryRows.filter((check) => check.status === "fail").length : 0);
  const warnings = (report?.checks.filter((check) => check.status === "warning").length ?? 0)
    + (hasResults ? recoveryRows.filter((check) => check.status === "warning").length : 0);
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
                  <h3>{messages.doctor.recoveryHeading}</h3>
                  <div className="doctor-checks" aria-label={messages.doctor.recoveryResults}>
                    {recoveryRows.map((check) => <RecoveryCheckRow check={check} key={check.id} />)}
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

interface RecoveryCheck {
  id: "workspace" | "journal" | "catalog" | "writerLease" | "hostAuthority" | "attachments";
  label: string;
  status: DoctorCheck["status"];
  detail: string;
}

function RecoveryCheckRow({ check }: { check: RecoveryCheck }) {
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
): RecoveryCheck[] {
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

function previousRunExitLabel(status: DesktopRecoverySnapshot["previousRunExitStatus"] | undefined): string {
  switch (status) {
    case "not-run": return "首次运行";
    case "clean": return "正常";
    case "unclean": return "非正常结束";
    case "unknown": return "无法确认";
    default: return "状态不可用";
  }
}
