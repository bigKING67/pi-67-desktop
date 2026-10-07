import {
  isHardStopRiskCategory,
  type ApprovalResponseDecision,
  type ApprovalTargetKind,
  type RiskCategory
} from "@pi67/domain";
import { useEffect, useState } from "react";
import { Button, Dialog, Heading, Modal, ModalOverlay } from "react-aria-components";
import { useAppStore } from "../app/app-store.js";
import { messages } from "../localization/message-catalog.js";
import styles from "./ApprovalDialog.module.css";
import { SecurityLiteral } from "./SecurityLiteral.js";
import { respondToSafetyApproval } from "./approval-response.js";
import { useApprovalStore } from "./approval-store.js";
import {
  analyzeSecurityLiteral,
  type SecurityLiteralCategory
} from "./security-literal.js";
import {
  stopInteractiveRendererTask,
  taskIdForInteractiveStop
} from "../workbench/task-stop-controller.js";
import { useWorkbenchStore } from "../workbench/workbench-store.js";

export function ApprovalDialog() {
  const request = useApprovalStore((state) => state.requests[0]);
  useWorkbenchStore((state) => state.tasks);
  const [submittingDecision, setSubmittingDecision] = useState<ApprovalResponseDecision>();
  const [stoppingTask, setStoppingTask] = useState(false);

  useEffect(() => {
    setSubmittingDecision(undefined);
    setStoppingTask(false);
  }, [request?.requestId]);
  if (!request) return null;

  const hardStop = isHardStopRiskCategory(request.category);
  const toolName = analyzeSecurityLiteral(request.toolName);
  const toolSource = analyzeSecurityLiteral(request.toolSource);
  const target = analyzeSecurityLiteral(request.target);
  const cwd = analyzeSecurityLiteral(request.cwd);
  const taskPathGrant = request.taskPathGrant?.kind === "paths"
    ? request.taskPathGrant.paths.map(analyzeSecurityLiteral)
    : [];
  const canTrustTaskPaths = !hardStop
    && request.category === "external-path"
    && taskPathGrant.length > 0;
  const suspiciousCharacterCount = toolName.suspiciousCharacterCount
    + toolSource.suspiciousCharacterCount
    + target.suspiciousCharacterCount
    + cwd.suspiciousCharacterCount
    + taskPathGrant.reduce((total, path) => total + path.suspiciousCharacterCount, 0);
  const suspiciousCategories = uniqueCategories([
    ...toolName.categories,
    ...toolSource.categories,
    ...target.categories,
    ...cwd.categories,
    ...taskPathGrant.flatMap((path) => path.categories)
  ]);
  const stoppableTaskId = taskIdForInteractiveStop(request);

  const submit = async (decision: ApprovalResponseDecision) => {
    if (submittingDecision || stoppingTask) return;
    setSubmittingDecision(decision);
    const resolved = await respondToSafetyApproval(
      () => useAppStore.getState(),
      request.requestId,
      decision
    );
    if (!resolved && useApprovalStore.getState().requests.some(
      (candidate) => candidate.requestId === request.requestId
    )) setSubmittingDecision(undefined);
  };
  const stopTask = async () => {
    if (submittingDecision || stoppingTask) return;
    setStoppingTask(true);
    if (await stopInteractiveRendererTask(request)) {
      useApprovalStore.getState().removeRequestIfCurrent(request);
      return;
    }
    if (useApprovalStore.getState().requests.includes(request)) setStoppingTask(false);
  };

  return (
    <ModalOverlay className={`modal-overlay ${styles.overlay}`} isOpen isDismissable={false}>
      <Modal className={`modal-surface ${styles.modal}`}>
        <Dialog
          aria-label={hardStop ? messages.approval.destructiveDialogLabel : messages.approval.dialogLabel}
          className={styles.dialog ?? ""}
        >
          <div className={styles.content}>
            <header className={styles.header}>
              <span className="dialog-eyebrow">
                {hardStop ? messages.approval.destructiveEyebrow : messages.approval.eyebrow}
              </span>
              <Heading slot="title">
                {hardStop ? messages.approval.destructiveTitle : messages.approval.title}
              </Heading>
              <p className={styles.reason}>{request.reason}</p>
            </header>
            <div className={styles.body} data-approval-scroll-region="true">
              {suspiciousCharacterCount > 0 ? (
                <div className={styles.securityWarning} role="alert">
                  <strong>{messages.approval.suspiciousTitle}</strong>
                  <span>{messages.approval.suspiciousDescription(suspiciousCharacterCount)}</span>
                  <span>{messages.approval.suspiciousTypes(
                    suspiciousCategories.map(securityCategoryLabel).join("、")
                  )}</span>
                </div>
              ) : null}
              <dl className={styles.details}>
                {/* Tool identity and its verified source read as one fact: `bash · Pi 内置`. */}
                <div>
                  <dt>{messages.approval.tool}</dt>
                  <dd className={styles.toolIdentity}>
                    <SecurityLiteral analysis={toolName} kind="tool-name" label={messages.approval.toolName} />
                    <span aria-hidden="true">·</span>
                    <SecurityLiteral
                      analysis={toolSource}
                      kind="tool-name"
                      label={messages.approval.toolSource}
                    />
                  </dd>
                </div>
                {/* The reason line above already names the risk when both are the same text. */}
                {riskLabel(request.category) === request.reason ? null : (
                  <div><dt>{messages.approval.risk}</dt><dd>{riskLabel(request.category)}</dd></div>
                )}
                <div>
                  <dt>{targetKindLabel(request.targetKind)}</dt>
                  <dd>
                    <SecurityLiteral analysis={target} kind="target" label={messages.approval.target} multiline />
                    {request.targetTruncated ? <small>{messages.approval.targetTruncated}</small> : null}
                  </dd>
                </div>
                <div>
                  <dt>{messages.approval.cwd}</dt>
                  <dd>
                    <SecurityLiteral
                      analysis={cwd}
                      emptyFallback={messages.approval.unknownLiteral}
                      kind="cwd"
                      label={messages.approval.cwd}
                      multiline
                    />
                    {request.cwdTruncated ? <small>{messages.approval.cwdTruncated}</small> : null}
                  </dd>
                </div>
                {canTrustTaskPaths ? (
                  <div>
                    <dt>{messages.approval.taskTrustedPaths}</dt>
                    <dd className={styles.taskPathGrant}>
                      {taskPathGrant.map((path, index) => (
                        <SecurityLiteral
                          analysis={path}
                          key={request.taskPathGrant?.paths[index]}
                          kind="target"
                          label={messages.approval.taskTrustedPaths}
                          multiline
                        />
                      ))}
                    </dd>
                  </div>
                ) : null}
                <div>
                  <dt>{messages.approval.approvalScope}</dt>
                  <dd>{canTrustTaskPaths
                    ? messages.approval.singleToolCallOrTaskPaths
                    : messages.approval.singleToolCall}</dd>
                </div>
              </dl>
              <p className={styles.denial}>
                {hardStop ? messages.approval.destructiveNotice : messages.approval.denialNotice}
              </p>
              {canTrustTaskPaths
                ? <p className={styles.denial}>{messages.approval.taskPathTrustNotice}</p>
                : null}
              <p className={styles.yoloNotice}>{messages.approval.yoloNotice}</p>
            </div>
            <div className={`dialog-actions ${styles.actions}`}>
              {/* Task-level escalations sit apart, on the left, from decisions about this one request. */}
              {stoppableTaskId || !hardStop ? (
                <div className={styles.taskActions}>
                  {stoppableTaskId ? (
                    <Button
                      className={styles.stopTaskButton!}
                      isDisabled={submittingDecision !== undefined || stoppingTask}
                      onPress={() => void stopTask()}
                    >
                      {stoppingTask ? "正在停止任务" : "停止整个任务"}
                    </Button>
                  ) : null}
                  {!hardStop ? (
                    <Button
                      className={styles.yoloButton!}
                      isDisabled={submittingDecision !== undefined || stoppingTask}
                      onPress={() => void submit("enable-task-yolo-and-allow")}
                    >
                      {submittingDecision === "enable-task-yolo-and-allow"
                        ? messages.approval.submitting
                        : messages.approval.enableTaskYolo}
                    </Button>
                  ) : null}
                </div>
              ) : null}
              <div className={styles.requestActions}>
                <Button autoFocus className="secondary-button" isDisabled={submittingDecision !== undefined || stoppingTask} onPress={() => void submit("deny")}>
                  {submittingDecision === "deny" ? messages.approval.submitting : messages.approval.deny}
                </Button>
                <Button
                  className={hardStop ? "danger-button" : canTrustTaskPaths ? "secondary-button" : "primary-button"}
                  isDisabled={submittingDecision !== undefined || stoppingTask}
                  onPress={() => void submit("allow-once")}
                >
                  {submittingDecision === "allow-once"
                    ? messages.approval.submitting
                    : hardStop ? messages.approval.executeDestructiveOnce : messages.approval.allowOnce}
                </Button>
                {canTrustTaskPaths ? (
                  <Button
                    className="primary-button"
                    isDisabled={submittingDecision !== undefined || stoppingTask}
                    onPress={() => void submit("trust-task-paths-and-allow")}
                  >
                    {submittingDecision === "trust-task-paths-and-allow"
                      ? messages.approval.submitting
                      : messages.approval.trustTaskPaths(taskPathGrant.length)}
                  </Button>
                ) : null}
              </div>
            </div>
          </div>
        </Dialog>
      </Modal>
    </ModalOverlay>
  );
}

function uniqueCategories(categories: SecurityLiteralCategory[]): SecurityLiteralCategory[] {
  return [...new Set(categories)];
}

function riskLabel(category: RiskCategory): string {
  return messages.approval.risks[category];
}

function targetKindLabel(kind: ApprovalTargetKind): string {
  if (kind === "command") return messages.approval.command;
  if (kind === "path") return messages.approval.path;
  return messages.approval.target;
}

function securityCategoryLabel(category: SecurityLiteralCategory): string {
  return messages.approval.securityCategories[category];
}
