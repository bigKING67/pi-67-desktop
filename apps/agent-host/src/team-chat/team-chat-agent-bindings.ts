import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { TEAM_CHAT_AGENT_LIMITS, type TeamChatAgentBinding } from "@pi67/domain";

const SCHEMA = "pi67.team-chat-agents.v1";

interface PersistedBindings {
  schema: typeof SCHEMA;
  /** Bindings per New Money team; only Agents this user owns. No credentials or content. */
  teams: Record<string, TeamChatAgentBinding[]>;
}

/**
 * Which of the user's Agents this Desktop hosts, per team (ADR 0004). Writes are
 * serialized and atomic; an unreadable file is treated as no bindings.
 */
export class TeamChatAgentBindingStore {
  readonly #path: string;
  #cache: PersistedBindings | undefined;
  #queue: Promise<unknown> = Promise.resolve();

  constructor(storageRoot: string) {
    this.#path = join(storageRoot, "team-chat", "agents.json");
  }

  async list(teamId: string): Promise<TeamChatAgentBinding[]> {
    return [...(await this.#read()).teams[teamId] ?? []];
  }

  async hasEnabled(): Promise<boolean> {
    return Object.values((await this.#read()).teams).some((bindings) => bindings.some((binding) => binding.enabled));
  }

  async enabledAgentIds(teamId: string): Promise<string[]> {
    return (await this.list(teamId)).filter((binding) => binding.enabled).map((binding) => binding.agentUserId);
  }

  async find(teamId: string, agentUserId: string): Promise<TeamChatAgentBinding | undefined> {
    return (await this.list(teamId)).find((binding) => binding.agentUserId === agentUserId);
  }

  put(teamId: string, binding: TeamChatAgentBinding): Promise<TeamChatAgentBinding[]> {
    return this.#mutate(teamId, (bindings) => {
      const next = [...bindings.filter((item) => item.agentUserId !== binding.agentUserId), binding];
      if (next.length > TEAM_CHAT_AGENT_LIMITS.perOwner) throw new RangeError("Too many hosted Agents.");
      return next;
    });
  }

  remove(teamId: string, agentUserId: string): Promise<TeamChatAgentBinding[]> {
    return this.#mutate(teamId, (bindings) => bindings.filter((item) => item.agentUserId !== agentUserId));
  }

  /** Drops bindings for Agents the service no longer lists as this user's. */
  retain(teamId: string, ownedAgentIds: ReadonlySet<string>): Promise<TeamChatAgentBinding[]> {
    return this.#mutate(teamId, (bindings) => bindings.filter((item) => ownedAgentIds.has(item.agentUserId)));
  }

  #mutate(teamId: string, change: (bindings: TeamChatAgentBinding[]) => TeamChatAgentBinding[]): Promise<TeamChatAgentBinding[]> {
    const run = this.#queue.then(async () => {
      const current = await this.#read();
      const next = change(current.teams[teamId] ?? []);
      const teams = { ...current.teams, [teamId]: next };
      if (next.length === 0) delete teams[teamId];
      const persisted: PersistedBindings = { schema: SCHEMA, teams };
      const temporary = `${this.#path}.tmp`;
      await mkdir(dirname(this.#path), { recursive: true });
      await writeFile(temporary, `${JSON.stringify(persisted, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
      await rename(temporary, this.#path);
      this.#cache = persisted;
      return [...next];
    });
    this.#queue = run.catch(() => undefined);
    return run;
  }

  async #read(): Promise<PersistedBindings> {
    if (this.#cache) return this.#cache;
    try {
      const parsed = JSON.parse(await readFile(this.#path, "utf8")) as unknown;
      this.#cache = isPersisted(parsed) ? parsed : { schema: SCHEMA, teams: {} };
    } catch {
      this.#cache = { schema: SCHEMA, teams: {} };
    }
    return this.#cache;
  }
}

function isPersisted(value: unknown): value is PersistedBindings {
  if (typeof value !== "object" || value === null) return false;
  const record = value as { schema?: unknown; teams?: unknown };
  if (record.schema !== SCHEMA || typeof record.teams !== "object" || record.teams === null) return false;
  return Object.values(record.teams).every((bindings) => Array.isArray(bindings) && bindings.every(isBinding));
}

function isBinding(value: unknown): value is TeamChatAgentBinding {
  if (typeof value !== "object" || value === null) return false;
  const binding = value as Record<string, unknown>;
  const model = binding.model as Record<string, unknown> | undefined;
  return typeof binding.agentUserId === "string" && typeof binding.workspaceId === "string"
    && typeof binding.projectId === "string" && typeof binding.enabled === "boolean"
    && typeof model === "object" && model !== null && typeof model.provider === "string" && typeof model.id === "string";
}
