import type { SkillPackEntry } from "@pi67/domain";
import { describe, expect, it } from "vitest";
import { isReplaySafeControlMutation } from "./agent-messages.js";
import {
  APP_PROTOCOL_CONTEXT,
  commandEnvelope,
  hasValidCommandContext,
  isRequestEnvelope,
  isResponseEnvelope,
  responseEnvelope,
  type ProtocolContext
} from "./envelope.js";

const WORKSPACE_CONTEXT: ProtocolContext = {
  scope: "workspace",
  workspaceId: "workspace-skills"
};
const TASK_CONTEXT: ProtocolContext = {
  scope: "task",
  workspaceId: "workspace-skills",
  taskId: "task-skills",
  taskGeneration: 1
};

const PACK: SkillPackEntry = {
  id: "lark-cli-global",
  suiteId: "lark-cli",
  displayName: "飞书 Lark CLI",
  description: "飞书文档、消息和开放平台能力。",
  manager: "lark-cli",
  updateOwner: "managed-pack",
  updateStatus: "update-available",
  localState: "clean",
  provenance: "verified",
  installed: true,
  installedSkillCount: 27,
  skillIds: ["lark-doc", "lark-calendar"],
  canUpdate: true,
  effectiveSource: "managed",
  canRestore: false,
  installedVersion: "1.0.65",
  latestVersion: "1.0.80",
  source: "@larksuite/cli"
};

describe("Skill Pack management protocol", () => {
  it("requires Workspace authority and replay protection for updates", () => {
    expect(hasValidCommandContext("skill.pack.list", WORKSPACE_CONTEXT)).toBe(true);
    expect(hasValidCommandContext("skill.pack.list", APP_PROTOCOL_CONTEXT)).toBe(false);
    expect(hasValidCommandContext("skill.pack.list", TASK_CONTEXT)).toBe(false);
    expect(isReplaySafeControlMutation("skill.pack.update")).toBe(true);
    expect(isReplaySafeControlMutation("skill.pack.restore")).toBe(true);

    const update = commandEnvelope(
      "skill.pack.update",
      { id: "lark-cli-global" },
      WORKSPACE_CONTEXT,
      2,
      "update-lark"
    );
    expect(isRequestEnvelope(update)).toBe(true);
    const { idempotencyKey: _idempotencyKey, ...withoutKey } = update;
    expect(isRequestEnvelope(withoutKey)).toBe(false);
    expect(isRequestEnvelope({ ...update, payload: { id: "bad id" } })).toBe(false);
    expect(isRequestEnvelope({ ...update, payload: { id: "lark-cli-global", path: "/private" } })).toBe(false);

    const restore = commandEnvelope(
      "skill.pack.restore",
      { id: "ai-berkshire-investment-suite" },
      WORKSPACE_CONTEXT,
      2,
      "restore-ai-berkshire"
    );
    expect(isRequestEnvelope(restore)).toBe(true);
  });

  it("validates bounded Skill Pack inventory and update results", () => {
    const list = responseEnvelope("skill-list", 2, WORKSPACE_CONTEXT, {
      ok: true,
      type: "skill.pack.checkUpdates",
      result: { items: [PACK], total: 1, checkedAt: 1_722_400_000_000 }
    });
    expect(isResponseEnvelope(list)).toBe(true);
    expect(isResponseEnvelope({
      ...list,
      result: {
        items: [{ ...PACK, skillIds: Array.from({ length: 257 }, (_, index) => `skill-${index}`) }],
        total: 1
      }
    })).toBe(false);

    const mutationResult = {
      items: [{
        ...PACK,
        updateStatus: "current" as const,
        canUpdate: false,
        installedVersion: "1.0.80"
      }],
      total: 1,
      checkedAt: 1_722_400_000_100,
      changed: true
    };
    const mutation = responseEnvelope("skill-update", 2, WORKSPACE_CONTEXT, {
      ok: true,
      type: "skill.pack.update",
      result: mutationResult
    });
    expect(isResponseEnvelope(mutation)).toBe(true);
    expect(isResponseEnvelope({
      ...mutation,
      result: { ...mutationResult, executable: "/private/lark-cli" }
    })).toBe(false);
  });
});
