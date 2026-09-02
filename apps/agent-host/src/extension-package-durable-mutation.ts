import type { ExtensionPackageMutationResult } from "@pi67/domain";
import type { ExtensionPackageManagement, PiWorkspaceRuntimeServices } from "@pi67/pi-runtime";
import {
  PackageMutationReplayConflictError,
  packageSourceKind
} from "@pi67/pi-runtime";
import type { AgentCommand } from "@pi67/protocol";
import { HostCommandError } from "./protocol-error.js";

export type DurableExtensionPackageMutationCommand =
  | AgentCommand<"extension.package.install">
  | AgentCommand<"extension.package.update">
  | AgentCommand<"extension.package.approveObserved">
  | AgentCommand<"extension.package.uninstall">;

interface DurableMutationOptions {
  services: PiWorkspaceRuntimeServices;
  management: Pick<ExtensionPackageManagement, "list">;
  command: DurableExtensionPackageMutationCommand;
  idempotencyKey: string;
  fingerprint: string;
  dispatchMutation(): Promise<ExtensionPackageMutationResult>;
}

export async function dispatchDurableExtensionPackageMutation(
  options: DurableMutationOptions
): Promise<ExtensionPackageMutationResult> {
  const { services, management, command, idempotencyKey, fingerprint } = options;
  const { source, scope } = command.payload;
  const sourceKind = packageSourceKind(source);
  if (sourceKind === "bundled") {
    throw new HostCommandError(
      "UNSUPPORTED",
      "Bundled Pi-67 capabilities cannot be mutated through third-party package management.",
      false
    );
  }
  if (command.type === "extension.package.approveObserved") {
    await services.packageTrustRegistry.refresh();
    const observed = services.packageTrustRegistry.observationFor(source, scope);
    if (observed?.status !== "observed") {
      throw new HostCommandError(
        "PACKAGE_INTEGRITY_MISMATCH",
        "The current Extension package content could not be inspected safely for approval.",
        false
      );
    }
  }
  let reservation;
  try {
    reservation = await services.packageMutationReceipts.reserve({
      source,
      scope,
      sourceKind,
      operation: durableMutationOperation(command),
      idempotencyKey,
      fingerprint
    });
  } catch (error) {
    if (error instanceof PackageMutationReplayConflictError) {
      throw new HostCommandError(
        "DUPLICATE_REQUEST",
        "The idempotency key has already been used for a different durable Extension package mutation.",
        false
      );
    }
    throw error;
  }
  if (reservation.status === "replay") {
    await services.packageTrustRegistry.refresh();
    const current = management.list();
    const target = current.items.find((entry) => entry.source === source && entry.scope === scope);
    const receiptState = reservation.record.state === "active"
      && (
        target?.trustState === "user-installed-observed"
        || target?.trustState === "user-approved-observed"
      )
      ? "active" as const
      : reservation.record.state === "removed" && target === undefined
        ? "removed" as const
        : "ambiguous" as const;
    return {
      ...current,
      changed: reservation.record.changed ?? false,
      receiptState
    };
  }

  await services.packageMutationReceipts.markMutating(source, scope, idempotencyKey);
  if (command.type === "extension.package.approveObserved") {
    return approveObservedPackage(services, management, source, scope, idempotencyKey);
  }
  return mutatePackage(options);
}

async function approveObservedPackage(
  services: PiWorkspaceRuntimeServices,
  management: Pick<ExtensionPackageManagement, "list">,
  source: string,
  scope: "global" | "project",
  idempotencyKey: string
): Promise<ExtensionPackageMutationResult> {
  try {
    await services.packageTrustRegistry.refresh();
    const observed = services.packageTrustRegistry.observationFor(source, scope);
    if (observed?.status !== "observed") {
      throw new HostCommandError(
        "PACKAGE_INTEGRITY_MISMATCH",
        "The current Extension package content changed before approval could be recorded.",
        false
      );
    }
    await services.packageMutationReceipts.commitActive(
      source,
      scope,
      idempotencyKey,
      observed.observation,
      true
    );
    await services.packageTrustRegistry.refresh();
    const result = management.list();
    const target = result.items.find((entry) => entry.source === source && entry.scope === scope);
    if (target?.trustState !== "user-approved-observed") {
      throw new HostCommandError(
        "PACKAGE_INTEGRITY_MISMATCH",
        "The approved Extension package content did not match the durable approval receipt.",
        false
      );
    }
    return { ...result, changed: true, receiptState: "active" };
  } catch (error) {
    try {
      await services.packageMutationReceipts.markAmbiguous(source, scope, idempotencyKey);
    } catch (receiptError) {
      throw new HostCommandError(
        "RUNTIME_POISONED",
        "The Extension package approval failed and its durable receipt could not be reconciled.",
        false,
        { packageReceiptConsistent: false },
        { cause: new AggregateError([error, receiptError]) }
      );
    }
    throw error;
  }
}

