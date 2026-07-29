import type { SessionCatalogPage, WorkspaceDescriptor } from "@pi67/domain";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { agentConnectionController } from "../connection/AgentConnectionController.js";
import { useSessionCatalogStore } from "../navigation/session-catalog-store.js";
import {
  registerRendererWorkspaceWithHost,
  resetWorkspaceHostRegistrationState
} from "./workspace-host-registration-controller.js";

describe("workspace host registration coordinator", () => {
  let hostEpoch = 2;

  beforeEach(() => {
    vi.restoreAllMocks();
    resetWorkspaceHostRegistrationState();
    useSessionCatalogStore.setState(useSessionCatalogStore.getInitialState(), true);
    hostEpoch = 2;
    vi.spyOn(agentConnectionController, "identity", "get").mockImplementation(() => ({
      appInstanceId: "app",
      hostInstanceId: `host-${hostEpoch}`,
      hostEpoch,
      sdkVersion: "fixture",
      eventSequence: 0
    }));
  });

  it("shares registration and first catalog flights across concurrent callers", async () => {
    const pendingRegistration = deferred<void>();
    const request = vi.spyOn(agentConnectionController, "request").mockImplementation((type) => {
      if (type === "workspace.register") return pendingRegistration.promise as never;
      if (type === "session.catalog.query") return Promise.resolve(emptyPage()) as never;
      throw new Error(`Unexpected command: ${type}`);
    });

    const calls = [
      registerRendererWorkspaceWithHost(workspace()),
      registerRendererWorkspaceWithHost(workspace()),
      registerRendererWorkspaceWithHost(workspace())
    ];
    await Promise.resolve();
    expect(request.mock.calls.filter(([type]) => type === "workspace.register")).toHaveLength(1);

    pendingRegistration.resolve();
    await Promise.all(calls);

    expect(request.mock.calls.filter(([type]) => type === "workspace.register")).toHaveLength(1);
    expect(request.mock.calls.filter(([type]) => type === "session.catalog.query")).toHaveLength(1);
  });

  it("registers again after the Agent Host epoch changes", async () => {
    const request = vi.spyOn(agentConnectionController, "request").mockImplementation(async (type) => (
      type === "workspace.register" ? { registered: true } as never : emptyPage() as never
    ));

    await registerRendererWorkspaceWithHost(workspace());
    hostEpoch = 3;
    await registerRendererWorkspaceWithHost(workspace());

    expect(request.mock.calls.filter(([type]) => type === "workspace.register")).toHaveLength(2);
    expect(request.mock.calls.filter(([type]) => type === "session.catalog.query")).toHaveLength(2);
  });

  it("allows registration to retry after a failed flight", async () => {
    const request = vi.spyOn(agentConnectionController, "request")
      .mockRejectedValueOnce(new Error("registration failed"))
      .mockResolvedValueOnce({ registered: true } as never);

    await expect(registerRendererWorkspaceWithHost(workspace(), { queryCatalog: false }))
      .rejects.toThrow("registration failed");
    await expect(registerRendererWorkspaceWithHost(workspace(), { queryCatalog: false }))
      .resolves.toBe(true);

    expect(request).toHaveBeenCalledTimes(2);
  });

  it("coalesces concurrent forced catalog refreshes", async () => {
    const pendingRefresh = deferred<SessionCatalogPage>();
    let catalogCalls = 0;
    const request = vi.spyOn(agentConnectionController, "request").mockImplementation(async (type) => {
      if (type === "workspace.register") return { registered: true } as never;
      if (type === "session.catalog.query") {
        catalogCalls += 1;
        if (catalogCalls === 1) return emptyPage() as never;
        return pendingRefresh.promise as never;
      }
      throw new Error(`Unexpected command: ${type}`);
    });
    await registerRendererWorkspaceWithHost(workspace());

    const first = registerRendererWorkspaceWithHost(workspace(), { refreshCatalog: true });
    const second = registerRendererWorkspaceWithHost(workspace(), { refreshCatalog: true });
    await vi.waitFor(() => expect(
      request.mock.calls.filter(([type]) => type === "session.catalog.query")
    ).toHaveLength(2));

    pendingRefresh.resolve(emptyPage());
    await Promise.all([first, second]);
    expect(request.mock.calls.filter(([type]) => type === "workspace.register")).toHaveLength(1);
  });
});

function workspace(): WorkspaceDescriptor {
  return {
    id: "workspace-a",
    displayName: "Workspace A",
    identity: { canonicalPath: "/work/a", assurance: "filesystem" },
    trust: "trusted",
    trustProvenance: "native-picker",
    availability: "available"
  };
}

function emptyPage(): SessionCatalogPage {
  return {
    items: [],
    total: 0,
    hasMore: false,
    revision: 1,
    itemCount: 0,
    source: "sqlite",
    state: "ready",
    rebuilding: false,
    incomplete: false,
    skippedCount: 0
  };
}

function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
} {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}
