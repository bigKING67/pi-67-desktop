import type {
  PiProviderConfigurationChanged,
  PiProviderConfigurationSnapshot,
  PiProviderConfigurationView
} from "@pi67/protocol";
import { afterEach, describe, expect, it } from "vitest";
import {
  providerInputFromView,
  useProviderConfigurationStore
} from "./provider-configuration-store.js";

afterEach(() => {
  useProviderConfigurationStore.getState().reset();
});

describe("provider configuration store", () => {
  it("installs a clean external update immediately", () => {
    const initial = snapshot("1", "Initial");
    const external = snapshot("2", "External");
    const store = useProviderConfigurationStore.getState();
    store.install("workspace-a", initial);
    store.observeExternal("workspace-a", change(external));

    expect(useProviderConfigurationStore.getState()).toMatchObject({
      snapshot: external,
      baselineRevision: external.revision,
      dirty: false,
      externalConflict: undefined,
      draft: { name: "External" }
    });
  });

  it("keeps a dirty draft and its old baseline when Pi files change externally", () => {
    const initial = snapshot("1", "Initial");
    const external = snapshot("2", "External");
    const store = useProviderConfigurationStore.getState();
    store.install("workspace-a", initial);
    store.updateDraft((draft) => ({ ...draft, name: "Unsaved draft" }));
    store.observeExternal("workspace-a", change(external));

    expect(useProviderConfigurationStore.getState()).toMatchObject({
      snapshot: external,
      draft: { name: "Unsaved draft" },
      baselineRevision: initial.revision,
      dirty: true,
      externalConflict: { snapshot: external }
    });

    useProviderConfigurationStore.getState().adoptExternal();
    expect(useProviderConfigurationStore.getState()).toMatchObject({
      draft: { name: "External" },
      baselineRevision: external.revision,
      dirty: false,
      externalConflict: undefined
    });
  });

  it("ignores events belonging to another Workspace", () => {
    const initial = snapshot("1", "Initial");
    const external = snapshot("2", "External");
    useProviderConfigurationStore.getState().install("workspace-a", initial);
    useProviderConfigurationStore.getState().observeExternal("workspace-b", change(external));

    expect(useProviderConfigurationStore.getState().snapshot).toBe(initial);
  });

  it("creates editable input from a safe view without fabricating Header values", () => {
    const provider = providerView("Provider");
    provider.headerNames = ["Authorization", "X-Custom"];
    provider.models[0]!.headerNames = ["X-Model-Secret"];

    const input = providerInputFromView(provider);
    expect(input).not.toHaveProperty("headers");
    expect(input.models[0]).not.toHaveProperty("headers");
    expect(JSON.stringify(input)).not.toMatch(/Authorization|X-Custom|X-Model-Secret/u);
  });
});

function snapshot(revisionCharacter: string, name: string): PiProviderConfigurationSnapshot {
  return {
    revision: revisionCharacter.repeat(64),
    syncState: "current",
    updatedAt: 1,
    providers: [providerView(name)],
    credentials: [],
    defaults: { projectTrusted: true },
    files: [
      file("models"),
      file("auth"),
      file("global-settings"),
      file("project-settings")
    ],
    diagnostics: []
  };
}

function providerView(name: string): PiProviderConfigurationView {
  return {
    id: "custom",
    name,
    origin: "models.json",
    configured: false,
    modelsJsonApiKeyConfigured: false,
    headerNames: [],
    models: [{
      id: "model-a",
      input: ["text"],
      reasoning: false,
      headerNames: [],
      advancedJson: "{}"
    }],
    modelCount: 1,
    advancedJson: "{}"
  };
}

function file(kind: PiProviderConfigurationSnapshot["files"][number]["kind"]) {
  return { kind, path: `/fixture/${kind}.json`, exists: true, valid: true };
}

function change(snapshotValue: PiProviderConfigurationSnapshot): PiProviderConfigurationChanged {
  return {
    snapshot: snapshotValue,
    source: "external",
    changedFiles: ["models"],
    taskReload: "applied"
  };
}
