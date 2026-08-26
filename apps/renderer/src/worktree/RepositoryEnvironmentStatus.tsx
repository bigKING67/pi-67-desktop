import type { RepositoryEnvironmentSnapshot } from "@pi67/protocol";
import {
  CircleOff,
  FolderGit2,
  GitBranch,
  GitFork,
  RefreshCw,
  TriangleAlert
} from "lucide-react";
import { useEffect, useState } from "react";
import { messages } from "../localization/message-catalog.js";
import {
  initializeRepositorySubmodules,
  inspectRepositoryEnvironment,
  recoverAppOwnedWorktree
} from "./repository-environment-controller.js";
import {
  useRepositoryEnvironmentStore,
  type RepositoryEnvironmentRecord
} from "./repository-environment-store.js";
import styles from "./RepositoryEnvironmentStatus.module.css";

export function RepositoryEnvironmentStatus({ workspaceId }: { workspaceId: string | undefined }) {
  const [actionPending, setActionPending] = useState(false);
  const [actionFailed, setActionFailed] = useState(false);
  const record = useRepositoryEnvironmentStore((state) => (
    workspaceId ? state.records[workspaceId] : undefined
  ));

  useEffect(() => {
    if (workspaceId) void inspectRepositoryEnvironment(workspaceId);
  }, [workspaceId]);

  if (!workspaceId) return null;
  const presentation = repositoryEnvironmentPresentation(record);
  const Icon = presentation.icon === "branch"
    ? GitBranch
    : presentation.icon === "fork"
      ? GitFork
      : presentation.icon === "non-git"
        ? CircleOff
        : presentation.icon === "error"
          ? TriangleAlert
          : presentation.icon === "loading"
            ? RefreshCw
            : FolderGit2;
  const action = record?.snapshot?.status === "ready"
    && record.snapshot.submodules?.networkActionRequired
      ? "submodules" as const
      : record?.snapshot?.status === "missing" && record.snapshot.recovery
        ? "recovery" as const
        : undefined;
  const runAction = async () => {
    if (!action || actionPending) return;
    setActionPending(true);
    setActionFailed(false);
    const succeeded = action === "submodules"
      ? await initializeRepositorySubmodules(workspaceId)
      : await recoverAppOwnedWorktree(workspaceId);
    setActionFailed(!succeeded);
    setActionPending(false);
  };
  return (
    <div className={styles.statusGroup}>
      <button
        aria-busy={record?.status === "loading"}
        aria-label={`${presentation.label}：${presentation.description}`}
        className={`${styles.status} ${styles[presentation.tone]}`}
        data-repository-status={presentation.kind}
        onClick={() => void inspectRepositoryEnvironment(workspaceId)}
        title={presentation.description}
        type="button"
      >
        <Icon
          aria-hidden="true"
          className={presentation.icon === "loading" ? styles.spinning : undefined}
          size={13}
        />
        <span>{presentation.label}</span>
      </button>
      {action ? (
        <button
          aria-label={action === "submodules"
            ? messages.repositoryEnvironment.initializeSubmodulesDetail
            : messages.repositoryEnvironment.recoverWorktreeDetail}
          className={styles.action}
          disabled={actionPending}
          onClick={() => void runAction()}
          title={actionFailed ? messages.repositoryEnvironment.actionFailed : undefined}
          type="button"
        >{actionPending
          ? messages.repositoryEnvironment.actionPending
          : action === "submodules"
            ? messages.repositoryEnvironment.initializeSubmodules
            : messages.repositoryEnvironment.recoverWorktree}</button>
      ) : null}
    </div>
  );
}

export interface RepositoryEnvironmentPresentation {
  kind: string;
  label: string;
  description: string;
  tone: "neutral" | "success" | "warning" | "danger";
  icon: "repository" | "branch" | "fork" | "non-git" | "loading" | "error";
}

export function repositoryEnvironmentPresentation(
  record: RepositoryEnvironmentRecord | undefined
): RepositoryEnvironmentPresentation {
  if (!record || record.status === "idle") {
    return {
      kind: "idle",
      label: messages.repositoryEnvironment.inspect,
      description: messages.repositoryEnvironment.inspectDetail,
      tone: "neutral",
      icon: "repository"
    };
  }
  if (record.status === "loading") {
    return {
      kind: "loading",
      label: record.snapshot
        ? messages.repositoryEnvironment.refreshing
        : messages.repositoryEnvironment.inspecting,
      description: messages.repositoryEnvironment.inspectingDetail,
      tone: "neutral",
      icon: "loading"
    };
  }
  if (record.status === "error" && !record.snapshot) {
    return {
      kind: "bridge-error",
      label: messages.repositoryEnvironment.failed,
      description: messages.repositoryEnvironment.failedDetail,
      tone: "danger",
      icon: "error"
    };
  }
  if (record.status === "error") {
    return {
      kind: "stale",
      label: messages.repositoryEnvironment.stale,
      description: messages.repositoryEnvironment.staleDetail,
      tone: "warning",
      icon: "error"
    };
  }
  return snapshotPresentation(record.snapshot!);
}

