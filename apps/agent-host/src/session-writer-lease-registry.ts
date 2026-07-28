import { realpath } from "node:fs/promises";
import { resolve } from "node:path";
import { createMessageId } from "@pi67/protocol";
import { HostCommandError } from "./protocol-error.js";

export interface SessionWriterLeaseReservation {
  readonly token: string;
  readonly taskKey: string;
  readonly sessionPathIdentity: string;
}

interface SessionOwner {
  taskKey: string;
  token?: string;
}

export type CanonicalSessionPath = (path: string) => Promise<string>;

export class SessionWriterLeaseRegistry {
  private readonly activeByTask = new Map<string, string>();
  private readonly pendingByTask = new Map<string, SessionWriterLeaseReservation>();
  private readonly owners = new Map<string, SessionOwner>();

  constructor(private readonly canonicalize: CanonicalSessionPath = canonicalSessionPath) {}

  async reserve(taskKey: string, sessionPath: string): Promise<SessionWriterLeaseReservation> {
    if (this.pendingByTask.has(taskKey)) {
      throw new HostCommandError(
        "BUSY",
        "This Task already has a pending Pi Session transition.",
        true
      );
    }
    const sessionPathIdentity = await this.canonicalize(sessionPath);
    const owner = this.owners.get(sessionPathIdentity);
    if (owner && owner.taskKey !== taskKey) {
      throw new HostCommandError(
        "BUSY",
        "This Pi Session is already open in another Task.",
        true,
        { sessionWriterLeaseConflict: true }
      );
    }
    const reservation: SessionWriterLeaseReservation = {
      token: createMessageId("session-lease"),
      taskKey,
      sessionPathIdentity
    };
    this.pendingByTask.set(taskKey, reservation);
    if (!owner) this.owners.set(sessionPathIdentity, { taskKey, token: reservation.token });
    return reservation;
  }

  commit(reservation: SessionWriterLeaseReservation): void {
    this.assertCurrentReservation(reservation);
    const previous = this.activeByTask.get(reservation.taskKey);
    if (previous && previous !== reservation.sessionPathIdentity) {
      this.owners.delete(previous);
    }
    this.activeByTask.set(reservation.taskKey, reservation.sessionPathIdentity);
    this.owners.set(reservation.sessionPathIdentity, { taskKey: reservation.taskKey });
    this.pendingByTask.delete(reservation.taskKey);
  }

  cancel(reservation: SessionWriterLeaseReservation): void {
    const current = this.pendingByTask.get(reservation.taskKey);
    if (current?.token !== reservation.token) return;
    const owner = this.owners.get(reservation.sessionPathIdentity);
    if (owner?.token === reservation.token) this.owners.delete(reservation.sessionPathIdentity);
    this.pendingByTask.delete(reservation.taskKey);
  }

  releaseTask(taskKey: string): void {
    const pending = this.pendingByTask.get(taskKey);
    if (pending) this.cancel(pending);
    const active = this.activeByTask.get(taskKey);
    if (active) {
      const owner = this.owners.get(active);
      if (owner?.taskKey === taskKey) this.owners.delete(active);
      this.activeByTask.delete(taskKey);
    }
  }

  activeIdentityFor(taskKey: string): string | undefined {
    return this.activeByTask.get(taskKey);
  }

  private assertCurrentReservation(reservation: SessionWriterLeaseReservation): void {
    const current = this.pendingByTask.get(reservation.taskKey);
    if (current?.token === reservation.token) return;
    throw new HostCommandError(
      "STALE_SESSION_GENERATION",
      "The Pi Session writer lease reservation is stale.",
      true
    );
  }
}

async function canonicalSessionPath(path: string): Promise<string> {
  const resolved = await realpath(path).catch((error: unknown) => {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return resolve(path);
    throw error;
  });
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}
