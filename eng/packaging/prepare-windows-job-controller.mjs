import { spawn } from "node:child_process";
import { access, mkdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = fileURLToPath(new URL("../../", import.meta.url));
const sourcePath = join(repositoryRoot, "apps/agent-host/native/windows-package-worker-job.cpp");
export const windowsJobControllerOutputPath = join(
  repositoryRoot,
  "artifacts/native/windows-x64/pi67-package-worker-job.exe"
);
const windowsJobControllerObjectPath = join(
  repositoryRoot,
  "artifacts/native/windows-x64/pi67-package-worker-job.obj"
);

export async function prepareWindowsJobController(
  platform = process.platform,
  architecture = process.arch,
  environment = process.env,
  run = runProcess
) {
  if (platform !== "win32") return { status: "not-required" };
  if (architecture !== "x64") {
    throw new Error(`Windows Package Worker Job controller does not support ${platform}/${architecture}.`);
  }

  const systemRoot = environment.SystemRoot ?? environment.WINDIR;
  const programFilesX86 = environment["ProgramFiles(x86)"] ?? environment.ProgramFiles;
  if (!systemRoot || !programFilesX86) {
    throw new Error("Windows native build environment is unavailable.");
  }
  const vswhere = join(programFilesX86, "Microsoft Visual Studio", "Installer", "vswhere.exe");
  await access(vswhere);
  const installation = (await run(vswhere, [
    "-latest",
    "-products",
    "*",
    "-requires",
    "Microsoft.VisualStudio.Component.VC.Tools.x86.x64",
    "-property",
    "installationPath"
  ], { cwd: repositoryRoot, env: environment })).stdout.trim();
  if (!installation) throw new Error("A Visual Studio C++ x64 toolchain is required for Windows packaging.");

  const developerCommand = join(installation, "Common7", "Tools", "VsDevCmd.bat");
  await access(developerCommand);
  await mkdir(dirname(windowsJobControllerOutputPath), { recursive: true });
  const command = windowsJobControllerCompilerCommand(
    developerCommand,
    sourcePath,
    windowsJobControllerOutputPath,
    windowsJobControllerObjectPath
  );
  const commandInterpreter = join(systemRoot, "System32", "cmd.exe");
  const invocation = windowsJobControllerCompilerInvocation(commandInterpreter, command);
  await run(invocation.command, invocation.arguments, {
    cwd: repositoryRoot,
    env: environment,
    inheritOutput: true,
    windowsVerbatimArguments: invocation.windowsVerbatimArguments
  });
  await access(windowsJobControllerOutputPath);
  const { verifyWindowsJobController } = await import("./verify-windows-job-controller.mjs");
  await verifyWindowsJobController(platform, architecture, windowsJobControllerOutputPath);
  console.log(`Prepared and verified Windows Package Worker Job controller at ${windowsJobControllerOutputPath}.`);
  return { status: "prepared", path: windowsJobControllerOutputPath };
}

export async function assertPreparedWindowsJobController(
  platform = process.platform,
  architecture = process.arch
) {
  if (platform !== "win32") return { status: "not-required" };
  if (architecture !== "x64") {
    throw new Error(`Windows Package Worker Job controller does not support ${platform}/${architecture}.`);
  }
  await access(windowsJobControllerOutputPath);
  const { verifyWindowsJobController } = await import("./verify-windows-job-controller.mjs");
  await verifyWindowsJobController(platform, architecture, windowsJobControllerOutputPath);
  return { status: "verified", path: windowsJobControllerOutputPath };
}

export function windowsJobControllerCompilerCommand(
  developerCommand,
  source,
  output,
  objectOutput
) {
  return [
    "call",
    quoteWindowsCommandValue(developerCommand),
    "-arch=x64",
    "-host_arch=x64",
    "&&",
    "cl.exe",
    "/nologo",
    "/std:c++20",
    "/EHsc",
    "/W4",
    "/WX",
    "/O2",
    "/DUNICODE",
    "/D_UNICODE",
    quoteWindowsCommandValue(source),
    `/Fo:${quoteWindowsCommandValue(objectOutput)}`,
    `/Fe:${quoteWindowsCommandValue(output)}`,
    "/link",
    "/INCREMENTAL:NO",
    "/OPT:REF",
    "/OPT:ICF"
  ].join(" ");
}

export function quoteWindowsCommandValue(value) {
  if (
    typeof value !== "string"
    || value.length === 0
    || value.includes("\r")
    || value.includes("\n")
    || value.includes("\u0000")
    || value.includes("%")
    || value.includes('"')
  ) {
    throw new Error("Windows native build path is invalid.");
  }
  return `"${value}"`;
}

export function windowsJobControllerCompilerInvocation(commandInterpreter, command) {
  return {
    command: commandInterpreter,
    arguments: ["/d", "/s", "/c", command],
    // cmd.exe parses everything after /c itself. Node must not escape the embedded path quotes.
    windowsVerbatimArguments: true
  };
}

function runProcess(command, arguments_, options) {
  return new Promise((resolvePromise, reject) => {
    let stdout = "";
    let stderr = "";
    const child = spawn(command, arguments_, {
      cwd: options.cwd,
      env: options.env,
      stdio: options.inheritOutput ? "inherit" : ["ignore", "pipe", "pipe"],
      windowsVerbatimArguments: options.windowsVerbatimArguments === true,
      windowsHide: true
    });
    if (!options.inheritOutput) {
      child.stdout.on("data", (chunk) => { stdout += chunk.toString("utf8"); });
      child.stderr.on("data", (chunk) => { stderr += chunk.toString("utf8"); });
    }
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (signal || code !== 0) {
        reject(new Error(
          `Windows native build command failed (${signal ?? code}): ${stderr.trim() || "no diagnostic output"}`
        ));
      } else {
        resolvePromise({ stdout, stderr });
      }
    });
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await prepareWindowsJobController();
}
