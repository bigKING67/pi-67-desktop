const DEFAULT_GLOBAL_CONCURRENCY = 2;
const DEFAULT_QUEUE_LIMIT = 32;

export type RepositoryMutationAdmissionFailure = "queue-full" | "repository-indeterminate" | "disposed";

export class RepositoryMutationAdmissionError extends Error {
  constructor(readonly code: RepositoryMutationAdmissionFailure) {
    super(`Repository mutation was not admitted (${code}).`);
    this.name = "RepositoryMutationAdmissionError";
  }
}

interface PendingMutation<T> {
  repositoryGroupId: string;
  operation: () => Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
}

export interface RepositoryMutationSchedulerOptions {
  globalConcurrency?: number;
  queueLimit?: number;
}

export class RepositoryMutationScheduler {
  readonly #globalConcurrency: number;
  readonly #queueLimit: number;
  readonly #queue: PendingMutation<unknown>[] = [];
  readonly #activeRepositories = new Set<string>();
  readonly #fencedRepositories = new Set<string>();
  #activeCount = 0;
  #disposed = false;

  constructor(options: RepositoryMutationSchedulerOptions = {}) {
    this.#globalConcurrency = positiveInteger(options.globalConcurrency ?? DEFAULT_GLOBAL_CONCURRENCY);
    this.#queueLimit = positiveInteger(options.queueLimit ?? DEFAULT_QUEUE_LIMIT);
  }

  run<T>(repositoryGroupId: string, operation: () => Promise<T>): Promise<T> {
    if (this.#disposed) return Promise.reject(new RepositoryMutationAdmissionError("disposed"));
    if (this.#fencedRepositories.has(repositoryGroupId)) {
      return Promise.reject(new RepositoryMutationAdmissionError("repository-indeterminate"));
    }
    if (this.#queue.length >= this.#queueLimit) {
      return Promise.reject(new RepositoryMutationAdmissionError("queue-full"));
    }
    return new Promise<T>((resolve, reject) => {
      this.#queue.push({ repositoryGroupId, operation, resolve, reject } as PendingMutation<unknown>);
      this.#drain();
    });
  }

  fence(repositoryGroupId: string): void {
    this.#fencedRepositories.add(repositoryGroupId);
    const error = new RepositoryMutationAdmissionError("repository-indeterminate");
    for (let index = this.#queue.length - 1; index >= 0; index -= 1) {
      const pending = this.#queue[index];
      if (pending?.repositoryGroupId !== repositoryGroupId) continue;
      this.#queue.splice(index, 1);
      pending.reject(error);
    }
  }

  clearFence(repositoryGroupId: string): void {
    this.#fencedRepositories.delete(repositoryGroupId);
    this.#drain();
  }

  isFenced(repositoryGroupId: string): boolean {
    return this.#fencedRepositories.has(repositoryGroupId);
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    const error = new RepositoryMutationAdmissionError("disposed");
    for (const pending of this.#queue.splice(0)) pending.reject(error);
  }

  #drain(): void {
    if (this.#disposed) return;
    while (this.#activeCount < this.#globalConcurrency) {
      const index = this.#queue.findIndex((pending) => (
        !this.#activeRepositories.has(pending.repositoryGroupId)
        && !this.#fencedRepositories.has(pending.repositoryGroupId)
      ));
      if (index === -1) return;
      const [pending] = this.#queue.splice(index, 1);
      if (!pending) return;
      this.#activeCount += 1;
      this.#activeRepositories.add(pending.repositoryGroupId);
      void pending.operation().then(pending.resolve, pending.reject).finally(() => {
        this.#activeCount -= 1;
        this.#activeRepositories.delete(pending.repositoryGroupId);
        this.#drain();
      });
    }
  }
}

function positiveInteger(value: number): number {
  if (!Number.isSafeInteger(value) || value < 1) throw new Error("Repository mutation scheduler limit is invalid.");
  return value;
}
