import type {
  PiProviderConfigurationChanged,
  PiProviderConfigurationInput,
  PiProviderConfigurationSnapshot,
  PiProviderConfigurationView
} from "@pi67/protocol";
import { create } from "zustand";

type ProviderConfigurationPhase = "idle" | "loading" | "saving" | "failed";

export interface ProviderConfigurationState {
  workspaceId: string | undefined;
  snapshot: PiProviderConfigurationSnapshot | undefined;
  draft: PiProviderConfigurationInput | undefined;
  selectedProviderId: string | undefined;
  baselineRevision: string | undefined;
  dirty: boolean;
  externalConflict: PiProviderConfigurationChanged | undefined;
  phase: ProviderConfigurationPhase;
  error: string | undefined;
  beginLoad(workspaceId: string): void;
  install(workspaceId: string, snapshot: PiProviderConfigurationSnapshot): void;
  fail(workspaceId: string, error: string): void;
  selectProvider(providerId: string): void;
  startProvider(): void;
  updateDraft(update: (draft: PiProviderConfigurationInput) => PiProviderConfigurationInput): void;
  beginSave(): void;
  observeExternal(workspaceId: string, change: PiProviderConfigurationChanged): void;
  adoptExternal(): void;
  reset(): void;
}

export const useProviderConfigurationStore = create<ProviderConfigurationState>((set, get) => ({
  workspaceId: undefined,
  snapshot: undefined,
  draft: undefined,
  selectedProviderId: undefined,
  baselineRevision: undefined,
  dirty: false,
  externalConflict: undefined,
  phase: "idle",
  error: undefined,

  beginLoad(workspaceId) {
    set((state) => ({
      workspaceId,
      phase: "loading",
      error: undefined,
      ...(state.workspaceId === workspaceId ? {} : emptyConfigurationState())
    }));
  },

  install(workspaceId, snapshot) {
    const state = get();
    const selectedProviderId = selectAvailableProvider(snapshot, state.selectedProviderId);
    set({
      workspaceId,
      snapshot,
      selectedProviderId,
      draft: draftFor(snapshot, selectedProviderId),
      baselineRevision: snapshot.revision,
      dirty: false,
      externalConflict: undefined,
      phase: "idle",
      error: undefined
    });
  },

  fail(workspaceId, error) {
    if (get().workspaceId !== workspaceId) return;
    set({ phase: "failed", error });
  },

  selectProvider(providerId) {
    const snapshot = get().snapshot;
    if (!snapshot?.providers.some((provider) => provider.id === providerId)) return;
    set({
      selectedProviderId: providerId,
      draft: draftFor(snapshot, providerId),
      baselineRevision: snapshot.revision,
      dirty: false,
      externalConflict: undefined,
      error: undefined
    });
  },

  startProvider() {
    const snapshot = get().snapshot;
    set({
      selectedProviderId: undefined,
      draft: { id: "", models: [], advancedJson: "{}" },
      baselineRevision: snapshot?.revision,
      dirty: true,
      externalConflict: undefined,
      error: undefined
    });
  },

  updateDraft(update) {
    const draft = get().draft;
    if (!draft) return;
    set({ draft: update(draft), dirty: true, error: undefined });
  },

  beginSave() {
    set({ phase: "saving", error: undefined });
  },

  observeExternal(workspaceId, change) {
    const state = get();
    if (state.workspaceId !== workspaceId) return;
    if (state.dirty && state.baselineRevision !== change.snapshot.revision) {
      set({
        snapshot: change.snapshot,
        externalConflict: change,
        phase: "idle",
        error: undefined
      });
      return;
    }
    state.install(workspaceId, change.snapshot);
  },

  adoptExternal() {
    const state = get();
    if (!state.workspaceId || !state.snapshot) return;
    state.install(state.workspaceId, state.snapshot);
  },

  reset() {
    set({
      workspaceId: undefined,
      ...emptyConfigurationState(),
      phase: "idle",
      error: undefined
    });
  }
}));

export function providerInputFromView(
  provider: PiProviderConfigurationView
): PiProviderConfigurationInput {
  return {
    id: provider.id,
    ...(provider.name === undefined ? {} : { name: provider.name }),
    ...(provider.baseUrl === undefined ? {} : { baseUrl: provider.baseUrl }),
    ...(provider.api === undefined ? {} : { api: provider.api }),
    ...(provider.oauth === undefined ? {} : { oauth: provider.oauth }),
    ...(provider.authHeader === undefined ? {} : { authHeader: provider.authHeader }),
    models: provider.models.map((model) => ({
      id: model.id,
      ...(model.name === undefined ? {} : { name: model.name }),
      ...(model.api === undefined ? {} : { api: model.api }),
      ...(model.baseUrl === undefined ? {} : { baseUrl: model.baseUrl }),
      input: [...model.input],
      reasoning: model.reasoning,
      ...(model.contextWindow === undefined ? {} : { contextWindow: model.contextWindow }),
      ...(model.maxTokens === undefined ? {} : { maxTokens: model.maxTokens }),
      advancedJson: model.advancedJson
    })),
    advancedJson: provider.advancedJson
  };
}

function emptyConfigurationState() {
  return {
    snapshot: undefined,
    draft: undefined,
    selectedProviderId: undefined,
    baselineRevision: undefined,
    dirty: false,
    externalConflict: undefined
  } as const;
}

function selectAvailableProvider(
  snapshot: PiProviderConfigurationSnapshot,
  selectedProviderId: string | undefined
): string | undefined {
  if (selectedProviderId && snapshot.providers.some((provider) => provider.id === selectedProviderId)) {
    return selectedProviderId;
  }
  return snapshot.providers.find((provider) => provider.origin === "models.json")?.id
    ?? snapshot.providers[0]?.id;
}

function draftFor(
  snapshot: PiProviderConfigurationSnapshot,
  providerId: string | undefined
): PiProviderConfigurationInput | undefined {
  const provider = snapshot.providers.find((candidate) => candidate.id === providerId);
  return provider ? providerInputFromView(provider) : undefined;
}
