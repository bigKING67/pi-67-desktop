import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { createReadStream } from "node:fs";
import { lstat } from "node:fs/promises";

export async function readWindowsArtifactIdentity(executablePath) {
  return {
    ...await readFileByteIdentity(executablePath),
    authenticode: await readAuthenticodeIdentity(executablePath)
  };
}

export async function readFileByteIdentity(path) {
  const metadata = await lstat(path);
  if (!metadata.isFile() || metadata.isSymbolicLink()) {
    throw new Error("Certification artifact is not a regular file.");
  }
  return {
    byteLength: metadata.size,
    sha256: await hashFile(path)
  };
}

export function normalizeWindowsSignerThumbprint(value) {
  if (typeof value !== "string" || !/^[0-9A-Fa-f]{40}$/u.test(value)) {
    throw new Error("Expected Windows signer thumbprint must contain 40 hexadecimal characters.");
  }
  return value.toUpperCase();
}

export function assertWindowsArtifactSigner(identity, expectedSignerThumbprint, label = "Windows artifact") {
  const expectedSigner = normalizeWindowsSignerThumbprint(expectedSignerThumbprint);
  if (identity?.authenticode?.status !== "Valid"
    || identity.authenticode.signerThumbprint !== expectedSigner) {
    throw new Error(`${label} was signed by an unexpected Windows Publisher.`);
  }
  return identity;
}

export function assertSameArtifactBytes(actual, expected, label = "Windows artifact") {
  if (actual?.byteLength !== expected?.byteLength || actual?.sha256 !== expected?.sha256) {
    throw new Error(`${label} bytes do not match the packaged release candidate.`);
  }
}

async function readAuthenticodeIdentity(executablePath) {
  const command = [
    "$signature = Get-AuthenticodeSignature -LiteralPath $env:PI67_CERT_EXECUTABLE;",
    "$certificate = $signature.SignerCertificate;",
    "[pscustomobject]@{",
    "status = $signature.Status.ToString();",
    "signerThumbprint = $(if ($certificate) { $certificate.Thumbprint } else { $null });",
    "signerSubject = $(if ($certificate) { $certificate.Subject } else { $null })",
    "} | ConvertTo-Json -Compress"
  ].join(" ");
  return new Promise((resolvePromise, reject) => {
    execFile("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", command], {
      encoding: "utf8",
      env: { ...process.env, PI67_CERT_EXECUTABLE: executablePath },
      maxBuffer: 64 * 1024,
      timeout: 15_000,
      windowsHide: true
    }, (error, stdout) => {
      if (error) {
        reject(new Error("Authenticode inspection failed."));
        return;
      }
      let identity;
      try {
        identity = JSON.parse(stdout);
      } catch {
        reject(new Error("Authenticode inspection returned invalid JSON."));
        return;
      }
      if (identity.status !== "Valid") {
        reject(new Error(`Windows certification requires a valid Authenticode signature, got ${identity.status}.`));
        return;
      }
      try {
        identity.signerThumbprint = normalizeWindowsSignerThumbprint(identity.signerThumbprint);
      } catch {
        reject(new Error("Windows certification requires an identifiable Authenticode signer."));
        return;
      }
      identity.signerSubject = typeof identity.signerSubject === "string"
        ? identity.signerSubject.slice(0, 1_024)
        : null;
      resolvePromise(identity);
    });
  });
}

function hashFile(path) {
  return new Promise((resolvePromise, reject) => {
    const hash = createHash("sha256");
    const stream = createReadStream(path);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.once("error", reject);
    stream.once("end", () => resolvePromise(hash.digest("hex")));
  });
}
