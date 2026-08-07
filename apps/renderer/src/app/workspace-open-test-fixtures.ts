import type {
  RuntimeCapabilities,
  WorkspaceChangesProjection,
  WorkspaceDescriptor
} from "@pi67/domain";

export function workspaceRuntimeCapabilities(): RuntimeCapabilities {
  return {
    sdkVersion: "0.81.1",
    supportsFollowUp: true,
    supportsSessionTree: true,
    extensionUi: {
      primitives: [],
      attribution: "none",
      recognizedCompatibilityLevels: [],
      adapterRegistry: {
        available: false,
        manifestSchemaVersions: [],
        supportedSurfaces: [],
        realtimeUiAttribution: false,
        activeAdapterCount: 0
      },
      limitations: {
        workingIndicator: "unsupported",
        editorMutation: "unsupported",
        customComponents: "tui-only",
        autocomplete: "tui-only",
        widgetPlacements: []
      }
    }
  };
}

export function workspaceConnectionIdentity(hostEpoch = 9) {
  return {
    appInstanceId: "app-1",
    hostInstanceId: `host-${hostEpoch}`,
    hostEpoch,
    sdkVersion: "0.81.1",
    eventSequence: 0
  };
}

export function emptyWorkspaceChanges(sessionId: string): WorkspaceChangesProjection {
  return { sessionId, items: [], truncated: false, total: 0 };
}

export function workspaceDescriptorFixture(
  id = "workspace-next",
  canonicalPath = "/workspace-next",
  assurance: WorkspaceDescriptor["identity"]["assurance"] = "path-only"
): WorkspaceDescriptor {
  return {
    id,
    displayName: id,
    identity: { canonicalPath, assurance },
    trust: "trusted",
    trustProvenance: "native-picker",
    availability: "available"
  };
}

export function deferred<T>() {
  let resolve!: (value: T) => void;
  return {
    promise: new Promise<T>((done) => { resolve = done; }),
    resolve
  };
}
