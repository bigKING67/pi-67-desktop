import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveAiBerkshireInputEquivalence } from "./ai-berkshire-input-equivalence.mjs";

const locked = "1".repeat(40);
const latest = "2".repeat(40);
const pack = {
  adapter: "desktop-ai-berkshire-v1", name: "ai-berkshire-investment-suite",
  repository: "https://github.com/xbtlin/ai-berkshire", commit: locked
};
function queryFixture(change = () => {}) {
  return async (endpoint) => {
    const sha = endpoint.split("/").at(-1);
    if (endpoint.startsWith("git/commits/")) return { sha, tree: { sha } };
    const root = { sha, truncated: false, tree: [
      { path: "codex-skills", type: "tree", mode: "040000", sha: "3".repeat(40) },
      { path: "tools", type: "tree", mode: "040000", sha: "4".repeat(40) },
      { path: "LICENSE", type: "blob", mode: "100644", sha: "5".repeat(40) },
      { path: "reports", type: "tree", mode: "040000", sha }
    ] };
    if (sha === latest) change(root);
    return root;
  };
}
describe("AI Berkshire input equivalence", () => {
  afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
  it.each([undefined, "synthetic-github-token"])("uses optional workflow authentication without changing the proof (%s)", async (token) => {
    vi.stubEnv("GH_TOKEN", token);
    const query = queryFixture();
    const fetch = vi.fn(async (url) => new Response(JSON.stringify(
      await query(new URL(url).pathname.replace("/repos/xbtlin/ai-berkshire/", ""))
    )));
    vi.stubGlobal("fetch", fetch);
    await expect(resolveAiBerkshireInputEquivalence(pack, latest)).resolves.toMatchObject({ equivalent: true });
    expect(fetch).toHaveBeenCalledTimes(4);
    for (const [url, options] of fetch.mock.calls) {
      expect(url).toMatch(/^https:\/\/api.github.com\/repos\/xbtlin\/ai-berkshire\/git\/(commits|trees)\/[a-f0-9]{40}$/u);
      expect(options.redirect).toBe("error");
      expect(options.headers.Authorization).toBe(token ? `Bearer ${token}` : undefined);
    }
  });
  it("fails closed on an authenticated denial without copying response details", async () => {
    vi.stubEnv("GH_TOKEN", "synthetic-github-token");
    vi.stubGlobal("fetch", vi.fn(async () => new Response("synthetic-private-response", { status: 403 })));
    await expect(resolveAiBerkshireInputEquivalence(pack, latest)).rejects.toThrow("Input proof request failed: HTTP 403");
  });
  it("proves complete input roots while allowing unrelated reports to change", async () => {
    const proof = await resolveAiBerkshireInputEquivalence(pack, latest, queryFixture());
    expect(proof).toMatchObject({ equivalent: true, lockedCommit: locked, latestCommit: latest });
    expect(proof.lockedInputs).toEqual(proof.latestInputs);
    expect(proof.lockedInputs.map(({ path }) => path)).toEqual(["codex-skills", "tools", "LICENSE"]);
  });
  it.each([0, 1, 2])("rejects changed input object %i (including member additions/deletions)", async (index) => {
    const proof = await resolveAiBerkshireInputEquivalence(pack, latest, queryFixture((root) => {
      root.tree[index].sha = "6".repeat(40);
    }));
    expect(proof.equivalent).toBe(false);
  });
  it.each([
    (root) => { root.truncated = true; },
    (root) => { root.sha = locked; },
    (root) => { root.tree.shift(); },
    (root) => { root.tree.push(root.tree[0]); },
    (root) => { root.tree[2].mode = "100755"; },
    (root) => { root.tree[0].type = "blob"; },
    (root) => { root.tree[1].sha = "invalid"; }
  ])("fails closed on incomplete or unsupported input identity", async (change) => {
    await expect(resolveAiBerkshireInputEquivalence(pack, latest, queryFixture(change))).rejects.toThrow();
  });
  it("rejects a mismatched commit and propagates network failure", async () => {
    await expect(resolveAiBerkshireInputEquivalence(pack, latest, async () => ({ sha: "wrong" }))).rejects.toThrow(/commit identity/u);
    await expect(resolveAiBerkshireInputEquivalence(pack, latest, async () => { throw new Error("offline"); })).rejects.toThrow("offline");
  });
  it("does not grant equivalence to other repositories or adapters", async () => {
    for (const override of [{ repository: "https://github.com/example/ai-berkshire" }, { adapter: "v2" }]) {
      await expect(resolveAiBerkshireInputEquivalence({ ...pack, ...override }, latest, queryFixture())).rejects.toThrow(/Unsupported/u);
    }
  });
});
