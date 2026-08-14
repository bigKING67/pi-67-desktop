import { gitSourceCandidates, type PackageNetworkSettings } from "@pi67/domain";

export class GitPackageSourcesUnavailableError extends Error {
  readonly attempts: number;

  constructor(attempts: number) {
    super("No reachable Git package source is available.");
    this.name = "GitPackageSourcesUnavailableError";
    this.attempts = attempts;
  }
}

export interface ConfiguredGitPackage {
  source: string;
  installedPath?: string;
}

export async function checkGitPackageUpdatesWithFallback<T>(options: {
  settings: PackageNetworkSettings;
  packages: readonly ConfiguredGitPackage[];
  configureRewrite: (insteadOfPrefix: string | undefined) => void;
  probe: (installedPath: string) => Promise<void>;
  check: () => Promise<T>;
}): Promise<T> {
  await selectGitSourceWithFallback(options);
  return options.check();
}

export async function selectGitSourceWithFallback(options: {
  settings: PackageNetworkSettings;
  packages: readonly ConfiguredGitPackage[];
  configureRewrite: (insteadOfPrefix: string | undefined) => void;
  probe: (installedPath: string) => Promise<void>;
}): Promise<{ attempts: number }> {
  const installed = options.packages.filter((entry): entry is ConfiguredGitPackage & { installedPath: string } => (
    entry.installedPath !== undefined && !isPinnedGitPackageSource(entry.source)
  ));
  if (installed.length === 0) {
    options.configureRewrite(undefined);
    return { attempts: 0 };
  }
  const candidates = gitSourceCandidates(options.settings);
  if (candidates.length === 0) throw new GitPackageSourcesUnavailableError(0);
  let attempts = 0;
  for (const candidate of candidates) {
    attempts += 1;
    options.configureRewrite(candidate.insteadOfPrefix);
    try {
      for (const entry of installed) await options.probe(entry.installedPath);
      return { attempts };
    } catch {
      // Only the bounded Git transport probe participates in source fallback.
    }
  }
  throw new GitPackageSourcesUnavailableError(attempts);
}

export function isPinnedGitPackageSource(source: string): boolean {
  const trimmed = source.trim();
  const value = trimmed.startsWith("git:") ? trimmed.slice(4).trim() : trimmed;
  if (value.includes("#")) return true;
  if (value.startsWith("git@")) {
    const repositorySeparator = value.indexOf(":");
    return repositorySeparator >= 0 && value.lastIndexOf("@") > repositorySeparator;
  }
  try {
    const parsed = new URL(value);
    return parsed.pathname.lastIndexOf("@") > parsed.pathname.lastIndexOf("/");
  } catch {
    return value.lastIndexOf("@") > value.lastIndexOf("/");
  }
}