function snapshotPresentation(snapshot: RepositoryEnvironmentSnapshot): RepositoryEnvironmentPresentation {
  if (snapshot.status === "non-git") {
    return {
      kind: "non-git",
      label: messages.repositoryEnvironment.nonGit,
      description: messages.repositoryEnvironment.nonGitDetail,
      tone: "neutral",
      icon: "non-git"
    };
  }
  if (snapshot.status === "toolchain-unavailable") {
    return {
      kind: "toolchain-unavailable",
      label: messages.repositoryEnvironment.toolchainUnavailable,
      description: messages.repositoryEnvironment.toolchainUnavailableDetail,
      tone: "warning",
      icon: "error"
    };
  }
  if (snapshot.status === "missing") {
    if (snapshot.recovery) {
      return {
        kind: "app-owned-worktree-missing",
        label: messages.repositoryEnvironment.worktreeMissing,
        description: messages.repositoryEnvironment.worktreeMissingDetail,
        tone: "warning",
        icon: "error"
      };
    }
    return {
      kind: "missing",
      label: messages.repositoryEnvironment.workspaceMissing,
      description: messages.repositoryEnvironment.workspaceMissingDetail,
      tone: "warning",
      icon: "error"
    };
  }
  if (snapshot.status === "error") {
    return {
      kind: "error",
      label: messages.repositoryEnvironment.failed,
      description: messages.repositoryEnvironment.failedDetail,
      tone: "danger",
      icon: "error"
    };
  }
  if (snapshot.stale) {
    return {
      kind: "stale",
      label: messages.repositoryEnvironment.stale,
      description: messages.repositoryEnvironment.staleDetail,
      tone: "warning",
      icon: "error"
    };
  }
  if (snapshot.error?.stage === "catalog") {
    return {
      kind: "catalog-unavailable",
      label: messages.repositoryEnvironment.catalogUnavailable,
      description: messages.repositoryEnvironment.catalogUnavailableDetail,
      tone: "warning",
      icon: "error"
    };
  }
  if (snapshot.error?.stage === "state") {
    return {
      kind: "state-unavailable",
      label: messages.repositoryEnvironment.stateUnavailable,
      description: messages.repositoryEnvironment.stateUnavailableDetail,
      tone: "warning",
      icon: "error"
    };
  }
  if (snapshot.submodules?.status === "conflicted") {
    return {
      kind: "submodules-conflicted",
      label: messages.repositoryEnvironment.submodulesConflicted,
      description: messages.repositoryEnvironment.submodulesConflictedDetail,
      tone: "danger",
      icon: "error"
    };
  }
  if (snapshot.submodules?.status === "incomplete") {
    return {
      kind: "submodules-incomplete",
      label: messages.repositoryEnvironment.submodulesIncomplete,
      description: snapshot.submodules.networkActionRequired
        ? messages.repositoryEnvironment.submodulesNetworkRequiredDetail
        : messages.repositoryEnvironment.submodulesDivergentDetail,
      tone: "warning",
      icon: "error"
    };
  }
  const current = snapshot.worktrees.find((worktree) => (
    worktree.worktreeId === snapshot.repository?.currentWorktreeId
  ));
  if (!current) {
    return {
      kind: "error",
      label: messages.repositoryEnvironment.failed,
      description: messages.repositoryEnvironment.failedDetail,
      tone: "danger",
      icon: "error"
    };
  }
  const label = current.kind === "primary"
    ? messages.repositoryEnvironment.primary
    : messages.repositoryEnvironment.linked;
  const branch = current.detached
    ? messages.repositoryEnvironment.detached
    : current.branchName ?? messages.repositoryEnvironment.branchUnknown;
  return {
    kind: current.kind,
    label,
    description: messages.repositoryEnvironment.readyDetail(label, branch, snapshot.worktrees.length),
    tone: "success",
    icon: current.kind === "primary" ? "branch" : "fork"
  };
}
