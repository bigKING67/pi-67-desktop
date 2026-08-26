import type { CommandResults } from "@pi67/protocol";
import { useCallback, useMemo, useSyncExternalStore } from "react";
import {
  rendererReadQueryClient,
  type RendererReadCommand,
  type RendererReadQueryRequest,
  type RendererReadQuerySnapshot
} from "./renderer-read-query-client.js";

const EMPTY_REQUESTS: readonly RendererReadQueryRequest<RendererReadCommand>[] = [];

export function useRendererReadQuery<T extends RendererReadCommand>(
  request: RendererReadQueryRequest<T> | undefined
): RendererReadQuerySnapshot<CommandResults[T]> {
  const requests = useMemo(() => request ? [request] : EMPTY_REQUESTS, [request]);
  const snapshots = useRendererReadQueries(requests);
  return snapshots[0] as RendererReadQuerySnapshot<CommandResults[T]> ?? { status: "unavailable" };
}

export function useRendererReadQueries<T extends RendererReadCommand>(
  requests: readonly RendererReadQueryRequest<T>[]
): readonly RendererReadQuerySnapshot<CommandResults[T]>[] {
  const subscribe = useCallback((listener: () => void) => {
    const unsubscribe = rendererReadQueryClient.subscribe(listener);
    const releases = requests.map((request) => rendererReadQueryClient.observe(request));
    return () => {
      for (const release of releases.reverse()) release();
      unsubscribe();
    };
  }, [requests]);
  const observedVersion = useSyncExternalStore(
    subscribe,
    rendererReadQueryClient.getVersion,
    rendererReadQueryClient.getVersion
  );
  return requests.map((request) => rendererReadQueryClient.snapshot(request, observedVersion));
}
