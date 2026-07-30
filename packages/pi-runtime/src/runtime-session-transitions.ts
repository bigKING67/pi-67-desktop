import type { SessionSnapshot } from "@pi67/domain";
import { runCrossRuntimeSessionFork } from "./session-cross-runtime-fork.js";
import {
  discardStagedSessionImport,
  resolveManagedSessionPath,
  stageSessionImport
} from "./session-import.js";

type SessionCatalogReason = "session-created" | "session-imported" | "session-updated";

interface RuntimeSessionTransitionsOptions {
  getCwd: () => string;
  getAgentDir: () => string;
  getSessionDirectory: () => string;
  getActiveSessionPath: () => string | undefined;
  prepare: () => Promise<void>;
  switchSession: (path: string, cwdOverride?: string) => Promise<{ cancelled: boolean }>;
  commit: (reason: SessionCatalogReason) => Promise<SessionSnapshot>;
}

export class RuntimeSessionTransitions {
  constructor(private readonly options: RuntimeSessionTransitionsOptions) {}

  async open(path: string, cwdOverride?: string): Promise<SessionSnapshot> {
    await this.options.prepare();
    const managedPath = await resolveManagedSessionPath(
      path,
      cwdOverride ?? this.options.getCwd(),
      this.options.getAgentDir()
    );
    const result = await this.options.switchSession(managedPath, cwdOverride);
    if (result.cancelled) throw new Error("A Pi extension cancelled the session switch.");
    return this.options.commit("session-updated");
  }

  async import(path: string): Promise<SessionSnapshot> {
    await this.options.prepare();
    const staged = await stageSessionImport(
      path,
      this.options.getSessionDirectory(),
      this.options.getCwd()
    );
    let switched = false;
    try {
      const result = await this.options.switchSession(staged.path, staged.sessionManager.getCwd());
      if (result.cancelled) throw new Error("A Pi extension cancelled the session import.");
      switched = true;
      return await this.options.commit("session-imported");
    } catch (error) {
      if (!switched) await discardStagedSessionImport(staged, error);
      throw error;
    }
  }

  forkFrom(sourcePath: string, entryId: string): Promise<SessionSnapshot> {
    return runCrossRuntimeSessionFork({
      sourcePath,
      entryId,
      cwd: this.options.getCwd(),
      agentDir: this.options.getAgentDir(),
      prepare: this.options.prepare,
      switchSession: (path, cwd) => this.options.switchSession(path, cwd),
      getActiveSessionPath: this.options.getActiveSessionPath,
      commit: () => this.options.commit("session-created")
    });
  }
}
