import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import {
  boundedCommit,
  boundedHttpsUrl,
  boundedId,
  boundedText,
  boundedVersion,
  isRecord
} from "./skill-pack-validation.js";

const MAX_CATALOG_BYTES = 2 * 1024 * 1024;
const LARK_SUITE_ID = "lark-cli";

export interface BundledSkillSuiteDefinition {
  id: string;
  displayName: string;
  description: string;
  skillIds: string[];
  bundledVersion?: string;
  upstream?: string;
  sourceCommit?: string;
}

export async function readLarkSuite(
  capabilitiesRoot: string | undefined
): Promise<BundledSkillSuiteDefinition> {
  return readSkillSuite(capabilitiesRoot, LARK_SUITE_ID);
}

export async function readSkillSuite(
  capabilitiesRoot: string | undefined,
  suiteId: string
): Promise<BundledSkillSuiteDefinition> {
  if (!capabilitiesRoot) throw new Error("Pi-67 Desktop capability catalog is unavailable.");
  const path = join(capabilitiesRoot, "catalog.json");
  const contents = await readFile(path);
  if (contents.byteLength > MAX_CATALOG_BYTES) throw new Error("Capability catalog is oversized.");
  let value: unknown;
  try {
    value = JSON.parse(contents.toString("utf8"));
  } catch {
    throw new Error("Capability catalog contains invalid JSON.");
  }
  if (!isRecord(value) || value.schema !== "pi67.capability-catalog.v1") {
    throw new Error("Capability catalog schema is invalid.");
  }
  if (!Array.isArray(value.bundledSkillSuites) || value.bundledSkillSuites.length > 64) {
    throw new Error("Capability Skill suite catalog is invalid.");
  }
  const suite = value.bundledSkillSuites.find((candidate) => (
    isRecord(candidate) && candidate.id === suiteId
  ));
  if (!isRecord(suite)) throw new Error(`${suiteId} Skill suite is missing from the capability catalog.`);
  const displayName = boundedText(suite.displayName, 200);
  const description = boundedText(suite.description, 500);
  if (!displayName || !description || !Array.isArray(suite.members) || suite.members.length > 256) {
    throw new Error(`${suiteId} Skill suite metadata is invalid.`);
  }
  const skillIds = suite.members.map((member) => {
    if (!isRecord(member)) throw new Error(`${suiteId} Skill suite member is invalid.`);
    const skillId = boundedId(member.skillId);
    if (!skillId) throw new Error(`${suiteId} Skill suite member ID is invalid.`);
    return skillId;
  });
  if (skillIds.length === 0 || new Set(skillIds).size !== skillIds.length) {
    throw new Error(`${suiteId} Skill suite membership is invalid.`);
  }
  const bundledVersion = boundedVersion(suite.bundledVersion);
  const upstream = boundedHttpsUrl(suite.upstream);
  const sourceCommit = boundedCommit(suite.sourceCommit);
  return {
    id: suiteId,
    displayName,
    description,
    skillIds,
    ...(bundledVersion ? { bundledVersion } : {}),
    ...(upstream ? { upstream } : {}),
    ...(sourceCommit ? { sourceCommit } : {})
  };
}

export async function countInstalledSkills(skillIds: string[], roots: string[]): Promise<number> {
  let count = 0;
  for (const skillId of skillIds) {
    let installed = false;
    for (const root of roots) {
      try {
        if ((await stat(join(root, skillId))).isDirectory()) {
          installed = true;
          break;
        }
      } catch {
        // Missing or inaccessible roots do not make unrelated Skills unavailable.
      }
    }
    if (installed) count += 1;
  }
  return count;
}
