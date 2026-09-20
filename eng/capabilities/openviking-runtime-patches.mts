/// <reference types="node" />
import { createHash } from "node:crypto";
import { lstat, readFile, readdir, realpath, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

// Exact OpenViking 0.4.16 source transformations. Preserve upstream headers and
// dependencies; only defer unused LiteLLM imports. Update the revision on change.
const edits: { path: string; sha256: string; replacements: [string, string][]; suffix: string }[] = [
  {
    path: "openviking/models/vlm/__init__.py",
    sha256: "f82884972e28729205d989b1bb8a266741f311ef4dcb5e86025e2714f4a6405a",
    replacements: [["from .backends.litellm_vlm import LiteLLMVLMProvider\n", ""]],
    suffix: '\n\ndef __getattr__(name):\n    if name == "LiteLLMVLMProvider":\n        from .backends.litellm_vlm import LiteLLMVLMProvider\n\n        return LiteLLMVLMProvider\n    raise AttributeError(name)\n'
  },
  {
    path: "openviking/models/embedder/__init__.py",
    sha256: "cd1c8d47ee19ed36e0caed66269d1a14ce7946ee2dec86450959b1575f85a1ee",
    replacements: [["try:\n    from openviking.models.embedder.litellm_embedders import LiteLLMDenseEmbedder\nexcept ImportError:\n    LiteLLMDenseEmbedder = None  # litellm not installed\n", ""]],
    suffix: '\n\ndef __getattr__(name):\n    if name == "LiteLLMDenseEmbedder":\n        try:\n            from .litellm_embedders import LiteLLMDenseEmbedder\n        except ImportError:\n            return None\n        return LiteLLMDenseEmbedder\n    raise AttributeError(name)\n'
  },
  {
    path: "openviking_cli/utils/config/embedding_config.py",
    sha256: "f1c4dda944539e8d80cde9f99ad8a05e3b34abf8abc3537b6754a0c38695bc9b",
    replacements: [["            JinaDenseEmbedder,\n            LiteLLMDenseEmbedder,\n            LocalDenseEmbedder,", "            JinaDenseEmbedder,\n            LocalDenseEmbedder,"],
      ['        if provider == "litellm" and LiteLLMDenseEmbedder is None:\n', '        LiteLLMDenseEmbedder = None\n        if provider == "litellm":\n            from openviking.models.embedder import LiteLLMDenseEmbedder\n\n        if provider == "litellm" and LiteLLMDenseEmbedder is None:\n']],
    suffix: ""
  }
];

const digest = (value: string) => createHash("sha256").update(value).digest("hex");
const wheelIdentity = (value: string) => ({ hash: createHash("sha256").update(value).digest("base64url"), bytes: Buffer.byteLength(value) });

async function planWheelRecords(packages: string, changes: Map<string, { before: ReturnType<typeof wheelIdentity>; after: ReturnType<typeof wheelIdentity> }>) {
  const owners = new Map([...changes.keys()].map(path => [path, 0]));
  const records: { path: string; content: string }[] = [];
  for (const entry of await readdir(packages, { withFileTypes: true })) {
    if (!entry.name.endsWith(".dist-info")) continue;
    const path = join(packages, entry.name, "RECORD");
    if (!entry.isDirectory() || await realpath(path) !== path) throw new Error("Unexpected wheel RECORD link.");
    const source = await readFile(path, "utf8");
    let changed = false;
    const content = source.split("\n").map(line => {
      const match = /^([^,"\r]+),sha256=([A-Za-z0-9_-]+),(\d+)(\r?)$/u.exec(line);
      const change = match && changes.get(match[1]!);
      if (!change) return line;
      if (change.before.hash !== match[2] || change.before.bytes !== Number(match[3])) throw new Error("Wheel RECORD does not match source bytes.");
      owners.set(match[1]!, owners.get(match[1]!)! + 1); changed = true;
      return `${match[1]},sha256=${change.after.hash},${change.after.bytes}${match[4]}`;
    }).join("\n");
    if (changed) records.push({ path, content });
  }
  if ([...owners.values()].some(count => count !== 1)) throw new Error("Changed file must have exactly one wheel RECORD owner.");
  return records;
}

export function relocatePythonLauncher(source: string, python: string): string {
  const shell = `#!/bin/sh\n'''exec' '${python}' "$0" "$@"\n' '''\n`;
  const direct = `#!${python}\n`;
  const prefix = source.startsWith(shell) ? shell : source.startsWith(direct) ? direct : undefined;
  if (!prefix) throw new Error("Unrecognized generated Python launcher.");
  return '#!/bin/sh\n\'\'\'exec\' "$(dirname -- "$0")/../../../../bin/python3.12" "$0" "$@"\n\' \'\'\'\n' + source.slice(prefix.length);
}

/** uv --target generates absolute shebangs. Preserve command behavior and wheel
 * RECORD integrity, but remove the staging-path input before relocation/signing. */
export async function normalizePrivateRuntimeLaunchers(stagingRoot: string) {
  const root = await realpath(stagingRoot);
  if (root !== resolve(stagingRoot)) throw new Error("Launcher staging root must be canonical.");
  const packages = join(root, "lib/python3.12/site-packages");
  const bin = join(packages, "bin");
  if (await realpath(bin) !== bin) throw new Error("Unexpected launcher directory link.");
  const launchers = new Map<string, { path: string; content: string; before: ReturnType<typeof wheelIdentity>; after: ReturnType<typeof wheelIdentity> }>();
  for (const entry of await readdir(bin, { withFileTypes: true })) {
    if (!entry.isFile() || !/^[A-Za-z0-9_.-]+$/u.test(entry.name)) throw new Error("Unexpected generated launcher entry.");
    const path = join(bin, entry.name);
    if (await realpath(path) !== path) throw new Error("Unexpected launcher link.");
    const source = await readFile(path, "utf8");
    if (!source.includes(root)) continue;
    const content = relocatePythonLauncher(source, join(root, "bin/python3.12"));
    if (content.includes(root)) throw new Error("Launcher still contains staging identity.");
    launchers.set(`bin/${entry.name}`, { path, content, before: wheelIdentity(source), after: wheelIdentity(content) });
  }
  if (!launchers.size) throw new Error("Expected generated Python launchers before normalization.");
  const records = await planWheelRecords(packages, launchers);
  for (const file of [...launchers.values(), ...records]) await writeFile(file.path, file.content);
  return { revision: "relative-python-launchers-v1", count: launchers.size };
}

export function patchPrivateRuntimeSource(path: string, source: string): string {
  const edit = edits.find(item => item.path === path);
  if (!edit || digest(source) !== edit.sha256) throw new Error("Private runtime patch requires the exact pinned upstream source.");
  for (const [before, after] of edit.replacements) {
    if (source.split(before).length !== 2) throw new Error("Ambiguous private runtime patch.");
    source = source.replace(before, after);
  }
  return source + edit.suffix;
}

/** Caller owns a fresh staging tree, not an installed/user runtime. Validate all
 * inputs before writing. Any write failure leaves an unpublished failed staging
 * tree; never retry in place or silently accept already-patched sources. */
export async function applyPrivateRuntimePatch(stagingRoot: string) {
  const root = await realpath(stagingRoot);
  if (root !== resolve(stagingRoot)) throw new Error("Private patch staging root must be canonical.");
  const marker = join(root, "newmoney-runtime-patches.json");
  await lstat(marker).then(() => { throw new Error("Private runtime patch receipt already exists."); }, error => {
    if (error.code !== "ENOENT") throw error;
  });
  const pending = await Promise.all(edits.map(async edit => {
    const path = join(root, "lib/python3.12/site-packages", edit.path);
    if (await realpath(path) !== path) throw new Error("Unexpected private patch source link.");
    const source = await readFile(path, "utf8");
    const content = patchPrivateRuntimeSource(edit.path, source);
    return { path, content, before: wheelIdentity(source), after: wheelIdentity(content),
      record: { path: edit.path, beforeSha256: edit.sha256, afterSha256: digest(content) } };
  }));
  const records = await planWheelRecords(join(root, "lib/python3.12/site-packages"), new Map(pending.map(file => [file.record.path, file])));
  const receipt = { schema: "new-money.openviking-patches.v1", revision: "lazy-litellm-v1",
    upstreamVersion: "0.4.16", recipeSha256: digest(JSON.stringify(edits)), files: pending.map(file => file.record) };
  for (const file of [...pending, ...records]) await writeFile(file.path, file.content);
  await writeFile(marker, `${JSON.stringify(receipt, null, 2)}\n`, { flag: "wx", mode: 0o600 });
  return receipt;
}
