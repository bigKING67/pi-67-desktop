import { afterEach, describe, expect, it } from "vitest";
import { useShellStore } from "./shell-store.js";

describe("shell store", () => {
  afterEach(() => {
    useShellStore.setState(useShellStore.getInitialState(), true);
  });

  it("starts with the workspace inspector closed on files without a docked preference", () => {
    expect(useShellStore.getState()).toMatchObject({
      navigationVisible: true,
      sessionSearchFocusRevision: 0,
      sessionSearchHandledRevision: 0,
      modelPickerRequestRevision: 0,
      modelPickerHandledRevision: 0,
      contextVisible: false,
      contextTab: "files",
      contextDetailTab: "session",
      sessionTreeDialogOpen: false,
      commandPaletteOpen: false,
      workspaceConversationSearchDialogOpen: false,
      workspaceContentSearchDialogOpen: false,
      doctorDialogOpen: false,
      credentialDialogOpen: false,
      credentialDialogProviderId: undefined,
      updateDialogOpen: false
    });
  });

  it("opens the Session Catalog and requests focus without coupling it to the model picker", () => {
    const shell = useShellStore.getState();
    shell.setNavigationVisible(false);
    shell.openSessionCatalog();

    expect(useShellStore.getState()).toMatchObject({
      navigationVisible: true,
      sessionSearchFocusRevision: 1,
      sessionSearchHandledRevision: 0,
      modelPickerRequestRevision: 0
    });
    shell.acknowledgeSessionSearchFocus(1);
    expect(useShellStore.getState().sessionSearchHandledRevision).toBe(1);
  });

  it("publishes repeatable model picker requests", () => {
    const shell = useShellStore.getState();
    shell.requestModelPicker();
    shell.requestModelPicker();

    expect(useShellStore.getState().modelPickerRequestRevision).toBe(2);
    shell.acknowledgeModelPickerRequest(2);
    expect(useShellStore.getState().modelPickerHandledRevision).toBe(2);
  });

  it("opens the Changes Inspector with a repeatable session change focus request", () => {
    const shell = useShellStore.getState();
    shell.setContextVisible(false);
    shell.focusSessionChange("tool-1");
    shell.focusSessionChange("tool-2");

    expect(useShellStore.getState()).toMatchObject({
      contextVisible: true,
      contextTab: "changes",
      sessionChangeFocusRequest: { toolCallId: "tool-2", revision: 2 },
      sessionChangeFocusHandledRevision: 0
    });
    shell.acknowledgeSessionChangeFocus(2);
    expect(useShellStore.getState().sessionChangeFocusHandledRevision).toBe(2);
  });

  it("updates context visibility without changing the selected tab or palette", () => {
    useShellStore.getState().setContextVisible(false);

    expect(useShellStore.getState()).toMatchObject({
      contextVisible: false,
      contextTab: "files",
      commandPaletteOpen: false
    });
  });

  it("updates the context tab without changing visibility or the palette", () => {
    useShellStore.setState({ contextVisible: true });
    useShellStore.getState().setContextTab("changes");

    expect(useShellStore.getState()).toMatchObject({
      contextVisible: true,
      contextTab: "changes",
      commandPaletteOpen: false
    });
  });

  it("keeps the selected Context detail when switching primary inspector tabs", () => {
    const shell = useShellStore.getState();
    shell.setContextTab("context");
    shell.setContextDetailTab("experience");
    shell.setContextTab("files");
    shell.setContextTab("context");

    expect(useShellStore.getState()).toMatchObject({
      contextTab: "context",
      contextDetailTab: "experience"
    });
  });

  it("updates the command palette without changing context state", () => {
    useShellStore.setState({ contextVisible: true });
    useShellStore.getState().setCommandPaletteOpen(true);

    expect(useShellStore.getState()).toMatchObject({
      contextVisible: true,
      contextTab: "files",
      commandPaletteOpen: true
    });
  });

  it("owns application dialog visibility", () => {
    const shell = useShellStore.getState();
    shell.setDoctorDialogOpen(true);
    shell.setCredentialDialogOpen(true, "openai");
    shell.setUpdateDialogOpen(true);

    expect(useShellStore.getState()).toMatchObject({
      doctorDialogOpen: true,
      credentialDialogOpen: true,
      credentialDialogProviderId: "openai",
      updateDialogOpen: true
    });

    shell.setCredentialDialogOpen(false);
    expect(useShellStore.getState()).toMatchObject({
      credentialDialogOpen: false,
      credentialDialogProviderId: undefined
    });
  });

  it("closes runtime-secret dialogs after Agent Host replacement", () => {
    useShellStore.getState().setCredentialDialogOpen(true, "openai");
    useShellStore.getState().setDoctorDialogOpen(true);
    useShellStore.getState().closeRuntimeBoundDialogs();

    expect(useShellStore.getState()).toMatchObject({
      credentialDialogOpen: false,
      credentialDialogProviderId: undefined,
      doctorDialogOpen: true
    });
  });

  it("closes every non-blocking dialog when a blocking request takes priority", () => {
    const shell = useShellStore.getState();
    shell.setCommandPaletteOpen(true);
    shell.setKeyboardShortcutsDialogOpen(true);
    shell.setWorkspaceConversationSearchDialogOpen(true);
    shell.setWorkspaceContentSearchDialogOpen(true);
    shell.setDoctorDialogOpen(true);
    shell.setCredentialDialogOpen(true, "openai");
    shell.setUpdateDialogOpen(true);
    shell.setSessionTreeDialogOpen(true);

    shell.closeNonBlockingDialogs();

    expect(useShellStore.getState()).toMatchObject({
      commandPaletteOpen: false,
      keyboardShortcutsDialogOpen: false,
      workspaceConversationSearchDialogOpen: false,
      workspaceContentSearchDialogOpen: false,
      doctorDialogOpen: false,
      credentialDialogOpen: false,
      credentialDialogProviderId: undefined,
      updateDialogOpen: false,
      sessionTreeDialogOpen: false
    });
  });
});
