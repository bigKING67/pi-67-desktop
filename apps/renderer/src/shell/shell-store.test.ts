import { afterEach, describe, expect, it } from "vitest";
import { useShellStore } from "./shell-store.js";

describe("shell store", () => {
  afterEach(() => {
    useShellStore.setState(useShellStore.getInitialState(), true);
  });

  it("starts with the workspace inspector visible on changes", () => {
    expect(useShellStore.getState()).toMatchObject({
      contextVisible: true,
      contextTab: "changes",
      commandPaletteOpen: false,
      doctorDialogOpen: false,
      credentialDialogOpen: false,
      updateDialogOpen: false
    });
  });

  it("updates context visibility without changing the selected tab or palette", () => {
    useShellStore.getState().setContextVisible(false);

    expect(useShellStore.getState()).toMatchObject({
      contextVisible: false,
      contextTab: "changes",
      commandPaletteOpen: false
    });
  });

  it("updates the context tab without changing visibility or the palette", () => {
    useShellStore.getState().setContextTab("session");

    expect(useShellStore.getState()).toMatchObject({
      contextVisible: true,
      contextTab: "session",
      commandPaletteOpen: false
    });
  });

  it("updates the command palette without changing context state", () => {
    useShellStore.getState().setCommandPaletteOpen(true);

    expect(useShellStore.getState()).toMatchObject({
      contextVisible: true,
      contextTab: "changes",
      commandPaletteOpen: true
    });
  });

  it("owns application dialog visibility", () => {
    const shell = useShellStore.getState();
    shell.setDoctorDialogOpen(true);
    shell.setCredentialDialogOpen(true);
    shell.setUpdateDialogOpen(true);

    expect(useShellStore.getState()).toMatchObject({
      doctorDialogOpen: true,
      credentialDialogOpen: true,
      updateDialogOpen: true
    });
  });

  it("closes runtime-secret dialogs after Agent Host replacement", () => {
    useShellStore.getState().setCredentialDialogOpen(true);
    useShellStore.getState().setDoctorDialogOpen(true);
    useShellStore.getState().closeRuntimeBoundDialogs();

    expect(useShellStore.getState()).toMatchObject({
      credentialDialogOpen: false,
      doctorDialogOpen: true
    });
  });
});
