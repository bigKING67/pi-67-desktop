import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { resolveExistingSessionFileIdentity } from "../../packages/pi-runtime/src/session-path-identity.ts";
import {
  prepareRealUserSessionCreation,
  waitForSelectedProvisionalSessionIntent,
  waitForRealUserCreatedSession
} from "./windows-real-user-session-creation.mjs";

describe("Windows installed real-user Session creation", () => {
  it("captures the create baseline only after the action becomes admissible", async () => {
    const root = await mkdtemp(join(tmpdir(), "pi67-real-user-baseline-"));
    const agentDir = join(root, "agent");
    const sessionDirectory = join(agentDir, "sessions", "workspace");
    await mkdir(sessionDirectory, { recursive: true });
    await writeFile(join(sessionDirectory, "initial.jsonl"), "{\"type\":\"session\"}\n", "utf8");
    let actionAdmitted = false;
    const createAction = {
      click: vi.fn(async (options) => {
        expect(options).toEqual({ trial: true, timeout: 15_000 });
        actionAdmitted = true;
      })
    };
    const evaluateAll = vi.fn(async () => {
      expect(actionAdmitted).toBe(true);
      return ["session:workspace:initial.jsonl"];
    });
    const window = {
      getByRole: vi.fn(() => ({ first: () => createAction })),
      locator: vi.fn(() => ({ evaluateAll }))
    };

    try {
      const prepared = await prepareRealUserSessionCreation(window, agentDir, 15_000);

      expect(prepared.createAction).toBe(createAction);
      expect([...prepared.existingIdentities]).toEqual(["session:workspace:initial.jsonl"]);
      expect([...prepared.existingSessionFileNames]).toEqual(["initial.jsonl"]);
      expect(createAction.click).toHaveBeenCalledOnce();
      expect(evaluateAll).toHaveBeenCalledOnce();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("admits one selected provisional intent without eagerly creating a Pi JSONL", async () => {
    const root = await mkdtemp(join(tmpdir(), "pi67-real-user-intent-"));
    const agentDir = join(root, "agent");
    const sessionDirectory = join(agentDir, "sessions", "workspace");
    await mkdir(sessionDirectory, { recursive: true });
    await writeFile(join(sessionDirectory, "existing.jsonl"), "{\"type\":\"session\"}\n", "utf8");
    const window = {
      evaluate: vi.fn().mockResolvedValue({
        errorNotificationCount: 0,
        errorNotificationTitles: [],
        newProvisionalIdentities: ["provisional:workspace:new"],
        newSessionIdentities: [],
        newSessionRowCount: 0,
        provisionalRowCount: 1,
        rowCount: 2,
        runtimePhase: "stopped",
        runtimeStatus: "当前状态：首条消息尚未发送",
        selectedIdentity: "provisional:workspace:new",
        selectedNewSession: false,
        selectedProvisional: true,
        sessionIdentities: ["session:workspace:existing.jsonl"],
        sessionRowCount: 1
      })
    };

    try {
      await expect(waitForSelectedProvisionalSessionIntent(
        window,
        agentDir,
        new Set(["session:workspace:existing.jsonl"]),
        new Set(["existing.jsonl"]),
        performance.now() + 1_000
      )).resolves.toBe("provisional:workspace:new");
      expect(window.evaluate).toHaveBeenCalledOnce();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("fails closed when New materializes a Pi JSONL before the first Prompt", async () => {
    const root = await mkdtemp(join(tmpdir(), "pi67-real-user-eager-session-"));
    const agentDir = join(root, "agent");
    const sessionDirectory = join(agentDir, "sessions", "workspace");
    await mkdir(sessionDirectory, { recursive: true });
    await writeFile(join(sessionDirectory, "eager.jsonl"), "{\"type\":\"session\"}\n", "utf8");
    const window = {
      evaluate: vi.fn().mockResolvedValue({
        errorNotificationCount: 0,
        errorNotificationTitles: [],
        newProvisionalIdentities: ["provisional:workspace:new"],
        newSessionIdentities: [],
        newSessionRowCount: 0,
        provisionalRowCount: 1,
        rowCount: 1,
        runtimePhase: "stopped",
        runtimeStatus: "当前状态：首条消息尚未发送",
        selectedIdentity: "provisional:workspace:new",
        selectedNewSession: false,
        selectedProvisional: true,
        sessionIdentities: [],
        sessionRowCount: 0
      })
    };

    try {
      await expect(waitForSelectedProvisionalSessionIntent(
        window,
        agentDir,
        new Set(),
        new Set(),
        performance.now() + 1_000
      )).rejects.toThrow(expect.objectContaining({
        message: expect.stringContaining('"newPhysicalSessionFileCount":1')
      }));
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("rejects duplicate provisional intents without exposing their identities", async () => {
    const root = await mkdtemp(join(tmpdir(), "pi67-real-user-duplicate-intent-"));
    const agentDir = join(root, "agent");
    const firstIdentity = "provisional:workspace:sensitive-first";
    const secondIdentity = "provisional:workspace:sensitive-second";
    const window = {
      evaluate: vi.fn().mockResolvedValue({
        errorNotificationCount: 0,
        errorNotificationTitles: [],
        newProvisionalIdentities: [firstIdentity, secondIdentity],
        newSessionIdentities: [],
        newSessionRowCount: 0,
        provisionalRowCount: 2,
        rowCount: 2,
        runtimePhase: "stopped",
        runtimeStatus: "当前状态：首条消息尚未发送",
        selectedIdentity: firstIdentity,
        selectedNewSession: false,
        selectedProvisional: true,
        sessionIdentities: [],
        sessionRowCount: 0
      })
    };

    try {
      let failure;
      await waitForSelectedProvisionalSessionIntent(
        window,
        agentDir,
        new Set(),
        new Set(),
        performance.now() + 1_000
      ).catch((error) => { failure = String(error); });

      expect(failure).toContain('"newProvisionalRowCount":2');
      expect(failure).not.toContain(firstIdentity);
      expect(failure).not.toContain(secondIdentity);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("correlates the selected opaque Session identity with the new Pi JSONL", async () => {
    const root = await mkdtemp(join(tmpdir(), "pi67-real-user-materialized-"));
    const agentDir = join(root, "agent");
    const sessionDirectory = join(agentDir, "sessions", "workspace");
    const sessionPath = join(sessionDirectory, "created.jsonl");
    await mkdir(sessionDirectory, { recursive: true });
    await writeFile(sessionPath, "{\"type\":\"session\"}\n", "utf8");
    const sessionIdentity = `session:workspace:${await resolveExistingSessionFileIdentity(sessionPath)}`;
    try {
      const provisional = {
        errorNotificationCount: 0,
        errorNotificationTitles: [],
        newProvisionalIdentities: ["provisional:workspace:new"],
        newSessionIdentities: [],
        newSessionRowCount: 0,
        provisionalRowCount: 1,
        rowCount: 1,
        runtimePhase: "starting",
        runtimeStatus: "当前状态：正在创建 Pi Session",
        selectedIdentity: "provisional:workspace:new",
        selectedNewSession: false,
        selectedProvisional: true,
        sessionIdentities: [],
        sessionRowCount: 0
      };
      const materialized = {
        ...provisional,
        newProvisionalIdentities: [],
        newSessionIdentities: [sessionIdentity],
        newSessionRowCount: 1,
        provisionalRowCount: 0,
        runtimePhase: "ready",
        selectedIdentity: sessionIdentity,
        selectedNewSession: true,
        selectedProvisional: false,
        sessionIdentities: [sessionIdentity],
        sessionRowCount: 1
      };
      const window = {
        evaluate: vi.fn()
          .mockResolvedValueOnce(provisional)
          .mockResolvedValueOnce(materialized)
      };

      const pending = waitForRealUserCreatedSession(
        window,
        new Set(),
        new Set(),
        agentDir,
        performance.now() + 1_000
      );

      await expect(pending).resolves.toEqual({ sessionIdentity, sessionPath });
      expect(window.evaluate).toHaveBeenCalledTimes(2);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("ignores a late Catalog row for a baseline Pi JSONL", async () => {
    const root = await mkdtemp(join(tmpdir(), "pi67-real-user-late-row-"));
    const agentDir = join(root, "agent");
    const sessionDirectory = join(agentDir, "sessions", "workspace");
    const priorPath = join(sessionDirectory, "prior.jsonl");
    const createdPath = join(sessionDirectory, "created.jsonl");
    await mkdir(sessionDirectory, { recursive: true });
    await writeFile(priorPath, "{\"type\":\"session\"}\n", "utf8");
    await writeFile(createdPath, "{\"type\":\"session\"}\n", "utf8");
    const priorIdentity = `session:workspace:${await resolveExistingSessionFileIdentity(priorPath)}`;
    const createdIdentity = `session:workspace:${await resolveExistingSessionFileIdentity(createdPath)}`;
    const row = (identity, selected = false) => ({
      getAttribute: (name) => {
        if (name === "data-conversation-id") return identity;
        if (name === "aria-current") return selected ? "page" : null;
        return null;
      }
    });
    const rows = [row(priorIdentity), row(createdIdentity, true)];
    vi.stubGlobal("document", {
      querySelectorAll: (selector) => selector === '[data-testid="conversation-row"]' ? rows : [],
      querySelector: () => ({ getAttribute: () => "ready" })
    });
    const window = {
      evaluate: vi.fn(async (callback, baseline) => callback(baseline))
    };

    try {
      await expect(waitForRealUserCreatedSession(
        window,
        new Set(),
        new Set(["prior.jsonl"]),
        agentDir,
        performance.now() + 1_000
      )).resolves.toEqual({ sessionIdentity: createdIdentity, sessionPath: createdPath });
      expect(window.evaluate).toHaveBeenCalledOnce();
    } finally {
      vi.unstubAllGlobals();
      await rm(root, { recursive: true, force: true });
    }
  });

  it("reports bounded runtime failure diagnostics without exposing the opaque Session identity", async () => {
    const root = await mkdtemp(join(tmpdir(), "pi67-real-user-runtime-failure-"));
    const agentDir = join(root, "agent");
    const sensitiveIdentity = "session:workspace:session-file-v1\0sensitive-device\0sensitive-inode";
    try {
      const window = {
        evaluate: vi.fn().mockResolvedValue({
          errorNotificationCount: 1,
          errorNotificationTitles: ["无法创建 Pi 会话"],
          newProvisionalIdentities: [],
          newSessionIdentities: [sensitiveIdentity],
          newSessionRowCount: 1,
          provisionalRowCount: 0,
          rowCount: 1,
          runtimePhase: "failed",
          runtimeStatus: "当前状态：Pi SDK 初始化失败：configuration reload failed",
          selectedIdentity: null,
          selectedNewSession: false,
          selectedProvisional: false,
          sessionIdentities: [sensitiveIdentity],
          sessionRowCount: 1
        })
      };
      let failure;
      await waitForRealUserCreatedSession(
        window,
        new Set(),
        new Set(),
        agentDir,
        performance.now() + 100
      ).catch((error) => { failure = error; });

      expect(String(failure)).toContain("Pi SDK 初始化失败：configuration reload failed");
      expect(String(failure)).toContain("无法创建 Pi 会话");
      expect(String(failure)).toContain('"candidateSessionRowCount":1');
      expect(String(failure)).not.toContain(sensitiveIdentity);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("rejects duplicate rows for one physical JSONL without exposing opaque identities", async () => {
    const root = await mkdtemp(join(tmpdir(), "pi67-real-user-duplicate-rows-"));
    const agentDir = join(root, "agent");
    const sessionDirectory = join(agentDir, "sessions", "workspace");
    const sessionFileName = "created.jsonl";
    const sessionPath = join(sessionDirectory, sessionFileName);
    await mkdir(sessionDirectory, { recursive: true });
    await writeFile(sessionPath, "{\"type\":\"session\"}\n", "utf8");
    const fileIdentity = await resolveExistingSessionFileIdentity(sessionPath);
    const firstIdentity = `session:workspace-a:${fileIdentity}`;
    const secondIdentity = `session:workspace-b:${fileIdentity}`;
    const window = {
      evaluate: vi.fn().mockResolvedValue({
        errorNotificationCount: 0,
        errorNotificationTitles: [],
        newProvisionalIdentities: [],
        newSessionIdentities: [firstIdentity, secondIdentity],
        newSessionRowCount: 2,
        provisionalRowCount: 0,
        rowCount: 2,
        runtimePhase: "starting",
        runtimeStatus: "当前状态：正在创建 Pi Session",
        selectedIdentity: firstIdentity,
        selectedNewSession: true,
        selectedProvisional: false,
        sessionIdentities: [firstIdentity, secondIdentity],
        sessionRowCount: 2
      })
    };

    try {
      let failure;
      await waitForRealUserCreatedSession(
        window,
        new Set(),
        new Set(),
        agentDir,
        performance.now() + 1_000
      ).catch((error) => { failure = String(error); });

      expect(failure).toContain('"newPhysicalSessionFileCount":1');
      expect(failure).toContain('"newSessionRowCount":2');
      expect(failure).toContain(`"newPhysicalSessionFileNames":["${sessionFileName}"]`);
      expect(failure).not.toContain(firstIdentity);
      expect(failure).not.toContain(secondIdentity);
      expect(failure).not.toContain(sessionPath);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("rejects two newly materialized Pi JSONLs before selecting either row", async () => {
    const root = await mkdtemp(join(tmpdir(), "pi67-real-user-duplicate-files-"));
    const agentDir = join(root, "agent");
    const sessionDirectory = join(agentDir, "sessions", "workspace");
    const firstFileName = "first.jsonl";
    const secondFileName = "second.jsonl";
    const firstPath = join(sessionDirectory, firstFileName);
    const secondPath = join(sessionDirectory, secondFileName);
    await mkdir(sessionDirectory, { recursive: true });
    await writeFile(firstPath, "{\"type\":\"session\"}\n", "utf8");
    await writeFile(secondPath, "{\"type\":\"session\"}\n", "utf8");
    const firstIdentity = `session:workspace:${await resolveExistingSessionFileIdentity(firstPath)}`;
    const secondIdentity = `session:workspace:${await resolveExistingSessionFileIdentity(secondPath)}`;
    const window = {
      evaluate: vi.fn().mockResolvedValue({
        errorNotificationCount: 0,
        errorNotificationTitles: [],
        newProvisionalIdentities: [],
        newSessionIdentities: [firstIdentity, secondIdentity],
        newSessionRowCount: 2,
        provisionalRowCount: 0,
        rowCount: 2,
        runtimePhase: "starting",
        runtimeStatus: "当前状态：正在创建 Pi Session",
        selectedIdentity: null,
        selectedNewSession: false,
        selectedProvisional: false,
        sessionIdentities: [firstIdentity, secondIdentity],
        sessionRowCount: 2
      })
    };

    try {
      await expect(waitForRealUserCreatedSession(
        window,
        new Set(),
        new Set(),
        agentDir,
        performance.now() + 1_000
      )).rejects.toThrow(expect.objectContaining({
        message: expect.stringContaining('"newPhysicalSessionFileCount":2')
      }));
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
