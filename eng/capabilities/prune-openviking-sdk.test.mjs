import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { pruneOpenVikingSdk } from "./prune-openviking-sdk.mjs";

const catalog = `volcenginesdkacep
volcenginesdkadvdefence
volcenginesdkadvdefence20230308
volcenginesdkaidap
volcenginesdkaiotvideo
volcenginesdkaiotvideo20231001
volcenginesdkalb
volcenginesdkapig
volcenginesdkapig20221112
volcenginesdkapmplusserver
volcenginesdkark
volcenginesdkarkclaw
volcenginesdkarkruntime
volcenginesdkautoscaling
volcenginesdkbilling
volcenginesdkbio
volcenginesdkbmq
volcenginesdkbmq20240901
volcenginesdkbytehousece20240831
volcenginesdkcbr
volcenginesdkcdn
volcenginesdkcen
volcenginesdkcertificateservice
volcenginesdkcfs
volcenginesdkclawsentry
volcenginesdkclb
volcenginesdkcloudcontrol
volcenginesdkclouddetect
volcenginesdkclouddetect20251031
volcenginesdkcloudidentity
volcenginesdkcloudmonitor
volcenginesdkcloudmonitor20251201
volcenginesdkcloudtrail
volcenginesdkcloudtrail20180101
volcenginesdkconfig
volcenginesdkcore
volcenginesdkcoze20250601
volcenginesdkcp
volcenginesdkcpaas
volcenginesdkcr
volcenginesdkcv20240606
volcenginesdkdataleap
volcenginesdkdataleap20260301
volcenginesdkdbw
volcenginesdkdirectconnect
volcenginesdkdms
volcenginesdkdms20250101
volcenginesdkdns
volcenginesdkdramart
volcenginesdkdts
volcenginesdkdts20180101
volcenginesdkecs
volcenginesdkedx
volcenginesdkefs
volcenginesdkemr
volcenginesdkescloud
volcenginesdkfasttrack
volcenginesdkfilenas
volcenginesdkflink20250101
volcenginesdkfwcenter
volcenginesdkga
volcenginesdkgraph
volcenginesdkgraph20250815
volcenginesdkgtm
volcenginesdkhbase
volcenginesdkhttpdns
volcenginesdki18nopenapi
volcenginesdkiam
volcenginesdkiam20210801
volcenginesdkid
volcenginesdkinsight
volcenginesdkkafka
volcenginesdkkms
volcenginesdklivesaas
volcenginesdklivesaas20230801
volcenginesdkllmscan
volcenginesdkllmshield
volcenginesdkmcdn
volcenginesdkmcs
volcenginesdkmem0
volcenginesdkmetakms
volcenginesdkmilvus
volcenginesdkmlplatform20240701
volcenginesdkmongodb
volcenginesdkna
volcenginesdknatgateway
volcenginesdknta
volcenginesdkorganization
volcenginesdkorigindefence
volcenginesdkpartner
volcenginesdkpca
volcenginesdkpca20251001
volcenginesdkprivatelink
volcenginesdkprivatezone
volcenginesdkquota
volcenginesdkrabbitmq
volcenginesdkrcs5g
volcenginesdkrdsmssql
volcenginesdkrdsmysql
volcenginesdkrdsmysqlv2
volcenginesdkrdspostgresql
volcenginesdkredis
volcenginesdkresourcecenter
volcenginesdkresourceshare
volcenginesdkrocketmq
volcenginesdksecagent
volcenginesdkseccenter
volcenginesdkseccenter20240508
volcenginesdksmc
volcenginesdkspark
volcenginesdkspeechsaasprod
volcenginesdkspeechsaasprod20250521
volcenginesdksqs
volcenginesdkstorageebs
volcenginesdksts
volcenginesdktag
volcenginesdktidb
volcenginesdktis
volcenginesdktransitrouter
volcenginesdktranslate20250301
volcenginesdkvedbm
volcenginesdkveenedge
volcenginesdkvefaas
volcenginesdkvefaasdev
volcenginesdkveiapi
volcenginesdkvepfs
volcenginesdkvikingdb
volcenginesdkvke
volcenginesdkvmp
volcenginesdkvms
volcenginesdkvod20250101
volcenginesdkvod20260101
volcenginesdkvolcobserve
volcenginesdkvolcsms
volcenginesdkvpc
volcenginesdkvpn
volcenginesdkwaf
volcenginesdkwafruntime
`;
const kept = ["volcenginesdkark", "volcenginesdkarkruntime", "volcenginesdkcore"];
const dist = "volcengine_python_sdk-5.0.48.dist-info";
const roots = [];
async function fixture() {
  const root = await realpath(await mkdtemp(join(tmpdir(), "sdk-prune-"))); roots.push(root);
  const output = join(root, "preparation-fixture"); const staging = join(output, "staging");
  const site = join(staging, "lib/python3.12/site-packages");
  await mkdir(join(site, dist), { recursive: true });
  await writeFile(join(output, "native-artifact.json"), JSON.stringify({ schema: "new-money.native-artifact.v1", kind: "preparation", status: "BUILDING" }));
  const files = { [`${dist}/top_level.txt`]: catalog, [`${dist}/METADATA`]: "Name: volcengine-python-sdk\nVersion: 5.0.48\n",
    [`${dist}/LICENSE`]: "fixture-license" };
  for (const name of catalog.trim().split("\n")) {
    await mkdir(join(site, name)); files[`${name}/__init__.py`] = `# ${name}\n`;
  }
  for (const [name, value] of Object.entries(files)) await writeFile(join(site, name), value);
  const record = Object.entries(files).map(([name, value]) => `${name},sha256=${createHash("sha256").update(value).digest("base64url")},${Buffer.byteLength(value)}`);
  await writeFile(join(site, dist, "RECORD"), `${record.join("\n")}\n${dist}/RECORD,,\n`);
  await writeFile(join(site, "unrelated.txt"), "preserve");
  return { output, staging, site };
}
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
describe("locked OpenViking SDK staging footprint", () => {
  it("retains the Ark dependency closure and updates RECORD without touching licenses or other packages", async () => {
    const { staging, site } = await fixture();
    const result = await pruneOpenVikingSdk(staging);
    expect(result).toMatchObject({ revision: "volcengine-ark-only-v1", removedModules: 135, removedFiles: 135, retained: kept });
    expect(result.removedBytes).toBeGreaterThan(0);
    expect((await readdir(site)).filter(name => name.startsWith("volcenginesdk"))).toEqual(kept);
    expect(await readFile(join(site, "unrelated.txt"), "utf8")).toBe("preserve");
    expect(await readFile(join(site, dist, "LICENSE"), "utf8")).toBe("fixture-license");
    expect(await readFile(join(site, dist, "top_level.txt"), "utf8")).toBe(`${kept.join("\n")}\n`);
    const record = await readFile(join(site, dist, "RECORD"), "utf8");
    expect(record).not.toContain("volcenginesdkecs/");
    for (const line of record.trim().split("\n")) {
      const [name, digest, size] = line.split(","); if (!digest) continue;
      const bytes = await readFile(join(site, name));
      expect(digest).toBe(`sha256=${createHash("sha256").update(bytes).digest("base64url")}`);
      expect(Number(size)).toBe(bytes.length);
    }
    await expect(pruneOpenVikingSdk(staging)).rejects.toThrow("catalog");
  });
  it.each(["version", "catalog", "payload", "missing-kept", "symlink", "record", "owner", "metadata-link"])("rejects %s before deleting any SDK module", async kind => {
    const { output, staging, site } = await fixture();
    if (kind === "version") await writeFile(join(site, dist, "METADATA"), "Name: volcengine-python-sdk\nVersion: 99\n");
    if (kind === "catalog") await writeFile(join(site, dist, "top_level.txt"), "volcenginesdkecs\n");
    if (kind === "payload") await writeFile(join(site, "volcenginesdkecs/__init__.py"), "modified");
    if (kind === "missing-kept") await rm(join(site, "volcenginesdkark"), { recursive: true });
    if (kind === "symlink") await symlink(join(site, "unrelated.txt"), join(site, "volcenginesdkecs/escape"));
    if (kind === "record") await writeFile(join(site, dist, "RECORD"), "../unrelated.txt,,\n");
    if (kind === "owner") await writeFile(join(output, "native-artifact.json"), '{"status":"READY"}');
    if (kind === "metadata-link") {
      const source = join(site, dist, "top_level.txt"); await rm(source); await writeFile(join(output, "catalog"), catalog); await symlink(join(output, "catalog"), source);
    }
    await expect(pruneOpenVikingSdk(staging)).rejects.toThrow();
    expect(await readFile(join(site, "volcenginesdkbilling/__init__.py"), "utf8")).toContain("volcenginesdkbilling");
  });
  it("refuses direct signed or installed runtime paths", async () => {
    const { staging } = await fixture();
    await expect(pruneOpenVikingSdk(join(staging, ".."))).rejects.toThrow("staging");
  });
});
