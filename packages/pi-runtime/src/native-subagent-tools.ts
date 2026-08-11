import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import {
  MAX_NATIVE_SUBAGENT_SPAWN_BATCH,
  MAX_NATIVE_SUBAGENT_STEER_CHARS,
  MAX_NATIVE_SUBAGENT_TASK_CHARS,
  MAX_NATIVE_SUBAGENT_WAIT_MS,
  RuntimeError,
  type NativeSubagentContext,
  type NativeSubagentIsolation,
  type NativeSubagentMode,
  type NativeSubagentReasoningLevel,
  type NativeSubagentRole,
  type NativeSubagentSpawnRequest,
  type NativeSubagentView,
  type NativeSubagentWaitResult
} from "@pi67/domain";

export interface NativeSubagentOperations {
  spawn(request: NativeSubagentSpawnRequest, parentChildId?: string, parentDepth?: number): Promise<NativeSubagentView>;
  list(): NativeSubagentView[];
  status(id: string): NativeSubagentView;
  steer(id: string, text: string): Promise<NativeSubagentView>;
  stop(id: string): Promise<NativeSubagentView>;
  resume(id: string, mode?: NativeSubagentMode): Promise<NativeSubagentView>;
  wait(ids: readonly string[], mode: "first" | "all", timeoutMs: number): Promise<NativeSubagentWaitResult>;
}

export interface NativeSubagentToolContext {
  parentChildId?: string;
  depth: number;
}

