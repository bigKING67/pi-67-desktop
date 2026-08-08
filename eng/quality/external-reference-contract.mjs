const CATALOG_KEYS = new Set([
  "constraints",
  "defaultReuse",
  "id",
  "reviewCadence",
  "reviewState",
  "reviewTriggers",
  "role",
  "tier",
  "url"
]);
const REVIEW_KEYS = new Set([
  "license",
  "notesPath",
  "outcome",
  "remoteHeadAtReview",
  "reviewedAt",
  "reviewedCommit",
  "reviewedPaths",
  "sourceRef"
]);
const LICENSE_KEYS = new Set(["path", "sha256", "spdx"]);
const PROVENANCE_KEYS = new Set([
  "copyrightNotice",
  "license",
  "modifications",
  "noticePath",
  "reuseType",
  "sourceCommit",
  "sourcePath",
  "sourceRepository",
  "sourceSha256",
  "targetPath"
]);

const ROLES = new Set([
  "comprehensive-reference",
  "specification"
]);
const TIERS = new Set(["S0", "S1"]);
const REVIEW_STATES = new Set(["candidate", "contract-managed", "reviewed"]);
const REUSE_POLICIES = new Set(["dependency", "reimplement-preferred"]);
const REVIEW_CADENCES = new Set([
  "pi-release-and-weekly",
  "weekly-and-feature"
]);
const REVIEW_OUTCOMES = new Set([
  "adapted",
  "candidate",
  "copied",
  "no-action",
  "reference-only",
  "reimplemented",
  "rejected"
]);
const CODE_REUSE_TYPES = new Set(["adapted", "copied", "reimplemented"]);
const FULL_GIT_OBJECT = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u;
const SHA256 = /^[0-9a-f]{64}$/u;
const IDENTIFIER = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const CANONICAL_GITHUB = /^https:\/\/github\.com\/[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})\/[A-Za-z0-9._-]+$/u;
const SOURCE_REF = /^(?!refs\/)(?!.*\.\.)(?!.*[~^:?*\\])[A-Za-z0-9][A-Za-z0-9._/-]{0,127}$/u;
const SPDX = /^[A-Za-z0-9][A-Za-z0-9.+-]{0,63}$/u;
const REQUIRED_CATALOG_IDS = new Set(["pi", "pi-gui", "t3code"]);

export function collectExternalReferenceIssues({
  catalog,
  reviewLock,
  provenance,
  repositoryContents = new Map(),
  repositoryFiles = new Set()
}) {
  const issues = [];
  const repositories = validateCatalog(catalog, issues);
  const reviews = validateReviewLock(reviewLock, issues);
  const provenanceEntries = validateProvenance(provenance, repositories, repositoryFiles, issues);

  validateCrossReferences(repositories, reviews, provenanceEntries, issues);
  validateRepositoryEvidence(repositories, reviews, repositoryFiles, repositoryContents, issues);
  return issues;
}

function validateCatalog(catalog, issues) {
  const repositories = new Map();
  if (!isRecord(catalog)) {
    issues.push("references.catalog.json must contain an object");
    return repositories;
  }
  validateExactKeys(catalog, new Set(["repositories", "schemaVersion"]), "catalog", issues);
  if (catalog.schemaVersion !== 1) issues.push("catalog.schemaVersion must equal 1");
  if (!Array.isArray(catalog.repositories) || catalog.repositories.length === 0 || catalog.repositories.length > 64) {
    issues.push("catalog.repositories must contain between 1 and 64 records");
    return repositories;
  }

  const urls = new Set();
  for (const [index, repository] of catalog.repositories.entries()) {
    const label = `catalog.repositories[${index}]`;
    if (!isRecord(repository)) {
      issues.push(`${label} must be an object`);
      continue;
    }
    validateExactKeys(repository, CATALOG_KEYS, label, issues);
    validateIdentifier(repository.id, `${label}.id`, issues);
    validateGithubUrl(repository.url, `${label}.url`, issues);
    validateEnum(repository.role, ROLES, `${label}.role`, issues);
    validateEnum(repository.tier, TIERS, `${label}.tier`, issues);
    validateEnum(repository.reviewState, REVIEW_STATES, `${label}.reviewState`, issues);
    validateEnum(repository.defaultReuse, REUSE_POLICIES, `${label}.defaultReuse`, issues);
    validateEnum(repository.reviewCadence, REVIEW_CADENCES, `${label}.reviewCadence`, issues);
    validateStringList(repository.reviewTriggers, `${label}.reviewTriggers`, issues, { maximum: 16 });
    validateStringList(repository.constraints, `${label}.constraints`, issues, { maximum: 16 });

    if (typeof repository.id === "string") {
      if (repositories.has(repository.id)) issues.push(`${label}.id duplicates ${repository.id}`);
      else repositories.set(repository.id, repository);
    }
    if (typeof repository.url === "string") {
      if (urls.has(repository.url)) issues.push(`${label}.url duplicates ${repository.url}`);
      urls.add(repository.url);
      if (repository.url === "https://github.com/bigKING67/pi-67-desktop") {
        issues.push(`${label}.url must not register the current product as an external reference`);
      }
    }
  }

  validateCatalogIdentifierSet(repositories, issues);
  validatePiCatalogRecord(repositories.get("pi"), issues);
  validateComprehensiveCatalogRecord(
    "pi-gui",
    repositories.get("pi-gui"),
    "https://github.com/minghinmatthewlam/pi-gui",
    issues
  );
  validateComprehensiveCatalogRecord(
    "t3code",
    repositories.get("t3code"),
    "https://github.com/pingdotgg/t3code",
    issues
  );
  return repositories;
}

