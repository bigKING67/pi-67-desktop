import type {
  RuntimeStatus,
  SessionResourceCatalogResult
} from "@pi67/domain";
import type { ProjectionMutationAcknowledgement } from "@pi67/protocol";
import { queryFirstSessionCatalog } from "../navigation/session-catalog-controller.js";
import { refreshWorkspaceChanges } from "../changes/workspace-changes-controller.js";
import {
  useSessionProjectionStore
} from "../session/session-projection-store.js";
import { clearedTransientState } from "./app-state-projection.js";
import type { AppState } from "./app-store.types.js";
import {
  prepareRendererSessionTransaction
} from "./renderer-session-transaction.js";
import { activateRendererSessionChanges } from "../changes/workspace-changes-controller.js";
import {
  acceptRendererSessionTransitionResponse,
  acceptRendererSessionResponse,
  captureRendererSessionTransition,
  classifyRendererSessionBootstrap,
  currentRendererSessionAuthority
} from "../session/session-authority.js";

type StoreGet = () => AppState;
type StoreSet = (partial: Partial<AppState> | ((state: AppState) => Partial<AppState>)) => void;

export interface SessionBootstrapTransitionOptions {
  detail: string;
  refreshSessionCatalog?: boolean;
  request: () => Promise<ProjectionMutationAcknowledgement>;
  onError: (error: unknown) => void;
}

export interface SessionResourceCatalogTransitionOptions {
  detail: string;
  readyDetail: string;
  request: () => Promise<SessionResourceCatalogResult>;
  onError: (error: unknown) => void;
}

export interface IncrementalSessionTransitionOptions {
  detail: string;
  readyDetail: string;
  refreshChanges?: boolean;
  request: () => Promise<ProjectionMutationAcknowledgement>;
  onError: (error: unknown) => void;
}

export async function runSessionBootstrapTransition(
  get: StoreGet,
  set: StoreSet,
  options: SessionBootstrapTransitionOptions
): Promise<void> {
  if (get().sessionTransitionPending) return;
  prepareRendererSessionTransaction("session-replaced");
  set({
    ...clearedTransientState(),
    sessionTransitionPending: true,
    runtime: transitionRuntime(options.detail)
  });
  const target = captureRendererSessionTransition(get());
  if (!target) {
    set({ sessionTransitionPending: false });
    options.onError(new Error("Renderer Session authority is not connected."));
    return;
  }
  let committed = false;
  try {
    const acknowledgement = await options.request();
    const disposition = classifyRendererSessionBootstrap(get(), target, acknowledgement);
    if (disposition === "missing-bootstrap") {
      throw new Error("Pi 运行服务未发送 authoritative session.bootstrap 事件。");
    }
    if (disposition === "stale") return;
    committed = true;
  } catch (error) {
    const disposition = classifyRendererSessionBootstrap(get(), target);
    if (disposition === "committed") committed = true;
    if (disposition === "stale") return;
    if (!committed) {
      set({ sessionTransitionPending: false });
      options.onError(error);
      return;
    }
  }
  if (committed && options.refreshSessionCatalog) {
    await queryFirstSessionCatalog({ refresh: true });
  }
}

export async function runSessionResourceCatalogTransition(
  get: StoreGet,
  set: StoreSet,
  options: SessionResourceCatalogTransitionOptions
): Promise<void> {
  if (get().sessionTransitionPending) return;
  prepareRendererSessionTransaction("session-control");
  set({
    ...clearedTransientState(),
    sessionTransitionPending: true,
    runtime: transitionRuntime(options.detail)
  });
  const transitionTarget = captureRendererSessionTransition(get());
  const authority = currentRendererSessionAuthority(get());
  const projectionTarget = authority
    ? useSessionProjectionStore.getState().capture(authority)
    : undefined;
  if (!transitionTarget || !authority || !projectionTarget) {
    set({ sessionTransitionPending: false });
    options.onError(new Error("Renderer Session projection is not current."));
    return;
  }

  try {
    const result = await options.request();
    if (
      !acceptRendererSessionTransitionResponse(get(), transitionTarget)
      || !acceptRendererSessionResponse(get(), authority)
    ) return;
    if (!useSessionProjectionStore.getState().applyResourceCatalogResult(
      projectionTarget,
      result
    )) {
      throw new Error("Resource catalog response belongs to a stale or mismatched projection.");
    }
    set((state) => (
      acceptRendererSessionTransitionResponse(state, transitionTarget)
      && acceptRendererSessionResponse(state, authority)
        ? {
            sessionTransitionPending: false,
            runtime: { phase: "ready" as const, detail: options.readyDetail, recoverable: true }
          }
        : {}
    ));
  } catch (error) {
    if (
      !acceptRendererSessionTransitionResponse(get(), transitionTarget)
      || !acceptRendererSessionResponse(get(), authority)
    ) return;
    set({ sessionTransitionPending: false });
    options.onError(error);
  }
}

export async function runIncrementalSessionTransition(
  get: StoreGet,
  set: StoreSet,
  options: IncrementalSessionTransitionOptions
): Promise<void> {
  if (get().sessionTransitionPending) return;
  prepareRendererSessionTransaction("session-control");
  set({
    ...clearedTransientState(),
    sessionTransitionPending: true,
    runtime: transitionRuntime(options.detail)
  });
  const transitionTarget = captureRendererSessionTransition(get());
  const authority = currentRendererSessionAuthority(get());
  if (!transitionTarget || !authority) {
    set({ sessionTransitionPending: false });
    options.onError(new Error("Renderer Session authority is not current."));
    return;
  }

  try {
    const acknowledgement = await options.request();
    const current = get();
    if (
      !acceptRendererSessionTransitionResponse(current, transitionTarget)
      || !acceptRendererSessionResponse(current, authority)
    ) return;
    if (
      acknowledgement.hostEpoch !== authority.hostEpoch
      || acknowledgement.sessionId !== authority.sessionId
      || acknowledgement.sessionGeneration !== authority.sessionGeneration
    ) {
      throw new Error("Session mutation acknowledgement belongs to a stale or mismatched projection.");
    }
    set((state) => (
      acceptRendererSessionTransitionResponse(state, transitionTarget)
      && acceptRendererSessionResponse(state, authority)
        ? {
            sessionTransitionPending: false,
            runtime: { phase: "ready" as const, detail: options.readyDetail, recoverable: true }
          }
        : {}
    ));
    if (
      options.refreshChanges
      && acceptRendererSessionResponse(get(), authority)
      && activateRendererSessionChanges(get())
    ) {
      await refreshWorkspaceChanges();
    }
  } catch (error) {
    if (
      !acceptRendererSessionTransitionResponse(get(), transitionTarget)
      || !acceptRendererSessionResponse(get(), authority)
    ) return;
    set({ sessionTransitionPending: false });
    options.onError(error);
  }
}

function transitionRuntime(detail: string): RuntimeStatus {
  return { phase: "starting", detail, recoverable: true };
}