async function mutatePackage(options: DurableMutationOptions): Promise<ExtensionPackageMutationResult> {
  const { services, management, command, idempotencyKey } = options;
  const { source, scope } = command.payload;
  const tracksOnboarding = command.type === "extension.package.install"
    && scope === "global";
  if (tracksOnboarding) await services.packageOnboarding.markInstalling(source, scope);
  let mutationCompleted = false;
  try {
    const result = await options.dispatchMutation();
    mutationCompleted = true;
    await services.packageTrustRegistry.refresh();
    if (command.type === "extension.package.uninstall") {
      const stillConfigured = management.list().items.some((entry) => (
        entry.source === source && entry.scope === scope
      ));
      if (stillConfigured) {
        await services.packageMutationReceipts.markAmbiguous(source, scope, idempotencyKey);
        await services.packageTrustRegistry.refresh();
        return { ...management.list(), changed: result.changed, receiptState: "ambiguous" };
      }
      await services.packageMutationReceipts.commitRemoved(source, scope, idempotencyKey, result.changed);
      await services.packageTrustRegistry.refresh();
      return { ...management.list(), changed: result.changed, receiptState: "removed" };
    }

    const observed = services.packageTrustRegistry.observationFor(source, scope);
    if (observed?.status !== "observed") {
      if (tracksOnboarding) await services.packageOnboarding.markInstallFailed(source, scope);
      await services.packageMutationReceipts.markAmbiguous(source, scope, idempotencyKey);
      await services.packageTrustRegistry.refresh();
      return { ...management.list(), changed: result.changed, receiptState: "ambiguous" };
    }
    await services.packageMutationReceipts.commitActive(
      source,
      scope,
      idempotencyKey,
      observed.observation,
      result.changed
    );
    if (command.type === "extension.package.update") {
      await refreshOtherScopeReceipt(services, source, scope);
    }
    await services.packageTrustRegistry.refresh();
    if (tracksOnboarding) await services.packageOnboarding.markInstalled(source, scope);
    return { ...management.list(), changed: result.changed, receiptState: "active" };
  } catch (error) {
    if (tracksOnboarding) await services.packageOnboarding.markInstallFailed(source, scope);
    try {
      await services.packageMutationReceipts.markAmbiguous(source, scope, idempotencyKey);
    } catch (receiptError) {
      throw new HostCommandError(
        "RUNTIME_POISONED",
        "The Extension package mutation failed and its durable receipt could not be reconciled.",
        false,
        { packageReceiptConsistent: false },
        { cause: new AggregateError([error, receiptError]) }
      );
    }
    if (mutationCompleted) {
      throw new HostCommandError(
        "RUNTIME_POISONED",
        "The Extension package mutation completed, but its durable receipt could not be committed safely.",
        false,
        { packageReceiptConsistent: true, packageMutationCompleted: true },
        { cause: error }
      );
    }
    throw error;
  }
}

async function refreshOtherScopeReceipt(
  services: PiWorkspaceRuntimeServices,
  source: string,
  scope: "global" | "project"
): Promise<void> {
  for (const candidateScope of ["global", "project"] as const) {
    if (candidateScope === scope) continue;
    const candidate = services.packageTrustRegistry.observationFor(source, candidateScope);
    if (candidate?.status === "observed") {
      await services.packageMutationReceipts.refreshActiveObservation(
        source,
        candidateScope,
        candidate.observation
      );
    }
  }
}

function durableMutationOperation(
  command: DurableExtensionPackageMutationCommand
): "install" | "update" | "uninstall" | "admit" {
  if (command.type === "extension.package.install") return "install";
  if (command.type === "extension.package.update") return "update";
  if (command.type === "extension.package.approveObserved") return "admit";
  return "uninstall";
}
