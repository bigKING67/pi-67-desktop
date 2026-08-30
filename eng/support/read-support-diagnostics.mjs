import { createHash } from "node:crypto";
import { lstat, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import {
  SUPPORT_DIAGNOSTICS_DOCUMENT_SCHEMA_V5,
  SUPPORT_DIAGNOSTICS_MAX_SUBMISSION_BYTES,
  isReportId,
  isSupportDiagnosticsSubmission
} from "@pi67/support-contract";

const SUPPORT_BUCKET = "pi67-support-diagnostics";
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/u;
const OBJECT_KEY_PATTERN = /^diagnostics\/(\d{4})\/(\d{2})\/(\d{2})\/(PI67-[A-F0-9]{12})\.json$/u;
const DEFAULT_CREDENTIAL_PATH = join(homedir(), ".config", "pi67", "support-r2-read.env");
const CREDENTIAL_KEYS = new Set([
  "PI67_SUPPORT_R2_ACCOUNT_ID",
  "PI67_SUPPORT_R2_ACCESS_KEY_ID",
  "PI67_SUPPORT_R2_SECRET_ACCESS_KEY"
]);

export function supportDiagnosticsObjectKey(reportId, date) {
  if (!isReportId(reportId)) throw new Error("Invalid Pi-67 support report ID.");
  if (!DATE_PATTERN.test(date) || Number.isNaN(Date.parse(`${date}T00:00:00.000Z`))) {
    throw new Error("Support report date must be a valid UTC YYYY-MM-DD date.");
  }
  return `diagnostics/${date.replaceAll("-", "/")}/${reportId}.json`;
}

export function parseSupportDiagnosticsObjectKey(objectKey) {
  const match = OBJECT_KEY_PATTERN.exec(objectKey);
  if (!match) throw new Error("Invalid Pi-67 support diagnostics object key.");
  const [, year, month, day, reportId] = match;
  const date = `${year}-${month}-${day}`;
  if (Number.isNaN(Date.parse(`${date}T00:00:00.000Z`))) {
    throw new Error("Support diagnostics object key contains an invalid UTC date.");
  }
  return { objectKey, reportId, date };
}

export async function loadSupportR2Credentials(path = DEFAULT_CREDENTIAL_PATH) {
  const metadata = await lstat(path);
  if (!metadata.isFile() || metadata.isSymbolicLink()) {
    throw new Error("Support R2 credential source must be a regular, non-symlink file.");
  }
  if (metadata.size > 4_096) throw new Error("Support R2 credential file is unexpectedly large.");
  if (process.platform !== "win32" && (metadata.mode & 0o077) !== 0) {
    throw new Error("Support R2 credential file permissions must be 0600.");
  }
  if (typeof process.getuid === "function" && metadata.uid !== process.getuid()) {
    throw new Error("Support R2 credential file must be owned by the current user.");
  }
  const values = parseCredentialFile(await readFile(path, "utf8"));
  return {
    accountId: requireCredential(values, "PI67_SUPPORT_R2_ACCOUNT_ID"),
    accessKeyId: requireCredential(values, "PI67_SUPPORT_R2_ACCESS_KEY_ID"),
    secretAccessKey: requireCredential(values, "PI67_SUPPORT_R2_SECRET_ACCESS_KEY")
  };
}

export async function readSupportDiagnostics(options) {
  const locator = options.objectKey === undefined
    ? {
        objectKey: supportDiagnosticsObjectKey(options.reportId, options.date),
        reportId: options.reportId,
        date: options.date
      }
    : parseSupportDiagnosticsObjectKey(options.objectKey);
  const client = options.client ?? createSupportR2Client(await loadSupportR2Credentials(options.credentialsPath));
  const response = await client.send(new GetObjectCommand({ Bucket: SUPPORT_BUCKET, Key: locator.objectKey }));
  if (Number(response.ContentLength) > SUPPORT_DIAGNOSTICS_MAX_SUBMISSION_BYTES) {
    throw new Error("Stored support report exceeds the 64 KiB boundary.");
  }
  const bytes = await readBoundedBody(response.Body, SUPPORT_DIAGNOSTICS_MAX_SUBMISSION_BYTES);
  const submission = parseSubmission(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  if (submission.reportId !== locator.reportId) throw new Error("Stored report ID does not match the exact object key.");
  const createdDate = new Date(submission.createdAt).toISOString().slice(0, 10);
  if (createdDate !== locator.date) throw new Error("Stored report date does not match the exact object key.");
  const serializedDiagnostics = `${JSON.stringify(submission.diagnostics, null, 2)}\n`;
  const sha256 = createHash("sha256").update(serializedDiagnostics).digest("hex");
  if (sha256 !== submission.diagnosticsSha256) throw new Error("Stored diagnostic checksum does not match its submission.");
  return {
    locator,
    sizeBytes: bytes.byteLength,
    diagnosticsSha256: sha256,
    analysis: analyzeSupportDiagnostics(submission)
  };
}

export function analyzeSupportDiagnostics(submission) {
  const diagnostics = submission.diagnostics;
  const base = {
    reportId: submission.reportId,
    schema: diagnostics.schema,
    generatedAt: diagnostics.generatedAt,
    application: diagnostics.application,
    runtimeCollection: diagnostics.runtimeCollection,
    evidenceCompleteness: diagnostics.schema === SUPPORT_DIAGNOSTICS_DOCUMENT_SCHEMA_V5
      ? "aggregate-only"
      : "bounded-causal",
    findings: []
  };
  if (diagnostics.schema === SUPPORT_DIAGNOSTICS_DOCUMENT_SCHEMA_V5) {
    base.findings.push({
      rule: "V5_CAUSALITY_UNAVAILABLE",
      confidence: "verified",
      evidence: "This report predates the bounded action and incident timeline."
    });
    return base;
  }

  const hostIncidents = diagnostics.causality.agentHost?.incidents ?? [];
  const rendererIncidents = diagnostics.causality.renderer.incidents;
  const actions = diagnostics.causality.renderer.actions;
  for (const incident of hostIncidents) {
    if (incident.phase === "response-post" && incident.outcome === "failed") {
      base.findings.push({
        rule: "HOST_RESPONSE_POST_FAILED",
        confidence: "verified",
        evidence: boundedEvidence(incident, [
          "sequence",
          "at",
          "command",
          "errorClass",
          "reason",
          "connectionSequence",
          "hostEpoch",
          "binaryBytes"
        ])
      });
    }
    if (incident.phase === "event-post" && incident.outcome === "failed") {
      base.findings.push({
        rule: "HOST_EVENT_POST_FAILED",
        confidence: "verified",
        evidence: boundedEvidence(incident, [
          "sequence",
          "at",
          "errorClass",
          "reason",
          "connectionSequence",
          "hostEpoch"
        ])
      });
    }
  }
  const rendererClosures = rendererIncidents.filter((incident) => incident.phase === "port-close");
  if (rendererClosures.length >= 4 || diagnostics.causality.renderer.incidentsDroppedCount > 0) {
    base.findings.push({
      rule: "RENDERER_CONNECTION_STORM",
      confidence: diagnostics.causality.renderer.incidentsDroppedCount > 0 ? "verified-truncated" : "verified",
      evidence: {
        retainedPortClosures: rendererClosures.length,
        droppedIncidents: diagnostics.causality.renderer.incidentsDroppedCount
      }
    });
  }
  const lastFailedAction = [...actions].reverse().find((action) => action.stage === "failed");
  if (lastFailedAction) {
    base.findings.push({
      rule: "FIRST_PARTY_ACTION_FAILED",
      confidence: "verified",
      evidence: lastFailedAction
    });
  }
  if (base.findings.length === 0) {
    base.findings.push({
      rule: "NO_CLASSIFIED_CAUSE",
      confidence: "unresolved",
      evidence: {
        retainedActions: actions.length,
        retainedRendererIncidents: rendererIncidents.length,
        retainedHostIncidents: hostIncidents.length
      }
    });
  }
  return base;
}

export function createSupportR2Client(credentials) {
  return new S3Client({
    region: "auto",
    endpoint: `https://${credentials.accountId}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: credentials.accessKeyId,
      secretAccessKey: credentials.secretAccessKey
    }
  });
}

function parseCredentialFile(content) {
  const values = new Map();
  for (const [index, sourceLine] of content.split(/\r?\n/u).entries()) {
    const line = sourceLine.trim();
    if (line.length === 0 || line.startsWith("#")) continue;
    const separator = line.indexOf("=");
    if (separator <= 0) throw new Error(`Invalid Support R2 credential line ${index + 1}.`);
    const key = line.slice(0, separator).trim();
    if (!CREDENTIAL_KEYS.has(key) || values.has(key)) {
      throw new Error(`Unknown or duplicate Support R2 credential key on line ${index + 1}.`);
    }
    const rawValue = line.slice(separator + 1).trim();
    const value = unquote(rawValue);
    if (value.length === 0 || value.includes("\r") || value.includes("\n") || value.includes("\u0000")) {
      throw new Error(`Invalid Support R2 credential value on line ${index + 1}.`);
    }
    values.set(key, value);
  }
  return values;
}

function unquote(value) {
  if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) {
    return value.slice(1, -1);
  }
  return value;
}

function requireCredential(values, key) {
  const value = values.get(key);
  if (!value) throw new Error(`Missing ${key} in the Support R2 credential file.`);
  return value;
}

async function readBoundedBody(body, maximumBytes) {
  if (!body) throw new Error("Stored support report has no body.");
  const chunks = [];
  let total = 0;
  if (Symbol.asyncIterator in Object(body)) {
    for await (const chunk of body) {
      const bytes = chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk);
      total += bytes.byteLength;
      if (total > maximumBytes) throw new Error("Stored support report exceeds the 64 KiB boundary.");
      chunks.push(bytes);
    }
  } else if (typeof body.transformToByteArray === "function") {
    const bytes = await body.transformToByteArray();
    if (bytes.byteLength > maximumBytes) throw new Error("Stored support report exceeds the 64 KiB boundary.");
    chunks.push(bytes);
    total = bytes.byteLength;
  } else {
    throw new Error("Stored support report body is unreadable.");
  }
  const output = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output;
}

function parseSubmission(content) {
  let value;
  try {
    value = JSON.parse(content);
  } catch {
    throw new Error("Stored support report is not valid JSON.");
  }
  if (!isSupportDiagnosticsSubmission(value)) throw new Error("Stored support report failed the shared contract.");
  return value;
}

function boundedEvidence(value, keys) {
  return Object.fromEntries(keys.flatMap((key) => value[key] === undefined ? [] : [[key, value[key]]]));
}

function parseArguments(arguments_) {
  const options = {};
  for (let index = 0; index < arguments_.length; index += 1) {
    const key = arguments_[index];
    const value = arguments_[index + 1];
    if (!["--report", "--date", "--object-key", "--credentials"].includes(key) || !value) {
      throw new Error("Usage: support:diagnostics:read (--object-key KEY | --report ID --date YYYY-MM-DD) [--credentials FILE]");
    }
    index += 1;
    if (key === "--report") options.reportId = value;
    if (key === "--date") options.date = value;
    if (key === "--object-key") options.objectKey = value;
    if (key === "--credentials") options.credentialsPath = value;
  }
  if (options.objectKey) {
    if (options.reportId || options.date) throw new Error("Use either --object-key or --report plus --date.");
  } else if (!options.reportId || !options.date) {
    throw new Error("Both --report and --date are required without --object-key.");
  }
  return options;
}

async function main() {
  const result = await readSupportDiagnostics(parseArguments(process.argv.slice(2)));
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : "Support diagnostics read failed."}\n`);
    process.exitCode = 1;
  });
}
