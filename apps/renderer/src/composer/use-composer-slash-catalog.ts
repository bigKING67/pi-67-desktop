import type { SlashCommandCatalogResult } from "@pi67/protocol";
import { useEffect, useState } from "react";
import { listRuntimeCommands } from "../operation/operation-controller.js";

export type ComposerSlashCatalogState =
  | { status: "unavailable"; catalog?: undefined }
  | { status: "loading"; catalog?: undefined }
  | { status: "ready"; catalog: SlashCommandCatalogResult }
  | { status: "failed"; catalog?: undefined };

export function useComposerSlashCatalog(options: {
  connected: boolean;
  hostEpoch: number | undefined;
  sessionId: string | undefined;
}): ComposerSlashCatalogState {
  const [state, setState] = useState<ComposerSlashCatalogState>({ status: "unavailable" });

  useEffect(() => {
    if (!options.connected || options.hostEpoch === undefined || !options.sessionId) {
      setState({ status: "unavailable" });
      return;
    }
    let active = true;
    setState({ status: "loading" });
    void listRuntimeCommands()
      .then((catalog) => {
        if (active) setState({ status: "ready", catalog });
      })
      .catch(() => {
        if (active) setState({ status: "failed" });
      });
    return () => {
      active = false;
    };
  }, [options.connected, options.hostEpoch, options.sessionId]);

  return state;
}
