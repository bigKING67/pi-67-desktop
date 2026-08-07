import type { DesktopRecommendedPackage } from "@pi67/domain";
import { ShieldCheck } from "lucide-react";
import {
  Button,
  Dialog,
  Heading,
  Modal,
  ModalOverlay
} from "react-aria-components";
import type { ConfirmedAction } from "./extension-management-model.js";
import { inferSourceKind, sourceKindLabel } from "./extension-management-model.js";
import styles from "./ExtensionManagementWorkspace.module.css";

export function InstallExtensionDialog({
  source,
  scopeLabel,
  error,
  busy,
  onSourceChange,
  onCancel,
  onConfirm
}: {
  source: string;
  scopeLabel: string;
  error: string | undefined;
  busy: boolean;
  onSourceChange: (source: string) => void;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const sourceKind = source.trim().length === 0 ? undefined : inferSourceKind(source);
  return (
    <ModalOverlay
      className="modal-overlay"
      isDismissable={!busy}
      isOpen
      onOpenChange={(open) => { if (!open) onCancel(); }}
    >
      <Modal className={`modal-surface ${styles.modal}`}>
        <Dialog aria-label="安装 Pi 扩展包" className={styles.dialog!}>
          <span className="dialog-eyebrow">Pi 扩展包</span>
          <Heading slot="title">安装 Pi 扩展包</Heading>
          <p className={styles.dialogIntro}>输入 npm 包、Git URL 或本地目录。Pi 会在执行前验证来源格式。</p>
          <label className={styles.sourceField}>
            <span>npm 包、Git URL 或本地目录</span>
            <input
              autoFocus
              disabled={busy}
              maxLength={4_096}
              onChange={(event) => onSourceChange(event.currentTarget.value)}
              placeholder="npm:@scope/package、https://…git 或 /absolute/path"
              value={source}
            />
          </label>
          <dl className={styles.dialogFacts}>
            <div><dt>识别类型</dt><dd>{sourceKind ? sourceKindLabel(sourceKind) : "等待输入"}</dd></div>
            <div><dt>安装到</dt><dd>{scopeLabel}</dd></div>
          </dl>
          <div className={styles.permissionNotice}>
            <ShieldCheck aria-hidden="true" size={17} />
            <span>Pi 扩展包可能提供可执行扩展、技能或指令模板。可执行扩展拥有与 Agent 相同的运行权限，安装也可能访问网络。</span>
          </div>
          {error ? <p className={styles.dialogError} role="alert">{error}</p> : null}
          <div className="dialog-actions">
            <Button className="secondary-button" isDisabled={busy} onPress={onCancel}>取消</Button>
            <Button
              className="primary-button"
              isDisabled={busy || source.trim().length === 0}
              onPress={onConfirm}
            >{busy ? "安装中…" : "确认安装"}</Button>
          </div>
        </Dialog>
      </Modal>
    </ModalOverlay>
  );
}

export function ObservationalMemoryOnboardingDialog({ entry, failed, busy, onDecline, onInstall }: {
  entry: DesktopRecommendedPackage;
  failed: boolean;
  busy: boolean;
  onDecline: () => void;
  onInstall: () => void;
}) {
  return (
    <ModalOverlay className="modal-overlay" isDismissable={false} isOpen>
      <Modal className={`modal-surface ${styles.modal}`}>
        <Dialog aria-label="安装会话观察记忆扩展" className={styles.dialog!}>
          <span className="dialog-eyebrow">可选扩展包 · 仅确认一次</span>
          <Heading slot="title">安装 pi-observational-memory？</Heading>
          <p className={styles.dialogIntro}>
            这是可选的会话观察记忆扩展。Pi-67 不会静默下载；只有确认后才会联网安装到全局配置。
          </p>
          <dl className={styles.dialogFacts}>
            <div><dt>来源</dt><dd className={styles.codeValue}>{entry.source}</dd></div>
            <div><dt>版本</dt><dd>{entry.recommendedVersion ?? "由来源决定"}</dd></div>
            <div><dt>安装到</dt><dd>全局</dd></div>
          </dl>
          {failed ? (
            <p className={styles.dialogError} role="alert">上次安装没有完成。你可以重试，或选择暂不安装。</p>
          ) : null}
          <div className="dialog-actions">
            <Button className="secondary-button" isDisabled={busy} onPress={onDecline}>暂不安装</Button>
            <Button className="primary-button" isDisabled={busy} onPress={onInstall}>
              {busy ? "安装中…" : failed ? "重试安装" : "确认并安装"}
            </Button>
          </div>
        </Dialog>
      </Modal>
    </ModalOverlay>
  );
}

export function PackageActionDialog({ action, error, busy, onCancel, onConfirm }: {
  action: ConfirmedAction;
  error: string | undefined;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const uninstall = action.kind === "uninstall";
  const title = uninstall ? "卸载扩展包？" : "更新扩展包？";
  return (
    <ModalOverlay
      className="modal-overlay"
      isDismissable={!busy}
      isOpen
      onOpenChange={(open) => { if (!open) onCancel(); }}
    >
      <Modal className={`modal-surface ${styles.modal}`}>
        <Dialog aria-label={title} className={styles.dialog!}>
          <span className="dialog-eyebrow">Pi 扩展包管理</span>
          <Heading slot="title">{title}</Heading>
          <dl className={styles.dialogFacts}>
            <div><dt>来源</dt><dd className={styles.codeValue}>{action.entry.source}</dd></div>
            <div><dt>作用域</dt><dd>{action.entry.scope === "global" ? "全局" : "当前项目"}</dd></div>
          </dl>
          <p className={styles.dialogIntro}>{uninstall
            ? "npm/Git 安装内容会由 Pi 移除；本地目录只移除配置引用，不删除用户目录。"
            : "更新可能访问网络并加载新的扩展包内容。现有配置会保留在当前作用域。"}</p>
          {error ? <p className={styles.dialogError} role="alert">{error}</p> : null}
          <div className="dialog-actions">
            <Button autoFocus className="secondary-button" isDisabled={busy} onPress={onCancel}>取消</Button>
            <Button
              className={uninstall ? styles.confirmDanger! : "primary-button"}
              isDisabled={busy}
              onPress={onConfirm}
            >
              {busy ? uninstall ? "卸载中…" : "更新中…" : uninstall ? "确认卸载" : "确认更新"}
            </Button>
          </div>
        </Dialog>
      </Modal>
    </ModalOverlay>
  );
}
