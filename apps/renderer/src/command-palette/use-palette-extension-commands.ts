import type { SlashCommandDescriptor } from "@pi67/protocol";
import { useEffect, useState } from "react";
import { messages } from "../localization/message-catalog.js";
import { listRuntimeCommands } from "../operation/operation-controller.js";
import { normalizePaletteExtensionCommands } from "./command-palette-extension-commands.js";

export type PaletteExtensionCommandState =
  | { status: "idle"; commands: SlashCommandDescriptor[] }
  | { status: "loading"; commands: SlashCommandDescriptor[] }
  | { status: "ready"; commands: SlashCommandDescriptor[] }
  | { status: "unavailable"; commands: SlashCommandDescriptor[] }
  | { status: "failed"; commands: SlashCommandDescriptor[]; error: string };

const EMPTY_COMMANDS: SlashCommandDescriptor[] = [];

export function usePaletteExtensionCommands(options: {
  open: boolean;
  connected: boolean;
  hostEpoch: number | undefined;
}): PaletteExtensionCommandState {
  const [state, setState] = useState<PaletteExtensionCommandState>({ status: "idle", commands: EMPTY_COMMANDS });

  useEffect(() => {
    if (!options.open) {
      setState({ status: "idle", commands: EMPTY_COMMANDS });
      return;
    }
    if (!options.connected || options.hostEpoch === undefined) {
      setState({ status: "unavailable", commands: EMPTY_COMMANDS });
      return;
    }
    let active = true;
    setState({ status: "loading", commands: EMPTY_COMMANDS });
    void listRuntimeCommands()
      .then((value) => {
        if (!active) return;
        const commands = normalizePaletteExtensionCommands(value);
        setState(commands
          ? { status: "ready", commands }
          : { status: "failed", commands: EMPTY_COMMANDS, error: messages.commandPalette.invalidExtensionCommands });
      })
      .catch(() => {
        if (!active) return;
        setState({ status: "failed", commands: EMPTY_COMMANDS, error: messages.commandPalette.extensionCommandsLoadFailed });
      });
    return () => {
      active = false;
    };
  }, [options.connected, options.hostEpoch, options.open]);

  return state;
}