export function createNativeSubagentTools(
  operations: NativeSubagentOperations,
  context: NativeSubagentToolContext = { depth: 0 }
): ToolDefinition[] {
  const subagent: ToolDefinition = {
    name: "subagent",
    label: "Native subagent",
    description: "Spawn and control Pi-67 native child Pi sessions without invoking a system Pi CLI.",
    promptSnippet: "Delegate bounded independent work to persistent Pi-67 native subagents.",
    promptGuidelines: [
      "Use explorer for read-only mapping, worker for bounded implementation, reviewer for evidence-driven review, and general otherwise.",
      "Browser Profile selection is not part of subagent spawning; select a browser instance only when a child actually calls browser67 tools.",
      "Worktree isolation is not available yet; shared is the only executable isolation mode."
    ],
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["action"],
      properties: {
        action: { enum: ["spawn", "list", "status", "steer", "stop", "resume"] },
        task: { type: "string", minLength: 1, maxLength: MAX_NATIVE_SUBAGENT_TASK_CHARS },
        tasks: {
          type: "array",
          minItems: 1,
          maxItems: MAX_NATIVE_SUBAGENT_SPAWN_BATCH,
          items: spawnRequestSchema()
        },
        role: { enum: ["explorer", "worker", "reviewer", "general"] },
        mode: { enum: ["foreground", "background"] },
        context: { enum: ["fresh", "fork"] },
        isolation: { enum: ["shared", "worktree"] },
        model: modelSchema(),
        reasoning: { enum: ["off", "minimal", "low", "medium", "high", "xhigh", "max"] },
        id: { type: "string", minLength: 1, maxLength: 512 },
        text: { type: "string", minLength: 1, maxLength: MAX_NATIVE_SUBAGENT_STEER_CHARS }
      }
    } as ToolDefinition["parameters"],
    executionMode: "parallel",
    async execute(_toolCallId, rawInput) {
      const input = record(rawInput);
      const action = requiredEnum(input.action, "action", ["spawn", "list", "status", "steer", "stop", "resume"]);
      if (action === "list") return result(action, operations.list());
      if (action === "spawn") {
        const requests = parseSpawnRequests(input);
        const pending = requests.map((request) => operations.spawn(
          request,
          context.parentChildId,
          context.depth
        ));
        const items = await Promise.all(pending);
        if (requests.some((request) => (request.mode ?? "foreground") === "foreground")) {
          const foreground = items.filter((_item, index) => (
            (requests[index]?.mode ?? "foreground") === "foreground"
          ));
          const settled = await operations.wait(foreground.map((item) => item.runId), "all", MAX_NATIVE_SUBAGENT_WAIT_MS);
          const byRunId = new Map(settled.items.map((item) => [item.runId, item]));
          return result(action, items.map((item) => byRunId.get(item.runId) ?? item), { timedOut: settled.timedOut });
        }
        return result(action, items);
      }

      const id = requiredString(input.id, "id", 512);
      if (action === "status") return result(action, [operations.status(id)]);
      if (action === "steer") {
        const text = requiredString(input.text, "text", MAX_NATIVE_SUBAGENT_STEER_CHARS);
        return result(action, [await operations.steer(id, text)]);
      }
      if (action === "stop") return result(action, [await operations.stop(id)]);
      const mode = optionalEnum(input.mode, "mode", ["foreground", "background"]);
      const resumed = await operations.resume(id, mode);
      if ((mode ?? resumed.mode) === "foreground") {
        const settled = await operations.wait([resumed.runId], "all", MAX_NATIVE_SUBAGENT_WAIT_MS);
        return result(action, settled.items, { timedOut: settled.timedOut });
      }
      return result(action, [resumed]);
    }
  };

  const subagentWait: ToolDefinition = {
    name: "subagent_wait",
    label: "Wait for native subagents",
    description: "Wait for the first or all selected Pi-67 native subagents to reach a durable terminal state.",
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["ids"],
      properties: {
        ids: {
          type: "array",
          minItems: 1,
          maxItems: MAX_NATIVE_SUBAGENT_SPAWN_BATCH,
          items: { type: "string", minLength: 1, maxLength: 512 }
        },
        mode: { enum: ["first", "all"] },
        timeout_ms: { type: "integer", minimum: 1_000, maximum: MAX_NATIVE_SUBAGENT_WAIT_MS }
      }
    } as ToolDefinition["parameters"],
    executionMode: "parallel",
    async execute(_toolCallId, rawInput) {
      const input = record(rawInput);
      const ids = stringArray(input.ids, "ids", MAX_NATIVE_SUBAGENT_SPAWN_BATCH);
      const mode = optionalEnum(input.mode, "mode", ["first", "all"]) ?? "all";
      const timeoutMs = optionalInteger(input.timeout_ms, "timeout_ms", 1_000, MAX_NATIVE_SUBAGENT_WAIT_MS) ?? 30_000;
      const waited = await operations.wait(ids, mode, timeoutMs);
      return result("wait", waited.items, { timedOut: waited.timedOut });
    }
  };

  return [subagent, subagentWait];
}

function parseSpawnRequests(input: Record<string, unknown>): NativeSubagentSpawnRequest[] {
  if (input.tasks !== undefined && input.task !== undefined) {
    throw invalid("Use either task or tasks for subagent spawn, not both.");
  }
  if (input.tasks !== undefined) {
    if (!Array.isArray(input.tasks) || input.tasks.length < 1 || input.tasks.length > MAX_NATIVE_SUBAGENT_SPAWN_BATCH) {
      throw invalid(`tasks must contain 1-${MAX_NATIVE_SUBAGENT_SPAWN_BATCH} child requests.`);
    }
    return input.tasks.map((value) => parseSpawnRequest(record(value)));
  }
  return [parseSpawnRequest(input)];
}

