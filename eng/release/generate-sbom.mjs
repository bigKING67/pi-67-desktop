import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

import { loadVersionContract } from "../version/version-contract.mjs";

const outputArgument = process.argv.indexOf("--output");
const output = path.resolve(outputArgument >= 0
  ? process.argv[outputArgument + 1]
  : "artifacts/release/pi67-desktop.cdx.json");
const version = await loadVersionContract();
const lockFiles = [
  "package-lock.json",
  ...[
    "src/Pi67.Desktop.App",
    "src/Pi67.Desktop.Application",
    "src/Pi67.Desktop.Domain",
    "src/Pi67.Desktop.Infrastructure.Windows",
    "src/Pi67.Desktop.PiRpc",
    "src/Pi67.Desktop.Presentation",
    "tests/Pi67.Desktop.App.StaticTests",
    "tests/Pi67.Desktop.Application.Tests",
    "tests/Pi67.Desktop.Architecture.Tests",
    "tests/Pi67.Desktop.Domain.Tests",
    "tests/Pi67.Desktop.Infrastructure.Windows.Tests",
    "tests/Pi67.Desktop.IntegrationTests",
    "tests/Pi67.Desktop.PiRpc.Tests",
    "tests/Pi67.Desktop.Presentation.Tests",
    "tests/Pi67.Desktop.UiTests",
    "installer/Pi67.Desktop.Bundle",
    "installer/Pi67.Desktop.Msi",
    "installer/Pi67.Desktop.RuntimeBootstrap",
  ].map((directory) => `${directory}/packages.lock.json`),
];
const components = new Map();
const evidence = [];

for (const lockFile of lockFiles) {
  const raw = await readFile(lockFile);
  const digest = createHash("sha256").update(raw).digest("hex");
  evidence.push({ path: lockFile, sha256: digest });
  const lock = JSON.parse(raw);
  if (lockFile === "package-lock.json") {
    for (const [packagePath, metadata] of Object.entries(lock.packages ?? {})) {
      if (!packagePath || !metadata.version) continue;
      const name = metadata.name ?? packagePath.replace(/^.*node_modules\//, "");
      components.set(`npm:${name}@${metadata.version}`, {
        type: "library",
        name,
        version: metadata.version,
        purl: `pkg:npm/${encodeURIComponent(name)}@${metadata.version}`,
      });
    }
    continue;
  }
  for (const target of Object.values(lock.dependencies ?? {})) {
    for (const [name, metadata] of Object.entries(target)) {
      if (!metadata.resolved) continue;
      components.set(`nuget:${name}@${metadata.resolved}`, {
        type: "library",
        name,
        version: metadata.resolved,
        purl: `pkg:nuget/${encodeURIComponent(name)}@${metadata.resolved}`,
      });
    }
  }
}

const bootstrapInventoryPath = "eng/packaging/bootstrap-inventory.json";
const bootstrapInventoryRaw = await readFile(bootstrapInventoryPath);
evidence.push({
  path: bootstrapInventoryPath,
  sha256: createHash("sha256").update(bootstrapInventoryRaw).digest("hex"),
});
const bootstrapInventory = JSON.parse(bootstrapInventoryRaw);
const dotnetRuntime = bootstrapInventory.installerPrerequisites.dotnetDesktopRuntime;
components.set(`generic:dotnet-desktop-runtime@${dotnetRuntime.version}`, {
  type: "framework",
  name: ".NET Desktop Runtime",
  version: dotnetRuntime.version,
  purl: `pkg:generic/dotnet-desktop-runtime@${dotnetRuntime.version}?arch=x86_64&os=windows`,
  hashes: [{ alg: "SHA-512", content: dotnetRuntime.sha512 }],
  externalReferences: [{ type: "distribution", url: dotnetRuntime.url }],
});
const windowsAppRuntime = bootstrapInventory.installerPrerequisites.windowsAppRuntime;
components.set(`nuget:Microsoft.WindowsAppSDK.Runtime@${windowsAppRuntime.version}`, {
  type: "framework",
  name: "Microsoft.WindowsAppSDK.Runtime",
  version: windowsAppRuntime.version,
  purl: `pkg:nuget/Microsoft.WindowsAppSDK.Runtime@${windowsAppRuntime.version}?arch=x86_64`,
  properties: [{ name: "pi67:source", value: windowsAppRuntime.source }],
});

const bom = {
  bomFormat: "CycloneDX",
  specVersion: "1.6",
  serialNumber: `urn:uuid:${randomUUID()}`,
  version: 1,
  metadata: {
    timestamp: new Date().toISOString(),
    component: { type: "application", name: "Pi-67 Desktop", version: version.semver },
    properties: evidence.flatMap((item) => [
      { name: `pi67:lock:${item.path}`, value: item.sha256 },
    ]),
  },
  components: [...components.values()].sort((left, right) => left.purl.localeCompare(right.purl)),
};
await mkdir(path.dirname(output), { recursive: true });
await writeFile(output, `${JSON.stringify(bom, null, 2)}\n`);
process.stdout.write(`${output}\n`);
