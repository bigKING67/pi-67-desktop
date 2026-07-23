import { CircleCheck, CircleX, LoaderCircle, RefreshCw, TriangleAlert } from "lucide-react";
import { Button, Dialog, Heading, Modal, ModalOverlay } from "react-aria-components";
import type { DoctorCheck } from "@pi67/domain";
import { useAppStore } from "../app/app-store.js";

const checkLabels: Record<DoctorCheck["id"], string> = {
  platform: "系统平台",
  node: "内置 Node.js",
  "pi-sdk": "Pi SDK",
  shell: "Pi Shell",
  git: "Git"
};

const statusLabels: Record<DoctorCheck["status"], string> = {
  pass: "通过",
  warning: "需注意",
  fail: "失败"
};

export function DoctorDialog() {
  const open = useAppStore((state) => state.doctorDialogOpen);
  const report = useAppStore((state) => state.doctorReport);
  const running = useAppStore((state) => state.doctorRunning);
  const error = useAppStore((state) => state.doctorError);
  const setOpen = useAppStore((state) => state.setDoctorDialogOpen);
  const runDoctor = useAppStore((state) => state.runDoctor);

  if (!open) return null;
  const failing = report?.checks.filter((check) => check.status === "fail").length ?? 0;
  const warnings = report?.checks.filter((check) => check.status === "warning").length ?? 0;

  return (
    <ModalOverlay className="modal-overlay" isOpen isDismissable={!running} onOpenChange={setOpen}>
      <Modal className="modal-surface doctor-dialog">
        <Dialog aria-label="运行环境 Doctor">
          <div className="diagnostic-dialog-content">
            <span className="dialog-eyebrow">Runtime diagnostics</span>
            <Heading slot="title">运行环境 Doctor</Heading>
            <p className="dialog-message">
              {running
                ? "正在检查内置 Node.js、Pi SDK、Shell 和 Git。"
                : error
                  ? "检查未完成。Pi 会话状态没有被修改，可以重新运行。"
                  : failing > 0
                    ? `${failing} 项失败，请先处理后再开始需要 Shell 的任务。`
                    : warnings > 0
                      ? `核心运行环境可用，另有 ${warnings} 项需要注意。`
                      : "当前运行环境的关键检查均已通过。"}
            </p>

            {running ? (
              <div className="doctor-loading" role="status">
                <LoaderCircle className="spin" size={18} aria-hidden="true" />
                <span>正在运行检查…</span>
              </div>
            ) : null}

            {error && !running ? (
              <div className="doctor-error" role="alert">
                <CircleX size={17} aria-hidden="true" />
                <span>{error}</span>
              </div>
            ) : null}

            {report && !running ? (
              <div className="doctor-checks" aria-label="Doctor 检查结果">
                {report.checks.map((check) => <DoctorCheckRow check={check} key={check.id} />)}
              </div>
            ) : null}

            <div className="dialog-actions">
              <Button className="secondary-button" onPress={() => setOpen(false)} isDisabled={running}>关闭</Button>
              <Button className="primary-button" onPress={() => void runDoctor()} isDisabled={running}>
                <RefreshCw size={14} aria-hidden="true" />
                {report || error ? "重新运行 Doctor" : "运行 Doctor"}
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
