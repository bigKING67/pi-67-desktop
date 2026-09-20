import { createHash, createPrivateKey, createPublicKey, generateKeyPairSync, randomBytes, sign, verify } from "node:crypto";
import { lstat, mkdir, open, readFile, realpath } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** Explicit operator action. Refuses every existing target, including partial attempts. */
export async function provisionOpenVikingSigningKey(target) {
  if (process.platform === "win32") throw new Error("This provisioning tool requires POSIX permission enforcement.");
  if (typeof target !== "string" || !isAbsolute(target) || target.includes("\0") || resolve(target) === "/") {
    throw new Error("Supply an absolute dedicated signing directory.");
  }
  const parent = await realpath(dirname(resolve(target)));
  const directory = join(parent, basename(resolve(target)));
  await mkdir(directory, { mode: 0o700 }); // No recursive/exist-ok mode: never replace a key.
  const metadata = await lstat(directory);
  if (!metadata.isDirectory() || metadata.isSymbolicLink() || (metadata.mode & 0o077) !== 0
    || metadata.uid !== process.getuid()) throw new Error("Signing directory is not owner-private.");
  const privatePath = join(directory, "openviking-ed25519-private.pem");
  const publicPath = join(directory, "openviking-ed25519-public.pem");
  const pair = generateKeyPairSync("ed25519");
  const publicPem = pair.publicKey.export({ type: "spki", format: "pem" });
  await writeExclusive(privatePath, pair.privateKey.export({ type: "pkcs8", format: "pem" }));
  await writeExclusive(publicPath, publicPem);
  const restoredPrivate = createPrivateKey(await readFile(privatePath));
  const restoredPublic = createPublicKey(await readFile(publicPath));
  const derived = createPublicKey(restoredPrivate).export({ type: "spki", format: "der" });
  const publicDer = restoredPublic.export({ type: "spki", format: "der" });
  const challenge = randomBytes(64);
  const signature = sign(null, challenge, restoredPrivate);
  if (!derived.equals(publicDer) || !verify(null, challenge, restoredPublic, signature)
    || verify(null, Buffer.concat([challenge, Buffer.from([0])]), restoredPublic, signature)) {
    throw new Error("Signing key readback self-test failed.");
  }
  const fingerprintSha256 = createHash("sha256").update(publicDer).digest("hex");
  const receipt = { schema: "new-money.openviking-signing-key.v1", algorithm: "Ed25519",
    fingerprintSha256, createdAt: new Date().toISOString(), directory,
    storage: "UNENCRYPTED_PKCS8_OWNER_ONLY", selfTest: "PASS", deployment: "NOT_PERFORMED" };
  await writeExclusive(join(directory, "key-metadata.json"), JSON.stringify(receipt, null, 2));
  return receipt; // Public identity only; never return/log private PEM or its hash.
}

async function writeExclusive(path, value) {
  const handle = await open(path, "wx", 0o600);
  try {
    await handle.writeFile(value); await handle.sync();
    const metadata = await handle.stat();
    if (!metadata.isFile() || (metadata.mode & 0o077) !== 0 || metadata.uid !== process.getuid()) {
      throw new Error("Signing material is not owner-private.");
    }
  } finally { await handle.close(); }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { console.log(JSON.stringify(await provisionOpenVikingSigningKey(process.argv[2]), null, 2)); }
  catch {
    console.error("Signing key provisioning failed. Existing/partial targets are preserved; no key material is logged.");
    process.exitCode = 1;
  }
}
