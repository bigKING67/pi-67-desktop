import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
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

  it("polls Session materialization without a blocking active-row locator", async () => {
    vi.useFakeTimers();
    try {
      const provisional = {
        errorNotificationCount: 0,
        newSessionIdentities: [],
        newSessionRowCount: 0,
        provisionalRowCount: 1,
        rowCount: 2,
        runtimePhase: "starting",
        selectedIdentity: "provisional:workspace:new",
        selectedNewSession: false,
        selectedProvisional: true,
        sessionIdentities: ["session:workspace:existing.jsonl"],
        sessionRowCount: 1
      };
      const materialized = {
        ...provisional,
        newSessionIdentities: ["session:workspace:new.jsonl"],
        newSessionRowCount: 1,
        provisionalRowCount: 0,
        runtimePhase: "ready",
        selectedIdentity: "session:workspace:new.jsonl",
        selectedNewSession: true,
        selectedProvisional: false,
        sessionIdentities: ["session:workspace:existing.jsonl", "session:workspace:new.jsonl"],
        sessionRowCount: 2
      };
      const window = {
        evaluate: vi.fn()
          .mockResolvedValueOnce(provisional)
          .mockResolvedValueOnce(materialized)
      };

      const pending = waitForRealUserCreatedSession(
        window,
        new Set(["session:workspace:existing.jsonl"]),
        new Set(),
        performance.now() + 1_000
      );
      await vi.advanceTimersByTimeAsync(50);

      await expect(pending).resolves.toBe("session:workspace:new.jsonl");
      expect(window.evaluate).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("uses the Pi JSONL baseline when an existing Session reaches the DOM late", async () => {
    const priorIdentity = "session:workspace:C:\\isolated\\agent\\prior.jsonl";
    const createdIdentity = "session:workspace:C:\\isolated\\agent\\created.jsonl";
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
        performance.now() + 1_000
      )).resolves.toBe(createdIdentity);
      expect(window.evaluate).toHaveBeenCalledOnce();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("reports bounded runtime failure diagnostics without exposing the full Session identity", async () => {
    vi.useFakeTimers();
    try {
      const window = {
        evaluate: vi.fn().mockResolvedValue({
          errorNotificationCount: 1,
          errorNotificationTitles: ["无法创建 Pi 会话"],
          newSessionIdentities: ["session:workspace:sensitive.jsonl"],
          newSessionRowCount: 1,
          provisionalRowCount: 0,
          rowCount: 1,
          runtimePhase: "failed",
          runtimeStatus: "当前状态：Pi SDK 初始化失败：configuration reload failed",
          selectedIdentity: null,
          selectedNewSession: false,
          selectedProvisional: false,
          sessionIdentities: ["session:workspace:sensitive.jsonl"],
          sessionRowCount: 1
        })
      };
      let failure;
      const pending = waitForRealUserCreatedSession(
        window,
        new Set(),
        new Set(),
        performance.now() + 100
      ).catch((error) => { failure = error; });

      await vi.advanceTimersByTimeAsync(150);
      await pending;

      expect(String(failure)).toContain("Pi SDK 初始化失败：configuration reload failed");
      expect(String(failure)).toContain("无法创建 Pi 会话");
      expect(String(failure)).toContain("sensitive.jsonl");
      expect(String(failure)).not.toContain("session:workspace:sensitive.jsonl");
    } finally {
      vi.useRealTimers();
    }
  });

  it("distinguishes duplicate path identities for one JSONL without exposing either path", async () => {
    const sessionFileName = "2026-08-04T10-20-30-123Z_11111111-2222-4333-8444-555555555555.jsonl";
    const firstIdentity = `session:workspace:C:\\Users\\person\\.pi\\agent\\sessions\\${sessionFileName}`;
    const secondIdentity = `session:workspace:c:\\users\\person\\.pi\\agent\\sessions\\${sessionFileName}`;
    const window = {
      evaluate: vi.fn().mockResolvedValue({
        errorNotificationCount: 0,
        errorNotificationTitles: [],
        newSessionIdentities: [firstIdentity, secondIdentity],
        newSessionRowCount: 2,
        provisionalRowCount: 1,
        rowCount: 3,
        runtimePhase: "starting",
        runtimeStatus: "当前状态：正在创建 Pi Session",
        selectedIdentity: "provisional:workspace:new",
        selectedNewSession: false,
        selectedProvisional: true,
        sessionIdentities: [firstIdentity, secondIdentity],
        sessionRowCount: 2
      })
    };

    await expect(waitForRealUserCreatedSession(
      window,
      new Set(),
      new Set(),
      performance.now() + 1_000
    )).rejects.toThrow(expect.objectContaining({
      message: expect.stringContaining('"distinctNewSessionFileNameCount":1')
    }));

    let failure;
    try {
      await waitForRealUserCreatedSession(window, new Set(), new Set(), performance.now() + 1_000);
    } catch (error) {
      failure = String(error);
    }
    expect(failure).toContain(`"newSessionFileNames":["${sessionFileName}","${sessionFileName}"]`);
    expect(failure).toMatch(/"newSessionIdentityFingerprints":\["[a-f0-9]{12}","[a-f0-9]{12}"\]/u);
    expect(failure).not.toContain("C:\\Users\\person");
    expect(failure).not.toContain("c:\\users\\person");
    expect(failure).not.toContain(firstIdentity);
    expect(failure).not.toContain(secondIdentity);
  });

  it("reports two distinct JSONL names when duplicate rows represent separate Sessions", async () => {
    const firstFileName = "2026-08-04T10-20-30-123Z_11111111-2222-4333-8444-555555555555.jsonl";
    const secondFileName = "2026-08-04T10-20-31-123Z_aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee.jsonl";
    const window = {
      evaluate: vi.fn().mockResolvedValue({
        errorNotificationCount: 0,
        errorNotificationTitles: [],
        newSessionIdentities: [
          `session:workspace:C:\\private\\agent\\${firstFileName}`,
          `session:workspace:C:\\private\\agent\\${secondFileName}`
        ],
        newSessionRowCount: 2,
        provisionalRowCount: 1,
        rowCount: 3,
        runtimePhase: "starting",
        runtimeStatus: "当前状态：正在创建 Pi Session",
        selectedIdentity: "provisional:workspace:new",
        selectedNewSession: false,
        selectedProvisional: true,
        sessionIdentities: [],
        sessionRowCount: 2
      })
    };

    await expect(waitForRealUserCreatedSession(
      window,
      new Set(),
      new Set(),
      performance.now() + 1_000
    )).rejects.toThrow(expect.objectContaining({
      message: expect.stringContaining('"distinctNewSessionFileNameCount":2')
    }));
  });
});
