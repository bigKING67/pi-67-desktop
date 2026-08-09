import type {
  ApprovalResponseDecision,
  ApprovalTargetKind,
  RiskCategory
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

  const toolName = analyzeSecurityLiteral(request.toolName);
  const toolSource = analyzeSecurityLiteral(request.toolSource);
  const target = analyzeSecurityLiteral(request.target);
  const cwd = analyzeSecurityLiteral(request.cwd);
  const suspiciousCharacterCount = toolName.suspiciousCharacterCount
    + toolSource.suspiciousCharacterCount
    + target.suspiciousCharacterCount
    + cwd.suspiciousCharacterCount;
  const suspiciousCategories = uniqueCategories([
    ...toolName.categories,
    ...toolSource.categories,
    ...target.categories,
    ...cwd.categories
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
        <Dialog aria-label={messages.approval.dialogLabel} className={styles.dialog ?? ""}>
          <div className={styles.content}>
            <header className={styles.header}>
              <span className="dialog-eyebrow">{messages.approval.eyebrow}</span>
              <Heading slot="title">{messages.approval.title}</Heading>
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
                <div>
                  <dt>{messages.approval.tool}</dt>
                  <dd>
                    <SecurityLiteral analysis={toolName} kind="tool-name" label={messages.approval.toolName} />
                  </dd>
                </div>
                <div>
                  <dt>{messages.approval.toolSource}</dt>
                  <dd>
                    <SecurityLiteral
                      analysis={toolSource}
                      kind="tool-name"
                      label={messages.approval.toolSource}
                    />
                  </dd>
                </div>
                <div><dt>{messages.approval.risk}</dt><dd>{riskLabel(request.category)}</dd></div>
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
                <div><dt>{messages.approval.approvalScope}</dt><dd>{messages.approval.singleToolCall}</dd></div>
              </dl>
              <p className={styles.denial}>{messages.approval.denialNotice}</p>
              <p className={styles.yoloNotice}>{messages.approval.yoloNotice}</p>
            </div>
            <div className={`dialog-actions ${styles.actions}`}>
              <Button autoFocus className="secondary-button" isDisabled={submittingDecision !== undefined || stoppingTask} onPress={() => void submit("deny")}>
                {submittingDecision === "deny" ? messages.approval.submitting : messages.approval.deny}
              </Button>
              <Button className="primary-button" isDisabled={submittingDecision !== undefined || stoppingTask} onPress={() => void submit("allow-once")}>
                {submittingDecision === "allow-once" ? messages.approval.submitting : messages.approval.allowOnce}
              </Button>
              <Button
                className={styles.yoloButton!}
                isDisabled={submittingDecision !== undefined || stoppingTask}
                onPress={() => void submit("enable-task-yolo-and-allow")}
              >
                {submittingDecision === "enable-task-yolo-and-allow"
                  ? messages.approval.submitting
                  : messages.approval.enableTaskYolo}
              </Button>
              {stoppableTaskId ? (
                <Button
                  className="danger-button"
                  isDisabled={submittingDecision !== undefined || stoppingTask}
                  onPress={() => void stopTask()}
                >
                  {stoppingTask ? "正在停止任务" : "停止整个任务"}
                </Button>
              ) : null}
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
