// This conservative input boundary belongs to desktop-ai-berkshire-v1.
// Compare whole trees so new members and file modes cannot evade freshness.
const INPUTS = [["codex-skills", "tree", "040000"], ["tools", "tree", "040000"], ["LICENSE", "blob", "100644"]];
const SHA = /^[0-9a-f]{40}$/u;

export function supportsInputEquivalence(pack) {
  return pack.adapter === "desktop-ai-berkshire-v1"
    && pack.name === "ai-berkshire-investment-suite"
    && /^https:\/\/github\.com\/xbtlin\/ai-berkshire(?:\.git)?$/u.test(pack.repository);
}

export async function resolveAiBerkshireInputEquivalence(pack, latestCommit, query = queryGitHub) {
  if (!supportsInputEquivalence(pack) || !SHA.test(pack.commit) || !SHA.test(latestCommit)) {
    throw new Error("Unsupported input equivalence source or commit");
  }
  const snapshots = await Promise.all([pack.commit, latestCommit].map(async (commit) => {
    const object = await query(`git/commits/${commit}`);
    if (object?.sha !== commit || !SHA.test(object.tree?.sha ?? "")) {
      throw new Error("Input proof commit identity is invalid");
    }
    const root = await query(`git/trees/${object.tree.sha}`);
    if (root?.sha !== object.tree.sha || root.truncated !== false || !Array.isArray(root.tree)) {
      throw new Error("Input proof root tree is invalid or incomplete");
    }
    return INPUTS.map(([path, type, mode]) => {
      const matches = root.tree.filter((entry) => entry.path === path);
      const entry = matches[0];
      if (matches.length !== 1 || entry.type !== type || entry.mode !== mode || !SHA.test(entry.sha ?? "")) {
        throw new Error(`Input proof requires a regular ${path} entry`);
      }
      return { path, type, mode, sha: entry.sha };
    });
  }));
  return {
    adapter: pack.adapter,
    lockedCommit: pack.commit,
    latestCommit,
    equivalent: JSON.stringify(snapshots[0]) === JSON.stringify(snapshots[1]),
    lockedInputs: snapshots[0],
    latestInputs: snapshots[1]
  };
}

async function queryGitHub(endpoint) {
  const response = await fetch(`https://api.github.com/repos/xbtlin/ai-berkshire/${endpoint}`, {
    headers: { Accept: "application/vnd.github+json" },
    signal: AbortSignal.timeout(30_000),
    redirect: "error"
  });
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error(`Input proof request failed: HTTP ${response.status}`);
  }
  const chunks = [];
  let bytes = 0;
  for await (const chunk of response.body) {
    bytes += chunk.length;
    if (bytes > 512 * 1024) throw new Error("Input proof exceeds bounded response limit");
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}
