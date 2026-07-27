import { CircleCheck, CircleX, LoaderCircle, RefreshCw, TriangleAlert } from "lucide-react";
import { Button, Dialog, Heading, Modal, ModalOverlay } from "react-aria-components";
import type { DoctorCheck } from "@pi67/domain";
import { messages } from "../localization/message-catalog.js";
import { useShellStore } from "../shell/shell-store.js";
import { runRuntimeDoctor } from "./runtime-diagnostics-controller.js";
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
  const running = useDoctorStore((state) => state.running);
  const error = useDoctorStore((state) => state.error);

  if (!open) return null;
  const failing = report?.checks.filter((check) => check.status === "fail").length ?? 0;
  const warnings = report?.checks.filter((check) => check.status === "warning").length ?? 0;

  return (
    <ModalOverlay className="modal-overlay" isOpen isDismissable={!running} onOpenChange={setOpen}>
      <Modal className="modal-surface doctor-dialog">
        <Dialog aria-label={messages.doctor.title}>
          <div className="diagnostic-dialog-content">
            <span className="dialog-eyebrow">{messages.doctor.eyebrow}</span>
            <Heading slot="title">{messages.doctor.title}</Heading>
            <p className="dialog-message">
              {running
                ? messages.doctor.runningDescription
                : error
                  ? messages.doctor.incompleteDescription
                  : !report
                    ? messages.doctor.initialDescription
                  : failing > 0
                    ? messages.doctor.failingDescription(failing)
                    : warnings > 0
                      ? messages.doctor.warningDescription(warnings)
                      : messages.doctor.passedDescription}
            </p>

            {running ? (
              <div className="doctor-loading" role="status">
                <LoaderCircle className="spin" size={18} aria-hidden="true" />
                <span>{messages.doctor.running}</span>
              </div>
            ) : null}

            {error && !running ? (
              <div className="doctor-error" role="alert">
                <CircleX size={17} aria-hidden="true" />
                <span>{error}</span>
              </div>
            ) : null}

            {report && !running ? (
              <div className="doctor-checks" aria-label={messages.doctor.results}>
                {report.checks.map((check) => <DoctorCheckRow check={check} key={check.id} />)}
              </div>
            ) : null}

            <div className="dialog-actions">
              <Button className="secondary-button" onPress={() => setOpen(false)} isDisabled={running}>{messages.common.close}</Button>
              <Button className="primary-button" onPress={() => void runRuntimeDoctor()} isDisabled={running}>
                <RefreshCw size={14} aria-hidden="true" />
                {report || error ? messages.doctor.rerun : messages.doctor.run}
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
