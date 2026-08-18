import type { DesktopIntegrationStatus } from "@pi67/domain";
import {
  Check,
  Copy,
  ExternalLink,
  FolderOpen,
  Globe2,
  LoaderCircle,
  Radio
} from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Button, Dialog, Heading, Modal, ModalOverlay } from "react-aria-components";
import styles from "./DesktopCapabilityPanels.module.css";

export function Browser67ExtensionInstallDialog({
  open,
  operation,
  error,
  integration,
  onClose,
  onPrepare,
  onVerify
}: {
  open: boolean;
  operation: "prepare" | "doctor" | "verify" | undefined;
  error: string | undefined;
  integration: DesktopIntegrationStatus | undefined;
  onClose: () => void;
  onPrepare: () => Promise<void>;
  onVerify: () => Promise<void>;
}) {
  const preparedForOpen = useRef(false);
  const [localError, setLocalError] = useState<string>();
  const [auxiliaryBusy, setAuxiliaryBusy] = useState<string>();
  const [repairRequired, setRepairRequired] = useState(false);
  const extensionState = integration?.extensionState ?? "not-prepared";
  const needsPrepare = extensionState === "not-prepared"
    || extensionState === "reload-required"
    || extensionState === "failed";
  const filesPrepared = extensionState === "prepared"
    || extensionState === "reload-required"
    || extensionState === "connected";
  const connected = extensionState === "connected" && integration?.doctorState === "ready";
  const preparing = operation === "prepare";
  const verifying = operation === "verify";
  const busy = preparing || verifying;

  useEffect(() => {
    if (!open) {
      preparedForOpen.current = false;
      setLocalError(undefined);
      setRepairRequired(false);
      return;
    }
    if (extensionState === "reload-required") setRepairRequired(true);
    if (preparedForOpen.current || !needsPrepare) return;
    preparedForOpen.current = true;
    void onPrepare();
  }, [extensionState, needsPrepare, onPrepare, open]);

  const runAuxiliary = async (key: string, operation: () => Promise<boolean>) => {
    setAuxiliaryBusy(key);
    setLocalError(undefined);
    try {
      if (!await operation()) setLocalError("没有检测到所选浏览器，请手动打开扩展管理页。");
    } catch (operationError) {
      setLocalError(operationError instanceof Error ? operationError.message : "无法完成浏览器扩展操作");
    } finally {
      setAuxiliaryBusy(undefined);
    }
  };

  return (
    <ModalOverlay
      className="modal-overlay"
      isDismissable={!busy && auxiliaryBusy === undefined}
      isOpen={open}
      onOpenChange={(next) => { if (!next && !busy && auxiliaryBusy === undefined) onClose(); }}
    >
      <Modal className={`modal-surface ${styles.installModal}`}>
        <Dialog aria-label="安装 browser67 浏览器扩展" className={styles.installDialog!}>
          <span className="dialog-eyebrow">BROWSER67</span>
          <Heading slot="title">安装浏览器扩展</Heading>
          <p className={styles.installIntro}>
            Pi-67 会准备受完整性保护的 unpacked extension；Chrome/Edge 首次加载仍需你在扩展管理页确认。
          </p>

          {repairRequired ? (
            <div className={styles.installWarning} role="status">
              检测到浏览器当前运行的扩展不是这次准备的受管版本。请先核对扩展的加载目录：目录不一致时移除旧条目，再从下方 Pi-67 提供的目录重新“加载已解压的扩展”；目录一致时再点击扩展页的“重新加载”。
            </div>
          ) : null}

          {(error || localError) ? <div className={styles.installError} role="alert">{error ?? localError}</div> : null}

          <ol className={styles.installSteps}>
            <InstallStep
              complete={filesPrepared || connected}
              current={needsPrepare}
              number="1"
              title="准备扩展文件"
              description="自动补齐运行依赖，并把当前内置扩展复制到 browser67 活动目录。"
            >
              {(needsPrepare || connected) && !busy ? <Button className="secondary-button" onPress={() => void onPrepare()}>
              {connected
                  ? "重新安装扩展"
                  : extensionState === "reload-required" ? "同步受管扩展文件" : "重新准备"}
              </Button> : null}
              {preparing ? <span className={styles.inlineProgress} role="status"><LoaderCircle aria-hidden="true" size={14} />准备中…</span> : null}
            </InstallStep>

            <InstallStep
              complete={connected}
              current={filesPrepared && !connected}
              number="2"
              title={repairRequired ? "核对并替换加载来源" : "在浏览器中加载"}
              description={repairRequired
                ? "打开扩展管理页，核对 browser67 TMWD Bridge 的加载目录。旧目录必须移除后，再从 Pi-67 提供的目录重新“加载已解压的扩展”。"
                : "打开扩展管理页、开启开发者模式，然后选择“加载已解压的扩展”。"}
            >
              <div className={styles.browserActions}>
                <Button
                  className="secondary-button"
                  isDisabled={!filesPrepared || busy || auxiliaryBusy !== undefined || !integration?.availableBrowsers.includes("chrome")}
                  onPress={() => void runAuxiliary("chrome", () => window.pi67.system.openBrowser67ExtensionPage("chrome"))}
                >
                  <Globe2 aria-hidden="true" size={14} />
                  {auxiliaryBusy === "chrome" ? "打开中…" : "打开 Chrome 扩展页"}
                </Button>
                <Button
                  className="secondary-button"
                  isDisabled={!filesPrepared || busy || auxiliaryBusy !== undefined || !integration?.availableBrowsers.includes("edge")}
                  onPress={() => void runAuxiliary("edge", () => window.pi67.system.openBrowser67ExtensionPage("edge"))}
                >
                  <ExternalLink aria-hidden="true" size={14} />
                  {auxiliaryBusy === "edge" ? "打开中…" : "打开 Edge 扩展页"}
                </Button>
                <Button
                  className="secondary-button"
                  isDisabled={!filesPrepared || busy || auxiliaryBusy !== undefined}
                  onPress={() => void runAuxiliary("reveal", () => window.pi67.system.revealBrowser67Extension())}
                >
                  <FolderOpen aria-hidden="true" size={14} />在系统中显示目录
                </Button>
                <Button
                  className="secondary-button"
                  isDisabled={!filesPrepared || busy || auxiliaryBusy !== undefined}
                  onPress={() => void runAuxiliary("copy", () => window.pi67.system.copyBrowser67ExtensionPath())}
                >
                  <Copy aria-hidden="true" size={14} />复制扩展目录
                </Button>
              </div>
              {filesPrepared && integration?.availableBrowsers.length === 0 ? (
                <p className={styles.browserUnavailable}>未检测到标准安装位置的 Chrome 或 Edge；请复制目录后手动打开浏览器扩展页。</p>
              ) : null}
            </InstallStep>

            <InstallStep
              complete={connected}
              current={filesPrepared && !connected}
              number="3"
              title="启动并验证连接"
              description="加载后保留一个普通网页标签页。Pi-67 将启动或复用本地 Hub，并核对 live extension identity。"
            >
              {connected ? <span className={styles.connectedState}><Check aria-hidden="true" size={14} />已安装并连接</span> : null}
            </InstallStep>
          </ol>

          <div className="dialog-actions">
            <Button className="secondary-button" isDisabled={busy || auxiliaryBusy !== undefined} onPress={onClose}>关闭</Button>
            {filesPrepared && !connected ? <Button className="primary-button" isDisabled={busy || auxiliaryBusy !== undefined} onPress={() => void onVerify()}>
              <Radio aria-hidden="true" size={14} />{verifying ? "验证中…" : "启动连接并验证"}
            </Button> : null}
            {connected ? <Button className="primary-button" isDisabled={auxiliaryBusy !== undefined} onPress={onClose}>完成</Button> : null}
          </div>
        </Dialog>
      </Modal>
    </ModalOverlay>
  );
}

function InstallStep({ complete, current, number, title, description, children }: {
  complete: boolean;
  current: boolean;
  number: string;
  title: string;
  description: string;
  children?: ReactNode;
}) {
  return (
    <li className={styles.installStep} data-complete={complete} data-current={current}>
      <span className={styles.stepMarker}>{complete ? <Check aria-hidden="true" size={13} /> : number}</span>
      <div>
        <strong>{title}</strong>
        <p>{description}</p>
        {children ? <div className={styles.stepActions}>{children}</div> : null}
      </div>
    </li>
  );
}