function validateReviewLock(reviewLock, issues) {
  const reviews = new Map();
  if (!isRecord(reviewLock)) {
    issues.push("references.lock.json must contain an object");
    return reviews;
  }
  validateExactKeys(reviewLock, new Set(["reviews", "schemaVersion"]), "reviewLock", issues);
  if (reviewLock.schemaVersion !== 1) issues.push("reviewLock.schemaVersion must equal 1");
  if (!isRecord(reviewLock.reviews) || Object.keys(reviewLock.reviews).length > 64) {
    issues.push("reviewLock.reviews must be an object with at most 64 records");
    return reviews;
  }

  for (const [id, review] of Object.entries(reviewLock.reviews)) {
    const label = `reviewLock.reviews.${id}`;
    validateIdentifier(id, `${label} key`, issues);
    if (!isRecord(review)) {
      issues.push(`${label} must be an object`);
      continue;
    }
    validateExactKeys(review, REVIEW_KEYS, label, issues);
    validateGitObject(review.reviewedCommit, `${label}.reviewedCommit`, issues);
    validateGitObject(review.remoteHeadAtReview, `${label}.remoteHeadAtReview`, issues);
    if (typeof review.sourceRef !== "string" || review.sourceRef.includes("[") || !SOURCE_REF.test(review.sourceRef)) {
      issues.push(`${label}.sourceRef must be a bounded branch name, not a symbolic ref`);
    }
    validateDate(review.reviewedAt, `${label}.reviewedAt`, issues);
    validatePathList(review.reviewedPaths, `${label}.reviewedPaths`, issues);
    validateEnum(review.outcome, REVIEW_OUTCOMES, `${label}.outcome`, issues);
    validateLicense(review.license, `${label}.license`, issues);
    validateRepositoryPath(review.notesPath, `${label}.notesPath`, issues);
    reviews.set(id, review);
  }
  return reviews;
}

function validateProvenance(provenance, repositories, repositoryFiles, issues) {
  const entries = [];
  if (!isRecord(provenance)) {
    issues.push("licenses/provenance.json must contain an object");
    return entries;
  }
  validateExactKeys(provenance, new Set(["entries", "schemaVersion"]), "provenance", issues);
  if (provenance.schemaVersion !== 1) issues.push("provenance.schemaVersion must equal 1");
  if (!Array.isArray(provenance.entries) || provenance.entries.length > 512) {
    issues.push("provenance.entries must be an array with at most 512 records");
    return entries;
  }

  const catalogUrls = new Map([...repositories.values()].map((record) => [record.url, record]));
  const identities = new Set();
  for (const [index, entry] of provenance.entries.entries()) {
    const label = `provenance.entries[${index}]`;
    if (!isRecord(entry)) {
      issues.push(`${label} must be an object`);
      continue;
    }
    validateExactKeys(entry, PROVENANCE_KEYS, label, issues, { optional: new Set(["noticePath"]) });
    validateGithubUrl(entry.sourceRepository, `${label}.sourceRepository`, issues);
    validateGitObject(entry.sourceCommit, `${label}.sourceCommit`, issues);
    validateRepositoryPath(entry.sourcePath, `${label}.sourcePath`, issues);
    validateHash(entry.sourceSha256, `${label}.sourceSha256`, issues);
    validateRepositoryPath(entry.targetPath, `${label}.targetPath`, issues);
    validateEnum(entry.reuseType, CODE_REUSE_TYPES, `${label}.reuseType`, issues);
    validateLicense(entry.license, `${label}.license`, issues);
    validateBoundedString(entry.copyrightNotice, `${label}.copyrightNotice`, issues, 1, 1_000);
    validateBoundedString(entry.modifications, `${label}.modifications`, issues, 1, 1_000);

    const repository = catalogUrls.get(entry.sourceRepository);
    if (!repository) issues.push(`${label}.sourceRepository is not registered in references.catalog.json`);
    else if (repository.reviewState !== "reviewed") {
      issues.push(`${label}.sourceRepository must have reviewState reviewed before code reuse`);
    }
    requireRepositoryFile(entry.targetPath, `${label}.targetPath`, repositoryFiles, issues);

    if (entry.reuseType === "adapted" || entry.reuseType === "copied") {
      validateRepositoryPath(entry.noticePath, `${label}.noticePath`, issues);
      requireRepositoryFile(entry.noticePath, `${label}.noticePath`, repositoryFiles, issues);
    } else if (entry.noticePath !== undefined) {
      validateRepositoryPath(entry.noticePath, `${label}.noticePath`, issues);
      requireRepositoryFile(entry.noticePath, `${label}.noticePath`, repositoryFiles, issues);
    }

    const identity = `${entry.sourceRepository}#${entry.sourceCommit}:${entry.sourcePath}->${entry.targetPath}`;
    if (identities.has(identity)) issues.push(`${label} duplicates an existing provenance mapping`);
    identities.add(identity);
    entries.push(entry);
  }
  return entries;
}

