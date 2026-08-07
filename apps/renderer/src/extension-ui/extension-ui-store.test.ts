import type { ExtensionCatalogResult, ExtensionUiRequestView } from "@pi67/domain";
import { beforeEach, describe, expect, it } from "vitest";
import {
  selectCommittedExtensionCatalog,
  useExtensionUiStore
} from "./extension-ui-store.js";
import type { SessionProjectionAuthority } from "../session/session-projection-store.js";

const request: ExtensionUiRequestView = {
  requestId: "extension-1",
  kind: "confirm",
  title: "Continue?",
  blocking: true,
  hostEpoch: 9,
  sessionId: "session-1",
  sessionGeneration: 3,
  operationId: "operation-1"
};

const catalog: ExtensionCatalogResult = {
  items: [],
  total: 0,
  truncated: false
};
const AUTHORITY: SessionProjectionAuthority = {
  hostEpoch: 9,
  sessionId: "session-1",
  sessionFileIdentity: "session-file-session-1",
  sessionGeneration: 3,
  projectionRevision: 4
};

describe("extensionUiStore", () => {
  beforeEach(() => {
    useExtensionUiStore.setState(useExtensionUiStore.getInitialState(), true);
  });

  it("upserts requests in place and cancels only matching request ids", () => {
    const store = useExtensionUiStore.getState();
    store.upsertRequest(request);
    store.upsertRequest({ ...request, title: "Updated" });
    store.upsertRequest({ ...request, requestId: "extension-2" });

    expect(useExtensionUiStore.getState().requests).toEqual([
      { ...request, title: "Updated" },
      { ...request, requestId: "extension-2" }
    ]);

    useExtensionUiStore.getState().cancelRequests(["extension-1", "unknown"]);
    expect(useExtensionUiStore.getState().requests.map((item) => item.requestId)).toEqual([
      "extension-2"
    ]);
    useExtensionUiStore.getState().removeRequest("extension-2");
    expect(useExtensionUiStore.getState().requests).toEqual([]);
  });

  it("projects status, widget and title updates without retaining cleared entries", () => {
    const store = useExtensionUiStore.getState();
    store.applyUpdate(update({ kind: "status", key: "build", message: "running" }));
    store.applyUpdate(update({
      kind: "widget",
      key: "summary",
      message: "ready",
      placement: "belowEditor"
    }));
    store.applyUpdate(update({ kind: "title", message: "  Build monitor  " }));

    expect(Object.values(useExtensionUiStore.getState().statuses)).toEqual([
      expect.objectContaining({ key: "build", message: "running" })
    ]);
    expect(Object.values(useExtensionUiStore.getState().widgets)).toEqual([
      expect.objectContaining({ key: "summary", message: "ready", placement: "belowEditor" })
    ]);
    expect(useExtensionUiStore.getState().title).toBe("Build monitor");

    store.applyUpdate(update({ kind: "status", key: "build" }));
    store.applyUpdate(update({ kind: "widget", key: "summary" }));
    store.applyUpdate(update({ kind: "title", message: "  " }));
    expect(useExtensionUiStore.getState()).toMatchObject({
      statuses: {},
      widgets: {},
      title: undefined
    });
  });

  it("keeps compatibility attribution and catalog in the feature-owned projection", () => {
    const store = useExtensionUiStore.getState();
    store.applyCompatibility({
      extensionPackage: "fixture-extension",
      status: "tui-only",
      detail: "custom UI requires Pi TUI"
    });
    store.installCatalog(AUTHORITY, catalog);

    expect(useExtensionUiStore.getState().compatibility["fixture-extension"]).toEqual({
      id: "fixture-extension",
      label: "fixture-extension",
      status: "tui-only",
      detail: "custom UI requires Pi TUI",
      attribution: "identified"
    });
    expect(useExtensionUiStore.getState().catalog).toEqual({ authority: AUTHORITY, value: catalog });
  });

  it("hides an installed catalog until canonical authority commits and on every mismatch", () => {
    useExtensionUiStore.getState().installCatalog(AUTHORITY, catalog);
    const projection = useExtensionUiStore.getState().catalog;

    expect(selectCommittedExtensionCatalog(projection, {
      phase: "inactive",
      projectionRevision: AUTHORITY.projectionRevision
    })).toBeUndefined();
    for (const stale of [
      { ...AUTHORITY, hostEpoch: 8 },
      { ...AUTHORITY, sessionId: "session-2" },
      { ...AUTHORITY, sessionGeneration: 4 },
      { ...AUTHORITY, projectionRevision: 5 }
    ]) {
      expect(selectCommittedExtensionCatalog(projection, { phase: "active", ...stale }))
        .toBeUndefined();
    }
    expect(selectCommittedExtensionCatalog(projection, { phase: "active", ...AUTHORITY }))
      .toEqual(catalog);
  });

  it("resets interactive UI without discarding the active catalog", () => {
    const store = useExtensionUiStore.getState();
    store.upsertRequest(request);
    store.applyUpdate(update({ kind: "status", key: "build", message: "running" }));
    store.applyCompatibility({
      extensionPackage: "fixture-extension",
      status: "native",
      detail: "supported"
    });
    store.installCatalog(AUTHORITY, catalog);

    store.resetInteractive();
    expect(useExtensionUiStore.getState()).toMatchObject({
      requests: [],
      statuses: {},
      catalog: { authority: AUTHORITY, value: catalog },
      compatibility: {
        "fixture-extension": expect.objectContaining({ status: "native" })
      }
    });

    store.resetCatalog();
    expect(useExtensionUiStore.getState()).toMatchObject({
      catalog: undefined,
      compatibility: {},
      stagedCatalog: undefined
    });
  });

  it("resets transient data without replacing stable action identities", () => {
    const actions = useExtensionUiStore.getState();
    actions.upsertRequest(request);
    actions.applyUpdate(update({ kind: "title", message: "Temporary" }));
    actions.installCatalog(AUTHORITY, catalog);
    actions.reset();

    const reset = useExtensionUiStore.getState();
    expect(reset).toMatchObject({
      requests: [],
      statuses: {},
      widgets: {},
      compatibility: {},
      catalog: undefined,
      stagedCatalog: undefined,
      title: undefined
    });
    expect(reset.upsertRequest).toBe(actions.upsertRequest);
    expect(reset.reset).toBe(actions.reset);
  });
});

function update(
  value: Pick<ExtensionUiRequestView, "kind"> & Partial<ExtensionUiRequestView>
): ExtensionUiRequestView {
  return {
    requestId: `update-${value.kind}`,
    blocking: false,
    hostEpoch: 9,
    sessionId: "session-1",
    sessionGeneration: 3,
    operationId: "operation-1",
    ...value
  };
}
