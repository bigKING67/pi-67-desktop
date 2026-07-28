import { RuntimeError } from "@pi67/domain";

export interface RuntimeCredentialOverrideMetadata {
  revision: number;
  providers: string[];
}

export type RuntimeCredentialOverrideTarget = (
  provider: string,
  apiKey: string
) => Promise<void>;

/** Host-owned, memory-only credential overrides shared by active Pi runtimes. */
export interface RuntimeCredentialOverrideStore {
  set(provider: string, apiKey: string): Promise<RuntimeCredentialOverrideMetadata>;
  applyTo(target: RuntimeCredentialOverrideTarget): Promise<void>;
  subscribe(target: RuntimeCredentialOverrideTarget): () => void;
  snapshot(): RuntimeCredentialOverrideMetadata;
  clear(): Promise<void>;
}

export function createRuntimeCredentialOverrideStore(): RuntimeCredentialOverrideStore {
  const values = new Map<string, string>();
  const targets = new Set<RuntimeCredentialOverrideTarget>();
  let revision = 0;
  let mutation = Promise.resolve();

  const snapshot = (): RuntimeCredentialOverrideMetadata => ({
    revision,
    providers: [...values.keys()].sort((left, right) => left.localeCompare(right))
  });

  return {
    set(provider, apiKey) {
      const normalized = normalizeRuntimeCredentialOverride(provider, apiKey);
      const operation = mutation.then(async () => {
        try {
          await Promise.all([...targets].map((target) => target(normalized.provider, normalized.apiKey)));
        } catch {
          throw credentialConfigurationError();
        }
        values.set(normalized.provider, normalized.apiKey);
        revision += 1;
        return snapshot();
      });
      mutation = operation.then(() => undefined, () => undefined);
      return operation;
    },
    async applyTo(target) {
      await mutation;
      try {
        for (const [provider, apiKey] of values) await target(provider, apiKey);
      } catch {
        throw credentialConfigurationError();
      }
    },
    subscribe(target) {
      targets.add(target);
      return () => { targets.delete(target); };
    },
    snapshot,
    clear() {
      const operation = mutation.then(() => {
        values.clear();
        revision += 1;
      });
      mutation = operation.then(() => undefined, () => undefined);
      return operation;
    }
  };
}

function normalizeRuntimeCredentialOverride(
  provider: string,
  apiKey: string
): { provider: string; apiKey: string } {
  const normalizedProvider = provider.trim();
  const normalizedKey = apiKey.trim();
  if (!normalizedProvider || normalizedKey.length < 8) {
    throw new RuntimeError("INVALID_PAYLOAD", "Provider and API key are required.");
  }
  return { provider: normalizedProvider, apiKey: normalizedKey };
}

function credentialConfigurationError(): RuntimeError {
  return new RuntimeError(
    "INVALID_PAYLOAD",
    "Unable to configure the runtime API key for this provider."
  );
}