function validateCrossReferences(repositories, reviews, provenanceEntries, issues) {
  for (const [id, repository] of repositories) {
    const review = reviews.get(id);
    if (repository.reviewState === "reviewed" && !review) {
      issues.push(`catalog repository ${id} is reviewed but has no references.lock.json record`);
    }
    if (repository.reviewState !== "reviewed" && review) {
      issues.push(`catalog repository ${id} has reviewState ${repository.reviewState} but also has a lock record`);
    }
    if (id !== "pi" && (repository.tier === "S0" || repository.reviewState === "contract-managed")) {
      issues.push(`catalog repository ${id} cannot use the Pi-only S0 contract-managed policy`);
    }
  }
  for (const id of reviews.keys()) {
    if (!repositories.has(id)) issues.push(`review lock ${id} has no catalog repository`);
  }

  for (const [id, review] of reviews) {
    if (!CODE_REUSE_TYPES.has(review.outcome)) continue;
    const repository = repositories.get(id);
    const matching = provenanceEntries.some((entry) => (
      entry.sourceRepository === repository?.url && entry.sourceCommit === review.reviewedCommit
    ));
    if (!matching) issues.push(`review lock ${id} outcome ${review.outcome} requires matching code provenance`);
  }
}

function validateRepositoryEvidence(repositories, reviews, repositoryFiles, repositoryContents, issues) {
  for (const requiredPath of ["packages/pi-runtime/package.json", "pnpm-workspace.yaml"]) {
    requireRepositoryFile(requiredPath, `Pi contract path ${requiredPath}`, repositoryFiles, issues);
  }
  for (const [id, review] of reviews) {
    requireRepositoryFile(review.notesPath, `review lock ${id} notesPath`, repositoryFiles, issues);
    const notes = repositoryContents.get(review.notesPath);
    if (typeof notes !== "string") issues.push(`review lock ${id} notesPath could not be read`);
    else if (!notes.includes(review.reviewedCommit)) {
      issues.push(`review lock ${id} notesPath does not contain reviewedCommit ${review.reviewedCommit}`);
    }
  }
}

function validateCatalogIdentifierSet(repositories, issues) {
  for (const id of REQUIRED_CATALOG_IDS) {
    if (!repositories.has(id)) issues.push(`catalog must register required repository ${id}`);
  }
  for (const id of repositories.keys()) {
    if (!REQUIRED_CATALOG_IDS.has(id)) issues.push(`catalog repository ${id} is not an allowed reference`);
  }
}

function validatePiCatalogRecord(record, issues) {
  if (!record) return;
  const expected = {
    defaultReuse: "dependency",
    reviewCadence: "pi-release-and-weekly",
    reviewState: "contract-managed",
    role: "specification",
    tier: "S0",
    url: "https://github.com/earendil-works/pi"
  };
  for (const [key, value] of Object.entries(expected)) {
    if (record[key] !== value) issues.push(`catalog repository pi ${key} must equal ${value}`);
  }
}

