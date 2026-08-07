import type { SlashCommandCatalogResult } from "@pi67/protocol";
import { useEffect, useMemo, useState } from "react";
import { listRuntimeCommands } from "../operation/operation-controller.js";
import {
  isPiTuiBuiltinName,
  PI_DESKTOP_ACTIONS
} from "../pi-actions/pi-desktop-actions.js";
import type { ComposerSlashCatalog } from "./composer-slash-commands.js";

type RuntimeCatalogState =
  | { status: "unavailable"; catalog?: undefined }
  | { status: "loading"; catalog?: undefined }
  | { status: "ready"; catalog: SlashCommandCatalogResult }
  | { status: "failed"; catalog?: undefined };

export interface ComposerSlashCatalogState {
  runtimeStatus: RuntimeCatalogState["status"];
  catalog: ComposerSlashCatalog;
}

export function buildComposerSlashCatalog(
  runtimeCatalog?: SlashCommandCatalogResult
): ComposerSlashCatalog {
  const runtimeItems = runtimeCatalog?.items.filter((command) => (
    !isPiTuiBuiltinName(command.name)
  )) ?? [];
  return {
    items: [...PI_DESKTOP_ACTIONS, ...runtimeItems],
    total: PI_DESKTOP_ACTIONS.length + runtimeItems.length,
    truncated: runtimeCatalog?.truncated ?? false
  };
}

export function useComposerSlashCatalog(options: {
  connected: boolean;
  hostEpoch: number | undefined;
  resourcesRevision: number;
  sessionId: string | undefined;
}): ComposerSlashCatalogState {
  const [runtimeState, setRuntimeState] = useState<RuntimeCatalogState>({ status: "unavailable" });
  const runtimeEnabled = options.connected
    && options.hostEpoch !== undefined
    && options.sessionId !== undefined;

  useEffect(() => {
    if (!runtimeEnabled) {
      setRuntimeState({ status: "unavailable" });
      return;
    }
    let active = true;
    setRuntimeState({ status: "loading" });
    void listRuntimeCommands()
      .then((catalog) => {
        if (active) setRuntimeState({ status: "ready", catalog });
      })
      .catch(() => {
        if (active) setRuntimeState({ status: "failed" });
      });
    return () => {
      active = false;
    };
  }, [options.hostEpoch, options.resourcesRevision, options.sessionId, runtimeEnabled]);

  const catalog = useMemo<ComposerSlashCatalog>(() => {
    const runtimeCatalog = runtimeEnabled && runtimeState.status === "ready"
      ? runtimeState.catalog
      : undefined;
    return buildComposerSlashCatalog(runtimeCatalog);
  }, [runtimeEnabled, runtimeState]);

  return {
    runtimeStatus: runtimeEnabled ? runtimeState.status : "unavailable",
    catalog
  };
}