function parseSpawnRequest(input: Record<string, unknown>): NativeSubagentSpawnRequest {
  const allowed = new Set(["action", "task", "role", "mode", "context", "isolation", "model", "reasoning"]);
  for (const key of Object.keys(input)) {
    if (!allowed.has(key)) throw invalid(`Unknown native subagent spawn field: ${key}`);
  }
  const modelRecord = input.model === undefined ? undefined : record(input.model);
  return {
    task: requiredString(input.task, "task", MAX_NATIVE_SUBAGENT_TASK_CHARS),
    ...(optionalEnum(input.role, "role", ["explorer", "worker", "reviewer", "general"]) === undefined
      ? {}
      : { role: input.role as NativeSubagentRole }),
    ...(optionalEnum(input.mode, "mode", ["foreground", "background"]) === undefined
      ? {}
      : { mode: input.mode as NativeSubagentMode }),
    ...(optionalEnum(input.context, "context", ["fresh", "fork"]) === undefined
      ? {}
      : { context: input.context as NativeSubagentContext }),
    ...(optionalEnum(input.isolation, "isolation", ["shared", "worktree"]) === undefined
      ? {}
      : { isolation: input.isolation as NativeSubagentIsolation }),
    ...(modelRecord === undefined ? {} : {
      model: {
        provider: requiredString(modelRecord.provider, "model.provider", 256),
        id: requiredString(modelRecord.id, "model.id", 256)
      }
    }),
    ...(optionalEnum(input.reasoning, "reasoning", ["off", "minimal", "low", "medium", "high", "xhigh", "max"]) === undefined
      ? {}
      : { reasoning: input.reasoning as NativeSubagentReasoningLevel })
  };
}

function spawnRequestSchema() {
  return {
    type: "object",
    additionalProperties: false,
    required: ["task"],
    properties: {
      task: { type: "string", minLength: 1, maxLength: MAX_NATIVE_SUBAGENT_TASK_CHARS },
      role: { enum: ["explorer", "worker", "reviewer", "general"] },
      mode: { enum: ["foreground", "background"] },
      context: { enum: ["fresh", "fork"] },
      isolation: { enum: ["shared", "worktree"] },
      model: modelSchema(),
      reasoning: { enum: ["off", "minimal", "low", "medium", "high", "xhigh", "max"] }
    }
  };
}

function modelSchema() {
  return {
    type: "object",
    additionalProperties: false,
    required: ["provider", "id"],
    properties: {
      provider: { type: "string", minLength: 1, maxLength: 256 },
      id: { type: "string", minLength: 1, maxLength: 256 }
    }
  };
}

function result(action: string, items: NativeSubagentView[], extra: { timedOut?: boolean } = {}) {
  const details = { action, items, ...extra };
  return {
    content: [{ type: "text" as const, text: JSON.stringify(details, null, 2) }],
    details
  };
}

function record(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw invalid("Expected an object.");
  return value as Record<string, unknown>;
}

function requiredString(value: unknown, field: string, maxLength: number): string {
  if (typeof value !== "string" || value.trim().length < 1 || value.length > maxLength) {
    throw invalid(`${field} must be a non-empty string of at most ${maxLength} characters.`);
  }
  return value.trim();
}

function optionalEnum<T extends string>(value: unknown, field: string, allowed: readonly T[]): T | undefined {
  if (value === undefined) return undefined;
  return requiredEnum(value, field, allowed);
}

function requiredEnum<T extends string>(value: unknown, field: string, allowed: readonly T[]): T {
  if (typeof value !== "string" || !allowed.includes(value as T)) {
    throw invalid(`${field} must be one of: ${allowed.join(", ")}.`);
  }
  return value as T;
}

function optionalInteger(
  value: unknown,
  field: string,
  minimum: number,
  maximum: number
): number | undefined {
  if (value === undefined) return undefined;
  if (!Number.isInteger(value) || (value as number) < minimum || (value as number) > maximum) {
    throw invalid(`${field} must be an integer between ${minimum} and ${maximum}.`);
  }
  return value as number;
}

function stringArray(value: unknown, field: string, maxItems: number): string[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > maxItems) {
    throw invalid(`${field} must contain 1-${maxItems} identifiers.`);
  }
  return value.map((item) => requiredString(item, field, 512));
}

function invalid(message: string): RuntimeError {
  return new RuntimeError("INVALID_PAYLOAD", message);
}
