import { useVisibleWorkspaceOrder } from "../workbench/visible-workspaces.js";
import { useEffect, useMemo, useState } from "react";
import { Button, Dialog, Heading, Modal, ModalOverlay } from "react-aria-components";
import type { EnterpriseProjectSummary } from "@pi67/domain";
import { loadEnterpriseProjects } from "../context-memory/context-memory-controller.js";
import { messages } from "../localization/message-catalog.js";
import { SettingsSelect } from "../settings/SettingsPrimitives.js";
import { useWorkbenchStore } from "../workbench/workbench-store.js";
import { useTeamChatDialogStore, type TeamChatStartWorkSource } from "./team-chat-dialog-store.js";
import { useTeamChat } from "./team-chat-instance.js";
import { startTeamWork } from "./team-chat-work-bridge.js";
import { TextAreaField } from "./TeamChatHandoffDialog.js";
import styles from "./TeamChat.module.css";

/** Chat -> Work: a reviewed, team-scoped Work draft; nothing is sent automatically. */
export function TeamChatStartWorkDialog({ source }: { source: TeamChatStartWorkSource }) {
  const copy = messages.teamChat;
  const close = useTeamChatDialogStore((state) => state.close);
  const teamId = useTeamChat((state) => state.directory?.teamId);
  const workspaceOrder = useVisibleWorkspaceOrder();
  const workspaceRecords = useWorkbenchStore((state) => state.workspaces);
  // Derive outside the selector: a fresh array per selection would re-render forever.
  const workspaces = useMemo(() => workspaceOrder
    .map((id) => workspaceRecords[id])
    .filter((workspace) => workspace?.availability === "available"), [workspaceOrder, workspaceRecords]);
  const currentWorkspaceId = useWorkbenchStore((state) => state.currentWorkspaceId);
  const [workspaceId, setWorkspaceId] = useState(currentWorkspaceId ?? "");
  const [projects, setProjects] = useState<EnterpriseProjectSummary[]>();
  const [projectsFailed, setProjectsFailed] = useState(false);
  const [projectId, setProjectId] = useState("");
  const [text, setText] = useState(source.text);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string>();

  useEffect(() => {
    if (!workspaceId && workspaces[0]) setWorkspaceId(workspaces[0].id);
  }, [workspaceId, workspaces]);

  useEffect(() => {
    if (!teamId) return;
    let active = true;
    void loadEnterpriseProjects(teamId).then((items) => {
      if (!active) return;
      const available = items.filter((project) => project.status === "active");
      setProjects(available);
      if (available.length === 1) setProjectId(available[0]!.id);
    }, () => { if (active) setProjectsFailed(true); });
    return () => { active = false; };
  }, [teamId]);

  const valid = Boolean(teamId && workspaceId && projectId && text.trim());
  const start = async () => {
    if (!valid || starting || !teamId) return;
    setStarting(true);
    setError(undefined);
    const result = await startTeamWork({ workspaceId, teamScope: { teamId, projectId }, text });
    setStarting(false);
    if (result === "started") close();
    else setError(result === "busy" ? copy.startWorkBusy : copy.startWorkNoWorkspace);
  };

  return (
    <ModalOverlay className="modal-overlay" isDismissable={!starting} isOpen onOpenChange={(open) => { if (!open && !starting) close(); }}>
      <Modal className={`modal-surface ${styles.handoffModal}`}>
        <Dialog aria-label={copy.startWorkTitle} className={styles.channelDialog!}>
          <Heading slot="title">{copy.startWorkTitle}</Heading>
          <form className={styles.channelForm} onSubmit={(event) => { event.preventDefault(); void start(); }}>
            <p className={styles.formNotice}>{copy.startWorkProjectHint}</p>
            {workspaces.length === 0 ? <p className={styles.formError} role="alert">{copy.startWorkNoWorkspace}</p> : (
              <div className={styles.field}>
                <span>{copy.startWorkWorkspace}</span>
                <SettingsSelect className={styles.fieldSelect!} label={copy.startWorkWorkspace} onChange={setWorkspaceId} value={workspaceId}
                  options={workspaces.map((workspace) => ({ id: workspace!.id, label: workspace!.displayName }))} />
              </div>
            )}
            <div className={styles.field}>
              <span>{copy.startWorkProject}</span>
              {projectsFailed ? <small className={styles.fieldError}>{copy.startWorkProjectsFailed}</small>
                : projects === undefined ? <small role="status">{copy.startWorkLoadingProjects}</small>
                  : projects.length === 0 ? <small className={styles.fieldError}>{copy.startWorkNoProject}</small> : (
                    <SettingsSelect className={styles.fieldSelect!} label={copy.startWorkProject} onChange={setProjectId} value={projectId}
                      options={[{ id: "", label: "—", disabled: true },
                        ...projects.map((project) => ({ id: project.id, label: project.name }))]} />
                  )}
            </div>
            <TextAreaField label={copy.startWorkText} maxLength={60_000} onChange={setText} rows={8} value={text} />
            {error ? <p className={styles.formError} role="alert">{error}</p> : null}
            <div className={styles.dialogActions}>
              <Button className="secondary-button" isDisabled={starting} onPress={close}>{copy.cancel}</Button>
              <Button className="primary-button" isDisabled={starting || !valid} type="submit">{copy.startWorkConfirm}</Button>
            </div>
          </form>
        </Dialog>
      </Modal>
    </ModalOverlay>
  );
}