function validateComprehensiveCatalogRecord(id, record, url, issues) {
  if (!record) return;
  const expected = {
    defaultReuse: "reimplement-preferred",
    reviewCadence: "weekly-and-feature",
    reviewState: "reviewed",
    role: "comprehensive-reference",
    tier: "S1",
    url
  };
  for (const [key, value] of Object.entries(expected)) {
    if (record[key] !== value) issues.push(`catalog repository ${id} ${key} must equal ${value}`);
  }
}

function validateLicense(value, label, issues) {
  if (!isRecord(value)) {
    issues.push(`${label} must be an object`);
    return;
  }
  validateExactKeys(value, LICENSE_KEYS, label, issues);
  if (typeof value.spdx !== "string" || !SPDX.test(value.spdx)) issues.push(`${label}.spdx is invalid`);
  validateRepositoryPath(value.path, `${label}.path`, issues);
  validateHash(value.sha256, `${label}.sha256`, issues);
}

function validateExactKeys(value, allowed, label, issues, { optional = new Set() } = {}) {
  for (const key of Object.keys(value)) if (!allowed.has(key)) issues.push(`${label}.${key} is not allowed`);
  for (const key of allowed) {
    if (!optional.has(key) && !Object.hasOwn(value, key)) issues.push(`${label}.${key} is required`);
  }
}

function validateStringList(value, label, issues, { maximum }) {
  if (!Array.isArray(value) || value.length === 0 || value.length > maximum) {
    issues.push(`${label} must contain between 1 and ${maximum} strings`);
    return;
  }
  const unique = new Set();
  for (const [index, item] of value.entries()) {
    validateBoundedString(item, `${label}[${index}]`, issues, 1, 240);
    if (typeof item === "string") {
      if (unique.has(item)) issues.push(`${label}[${index}] duplicates ${item}`);
      unique.add(item);
    }
  }
}

function validatePathList(value, label, issues) {
  if (!Array.isArray(value) || value.length === 0 || value.length > 64) {
    issues.push(`${label} must contain between 1 and 64 repository paths`);
    return;
  }
  const unique = new Set();
  for (const [index, path] of value.entries()) {
    validateRepositoryPath(path, `${label}[${index}]`, issues);
    if (typeof path === "string") {
      if (unique.has(path)) issues.push(`${label}[${index}] duplicates ${path}`);
      unique.add(path);
    }
  }
}

function validateRepositoryPath(value, label, issues) {
  if (typeof value !== "string" || value.length === 0 || value.length > 300) {
    issues.push(`${label} must be a bounded repository-relative path`);
    return;
  }
  const segments = value.split("/");
  if (value.startsWith("/") || value.includes("\\") || segments.some((segment) => !segment || segment === "." || segment === "..")) {
    issues.push(`${label} must be a normalized repository-relative path`);
  }
}

function validateGithubUrl(value, label, issues) {
  if (typeof value !== "string" || !CANONICAL_GITHUB.test(value) || value.endsWith(".git")) {
    issues.push(`${label} must be a canonical HTTPS GitHub repository URL without .git`);
  }
}

function validateIdentifier(value, label, issues) {
  if (typeof value !== "string" || value.length > 64 || !IDENTIFIER.test(value)) {
    issues.push(`${label} must be a lowercase kebab-case identifier`);
  }
}

function validateGitObject(value, label, issues) {
  if (typeof value !== "string" || !FULL_GIT_OBJECT.test(value)) {
    issues.push(`${label} must be a full lowercase Git object ID`);
  }
}

function validateHash(value, label, issues) {
  if (typeof value !== "string" || !SHA256.test(value)) issues.push(`${label} must be a lowercase SHA-256`);
}

function validateDate(value, label, issues) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/u.test(value)) {
    issues.push(`${label} must use YYYY-MM-DD`);
    return;
  }
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.valueOf()) || parsed.toISOString().slice(0, 10) !== value) {
    issues.push(`${label} must be a real calendar date`);
  }
}

function validateBoundedString(value, label, issues, minimum, maximum) {
  if (typeof value !== "string" || value.length < minimum || value.length > maximum || hasDisallowedControl(value)) {
    issues.push(`${label} must be a string between ${minimum} and ${maximum} characters`);
  }
}

function hasDisallowedControl(value) {
  return [...value].some((character) => {
    const code = character.codePointAt(0);
    return code !== undefined && code < 32 && code !== 9 && code !== 10 && code !== 13;
  });
}

function validateEnum(value, allowed, label, issues) {
  if (typeof value !== "string" || !allowed.has(value)) issues.push(`${label} has unsupported value ${String(value)}`);
}

function requireRepositoryFile(path, label, repositoryFiles, issues) {
  if (typeof path === "string" && !repositoryFiles.has(path)) issues.push(`${label} does not exist in the repository`);
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
