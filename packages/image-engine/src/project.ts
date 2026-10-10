import * as fs from "node:fs/promises";
import path from "node:path";
import { regularPath, readBytes, importRaster, saveAsset, readAsset, type ImportedRaster } from "./raster.js";
import { readCandidateEntry, verifyCandidateAgainst, readDiscard, decisionPending, withDecisionLock, type CandidateEntry } from "./candidate-store.js";
import { encodeJson, errorCode, fail, sha256, writeOnce } from "./content-store.js";
import { SCHEMA, LIMITS, OPTIONAL_COMMON, USER_FONT_LIMIT, documentSchema, validateDocument, validateCanvas, record, id, number, isRecord, textObjects, type ImageDocument, type JsonRecord, type SceneObject, type ChangeAuthor, type AcceptedCandidate, type UserFont } from "./document.js";
import { fontManifest, installedFont, checkGlyphs, checkTextGlyphs, inspectUserFont, userFontSample } from "./font.js";
import { USER_FONT_MAX_BYTES } from "./font-parse.js";
import { preparePhotoProject, type PhotoLayout } from "./photo-layout.js";
import { compose } from "./render-compose.js";

export interface ProjectState {
  root: string; document: ImageDocument; sha256: string; latest_revision: number; font: Buffer;
  /** The bound user fonts by id, digest-verified and parsed once. */
  fonts: Map<string, Buffer>;
  candidate_decisions: Record<string, { sha256: string; revision: number }>;
}
export interface PublishedRevision { root: string; document: ImageDocument; sha256: string; dry_run?: true }
export interface EditBatch { base_revision: number; author: ChangeAuthor; summary: string; operations: JsonRecord[] }
export interface CreateInput { project_id: string; title: string; canvas: JsonRecord; assets: unknown[]; objects: unknown[] }

export { regularPath, importRaster } from "./raster.js";
export const encode = encodeJson;
const revisionName = (revision: number): string => `revisions/${String(revision).padStart(6, "0")}.json`;

async function verifyBindings(root: string, doc: ImageDocument): Promise<{ font: Buffer; fonts: Map<string, Buffer> }> {
  const font = await readBytes(path.join(root, doc.font.file), fontManifest.bytes);
  const fonts = await loadUserFonts(root, doc, new Map());
  checkTextGlyphs(font, textObjects(doc.objects), fonts);
  for (const asset of doc.assets) await readAsset(root, asset);
  return { font, fonts };
}

/**
 * Loads (reads, hashes, parses) only the user fonts text actually uses; the rest are
 * checked for presence and size. A project with several large fonts stays cheap to
 * list and watch, and copying still verifies every digest (project-copy.ts).
 */
async function loadUserFonts(root: string, doc: ImageDocument, loaded: ReadonlyMap<string, Buffer>): Promise<Map<string, Buffer>> {
  const used = new Set(textObjects(doc.objects).flatMap((object) => object.font_id ? [object.font_id] : []));
  const fonts = new Map(loaded);
  for (const user of doc.fonts ?? []) {
    if (fonts.has(user.id)) continue;
    const file = path.join(root, user.file);
    if (!used.has(user.id)) {
      const stat = await fs.lstat(file).catch(() => undefined);
      if (!stat?.isFile() || stat.size !== user.bytes) fail(`User font changed: ${user.id}`);
      continue;
    }
    const bytes = await readBytes(file, USER_FONT_MAX_BYTES);
    if (bytes.length !== user.bytes || sha256(bytes) !== user.sha256) fail(`User font changed: ${user.id}`);
    inspectUserFont(bytes);
    fonts.set(user.id, bytes);
  }
  return fonts;
}

async function checkTextLayout(root: string, doc: ImageDocument, font: Buffer, fonts: ReadonlyMap<string, Buffer>): Promise<void> {
  const objects = textObjects(doc.objects).filter((object) => object.visible);
  if (!objects.length) return;
  // Measure with the export engine without reading or writing temporary assets.
  await compose({ root, font, fonts, document: { ...doc, assets: [], objects } });
}

/**
 * Reads a font file the person chose (through the Host, never the Agent) and
 * binds it under `id`; the bytes are written with the revision.
 */
async function importUserFont(input: unknown, doc: ImageDocument): Promise<{ font: UserFont; bytes: Buffer }> {
  record(input, ["id", "source"], "font input");
  // Without an id the engine takes the next free `font-N`, so callers need not read the project first.
  const taken = new Set((doc.fonts ?? []).map((font) => font.id));
  let fontId = typeof input.id === "string" ? input.id : "font-1";
  for (let index = 2; input.id === undefined && taken.has(fontId); index += 1) fontId = `font-${index}`;
  id(fontId, "font id");
  if (typeof input.source !== "string") fail("Invalid font source");
  const bytes = await readBytes(await regularPath(input.source), USER_FONT_MAX_BYTES);
  const { format, family } = inspectUserFont(bytes);
  const digest = sha256(bytes), fonts = doc.fonts ?? [];
  if (fonts.length >= USER_FONT_LIMIT) fail(`A project holds at most ${USER_FONT_LIMIT} fonts`);
  if (taken.has(fontId)) fail(`Duplicate font id: ${fontId}`);
  const same = fonts.find((font) => font.sha256 === digest);
  if (same) fail(`Font already added as ${same.id}`);
  return { font: { id: fontId, family, file: `fonts/user-${digest}.${format}`, sha256: digest, bytes: bytes.length, format }, bytes };
}

/**
 * Our parser screens a font; the renderer must load it too. A short sample in the
 * font is composed before it is bound, so a font the renderer cannot use is refused
 * now instead of being stuck in the project, failing every later use.
 */
async function probeUserFont(root: string, doc: ImageDocument, font: Buffer, imported: { font: UserFont; bytes: Buffer }): Promise<void> {
  const sample = userFontSample(imported.bytes) ?? fail("Unsupported font file: it has no letters, digits or common CJK characters");
  try {
    await compose({ root, font, fonts: new Map([[imported.font.id, imported.bytes]]), document: { ...doc, canvas: { width: 1024, height: 256, background: "#ffffff" }, assets: [],
      objects: [{ id: "probe", kind: "text", locked: false, visible: true, x: 0, y: 0, width: 1024, height: 256, opacity: 1, text: sample, font_size: 48, color: "#000000", align: "left", line_height: 1.2, font_id: imported.font.id }] } });
  } catch {
    fail("Unsupported font file: the renderer could not load it");
  }
}

// Fail before decoding any asset; mkdir remains the exclusive claim.
async function newProjectRoot(root: string): Promise<string> {
  const absolute = path.resolve(root);
  await regularPath(path.dirname(absolute), { directory: true });
  let exists = false;
  try { await fs.lstat(absolute); exists = true; }
  catch (error) { if (errorCode(error) !== "ENOENT") throw error; }
  if (exists) fail("Project already exists");
  return absolute;
}

export async function createProject(root: string, input: unknown): Promise<PublishedRevision> {
  record(input, ["project_id", "title", "canvas", "assets", "objects"], "create input");
  if (!Array.isArray(input.assets) || input.assets.length > LIMITS.assets) fail("Invalid asset inputs");
  const resolved = await newProjectRoot(root);
  const imports: ImportedRaster[] = [];
  for (const asset of input.assets) imports.push(await importRaster(asset));
  return createPreparedProject(resolved, input as unknown as CreateInput, imports);
}

export async function createPhotoProject(root: string, brief: unknown, { dryRun = false }: { dryRun?: boolean } = {}): Promise<PublishedRevision & { layout: PhotoLayout }> {
  const resolved = await newProjectRoot(root);
  const prepared = await preparePhotoProject(brief);
  const result = await createPreparedProject(resolved, prepared.input, prepared.imports, { dryRun, checkText: true });
  return { ...result, layout: prepared.layout };
}

// Prepared imports remain internal so the new entry shares the same exclusive
// publication and cleanup path without decoding or reading the source twice.
async function createPreparedProject(root: string, input: CreateInput, imports: ImportedRaster[], { dryRun = false, checkText = false } = {}): Promise<PublishedRevision> {
  const font = await installedFont();
  const doc = validateDocument({ schema: SCHEMA, project_id: input.project_id, title: input.title,
    revision: 1, parent_sha256: null, canvas: structuredClone(input.canvas), assets: imports.map((value) => value.asset),
    font: { profile: fontManifest.profile, family: fontManifest.family, file: `fonts/${fontManifest.sha256}.otf`, sha256: fontManifest.sha256, weight: fontManifest.weight },
    objects: structuredClone(input.objects), change: { author: "system", summary: "Create local image project", operations: ["create"] } });
  checkGlyphs(font, textObjects(doc.objects).map((object) => object.text));
  if (checkText) await checkTextLayout(root, doc, font, new Map());
  if (dryRun) return { root, document: doc, sha256: sha256(encode(doc)), dry_run: true };
  // Only remove a directory this invocation created, never a user's project.
  await fs.mkdir(root);
  try {
    for (const folder of ["assets", "fonts", "revisions"]) await fs.mkdir(path.join(root, folder));
    for (const imported of imports) await saveAsset(root, imported);
    await writeOnce(path.join(root, doc.font.file), { bytes: font }, { expected: fontManifest.sha256 });
    const bytes = encode(doc);
    await writeOnce(path.join(root, revisionName(1)), { bytes }, { expected: sha256(bytes), conflict: "Project already exists" });
    return { root, document: doc, sha256: sha256(bytes) };
  } catch (error) { await fs.rm(root, { recursive: true, force: true }); throw error; }
}

export async function readProject(root: string, { revision }: { revision?: number | undefined } = {}): Promise<ProjectState> {
  const resolved = await regularPath(root, { directory: true });
  const directory = await regularPath(path.join(resolved, "revisions"), { directory: true });
  const files = await fs.readdir(directory);
  const revisions = files.filter((file) => /^\d{6}\.json$/.test(file)).map((file) => Number(file.slice(0, 6))).sort((a, b) => a - b);
  const latest = revisions.at(-1);
  if (latest === undefined) fail("Incomplete project: no saved revision (interrupted create); inspect, remove the directory and create again");
  if (revisions.length > LIMITS.revisions || revisions.some((value, index) => value !== index + 1)) fail("Broken revision sequence");
  const requested = revision ?? latest;
  number(requested, "requested revision", 1, latest, true);
  let parent: string | null = null, selected: ImageDocument | undefined, selectedBytes: Buffer | undefined;
  const candidateDecisions = new Map<string, { sha256: string; revision: number }>();
  // Validate the complete ancestry of the requested revision, not only HEAD.
  for (let current = 1; current <= requested; current++) {
    const bytes = await readBytes(path.join(resolved, revisionName(current)), 1_000_000);
    const doc = validateDocument(JSON.parse(bytes.toString("utf8")));
    if (doc.revision !== current || doc.parent_sha256 !== parent) fail("Broken revision digest chain");
    if (selected && (doc.project_id !== selected.project_id || doc.title !== selected.title)) fail("Project identity changed");
    if (doc.change.candidate) {
      const { id: candidateId, sha256: candidateDigest } = doc.change.candidate;
      if (candidateDecisions.has(candidateId)) fail("Candidate accepted twice in history");
      const manifest = await readBytes(path.join(resolved, "candidates", candidateId, "candidate.json"), 100_000);
      if (candidateDigest !== sha256(manifest)) fail("Accepted candidate digest mismatch");
      candidateDecisions.set(candidateId, { sha256: candidateDigest, revision: current });
    }
    parent = sha256(bytes); selected = doc; selectedBytes = bytes;
  }
  if (!selected || !selectedBytes) fail("Broken revision sequence");
  const { font, fonts } = await verifyBindings(resolved, selected);
  return { root: resolved, document: selected, sha256: sha256(selectedBytes), latest_revision: latest, font, fonts, candidate_decisions: Object.fromEntries(candidateDecisions) };
}

export interface RevisionEntry { revision: number; author: string; summary: string; operations: string[]; candidate_id?: string; written_at: number }

/** Every revision's change record, after the whole chain validated (newest last). */
export async function projectHistory(root: string): Promise<RevisionEntry[]> {
  const project = await readProject(root);
  const entries: RevisionEntry[] = [];
  for (let current = 1; current <= project.latest_revision; current++) {
    const file = path.join(project.root, revisionName(current));
    const [bytes, stat] = await Promise.all([readBytes(file, 1_000_000), fs.stat(file)]);
    const { change } = validateDocument(JSON.parse(bytes.toString("utf8")));
    entries.push({ revision: current, author: change.author, summary: change.summary, operations: [...change.operations],
      ...(change.candidate ? { candidate_id: change.candidate.id } : {}), written_at: Math.round(stat.mtimeMs) });
  }
  return entries;
}

/** Drops optional fields written as null, 0 or false, so a document never stores a no-op value. */
function withoutNoOps(object: JsonRecord, optional: readonly string[]): JsonRecord {
  for (const key of optional) if (object[key] === null || object[key] === 0 || object[key] === false) delete object[key];
  return object;
}

function objectAt(doc: ImageDocument, objectId: unknown): number {
  id(objectId, "object id");
  const index = doc.objects.findIndex((object) => object.id === objectId);
  if (index < 0) fail(`Unknown object: ${objectId}`);
  return index;
}

const opType = (op: unknown): string | undefined => isRecord(op) && typeof op.type === "string" ? op.type : undefined;

export async function editBatch(root: string, batch: unknown, { dryRun = false }: { dryRun?: boolean } = {}): Promise<PublishedRevision> {
  record(batch, ["base_revision", "author", "summary", "operations"], "edit batch");
  const operations = batch.operations;
  if (!Array.isArray(operations) || !operations.length || operations.length > LIMITS.operations) fail("Invalid edit operations");
  if (operations.some((op) => opType(op) === "accept_candidate")) {
    if (operations.length !== 1) fail("Candidate acceptance must be isolated");
    const first = operations[0];
    const candidateId = isRecord(first) ? first.candidate_id : undefined;
    id(candidateId, "candidate id");
    if (!dryRun) return withDecisionLock(root, candidateId, () => applyBatch(root, batch as unknown as EditBatch, { dryRun }));
  }
  return applyBatch(root, batch as unknown as EditBatch, { dryRun });
}

export async function candidateDocument(root: string, project: ProjectState, candidateId: string, entry?: CandidateEntry): Promise<{ document: ImageDocument; entry: CandidateEntry }> {
  const bound = entry ?? await readCandidateEntry(root, candidateId);
  const object = await verifyCandidateAgainst(root, project, bound);
  if (object.locked) fail(`Object is locked: ${object.id}`);
  const doc = structuredClone(project.document);
  const output = bound.candidate.output;
  const existing = doc.assets.find((asset) => asset.id === output.id);
  if (existing && JSON.stringify(existing) !== JSON.stringify(output)) fail("Candidate output asset id conflict");
  if (!existing) doc.assets.push(structuredClone(output));
  const target = doc.objects.find((value) => value.id === object.id);
  if (target?.kind === "image") target.asset_id = output.id;
  doc.change = { author: "system", summary: `Read-only preview of candidate ${candidateId}`, operations: ["candidate_preview"] };
  validateDocument(doc);
  return { document: doc, entry: bound };
}

// A Map keeps prototype names such as "constructor" from resolving to inherited members.
const OPERATION_FIELDS: ReadonlyMap<string, readonly string[]> = new Map([
  ["add_asset", ["asset"]], ["add_font", ["font"]], ["add_object", ["object"]], ["update_object", ["id", "patch"]], ["remove_object", ["id"]], ["reorder_objects", ["ids"]],
  ["set_canvas", ["canvas"]], ["revert_to", ["revision"]], ["accept_candidate", ["candidate_id"]]
]);

async function applyBatch(root: string, batch: EditBatch, { dryRun }: { dryRun: boolean }): Promise<PublishedRevision> {
  const current = await readProject(root);
  if (batch.base_revision !== current.document.revision) fail(`Revision conflict: expected ${current.document.revision}, received ${batch.base_revision}`);
  if (current.document.revision >= LIMITS.revisions) fail(`Revision limit reached (${LIMITS.revisions}); create a new project from the current document to continue editing`);
  let doc: ImageDocument = structuredClone(current.document);
  const imports: ImportedRaster[] = [];
  const fontImports: { font: UserFont; bytes: Buffer }[] = [];
  let candidateChange: AcceptedCandidate | undefined;
  // Revert and lock changes are isolated so a batch cannot unlock, alter, then
  // relock an object while disguising the change as a protected edit.
  for (const op of batch.operations) {
    if (opType(op) === "revert_to" && batch.operations.length !== 1) fail("Revert must be an isolated operation");
    if (opType(op) === "update_object" && isRecord(op.patch) && Object.hasOwn(op.patch, "locked") &&
        (batch.operations.length !== 1 || Object.keys(op.patch).length !== 1)) fail("Lock changes must be isolated");
  }
  for (const op of batch.operations) {
    const type = opType(op);
    const fields = type === undefined ? undefined : OPERATION_FIELDS.get(type);
    if (!fields) fail(`Unsupported operation: ${type}`);
    record(op, ["type", ...fields], "operation");
    switch (type) {
      case "accept_candidate": {
        const candidateId = op.candidate_id as string;
        if (Object.hasOwn(current.candidate_decisions, candidateId)) fail("Candidate already accepted");
        const entry = await readCandidateEntry(root, candidateId);
        if (await readDiscard(entry)) fail("Candidate is discarded");
        if (dryRun && await decisionPending(entry)) fail("Candidate decision in progress");
        const prepared = await candidateDocument(root, current, candidateId, entry);
        doc = prepared.document;
        candidateChange = { id: candidateId, sha256: entry.sha256 };
        break;
      }
      case "add_asset": { const imported = await importRaster(op.asset); doc.assets.push(imported.asset); imports.push(imported); break; }
      case "add_font": {
        const imported = await importUserFont(op.font, doc);
        doc.fonts = [...(doc.fonts ?? []), imported.font]; fontImports.push(imported); break;
      }
      case "add_object": doc.objects.push(withoutNoOps(structuredClone(op.object) as unknown as JsonRecord, [...OPTIONAL_COMMON, "font_id"]) as unknown as SceneObject); break;
      case "update_object": {
        const index = objectAt(doc, op.id), object = doc.objects[index] as SceneObject;
        // Optional fields may be added, and dropped with `null` (or 0 / false for rotation and
        // flips), so a document never carries a no-op value and keeps the oldest schema it can.
        const optional = [...OPTIONAL_COMMON, ...(object.kind === "text" ? ["font_id"] : [])];
        const mutable = [...new Set([...Object.keys(object).filter((key) => !["id", "kind"].includes(key)), ...optional])];
        record(op.patch, mutable, "object patch");
        if (!Object.keys(op.patch).length) fail("Empty object patch");
        if (object.locked && !Object.hasOwn(op.patch, "locked")) fail(`Object is locked: ${object.id}`);
        const next = withoutNoOps({ ...object, ...structuredClone(op.patch) } as JsonRecord, optional);
        // A patch of optional fields alone that leaves the object as it was would publish an invisible revision.
        if (Object.keys(op.patch).every((key) => optional.includes(key)) && JSON.stringify(next) === JSON.stringify(object)) fail(`Patch changes nothing on ${object.id}`);
        doc.objects[index] = next as unknown as SceneObject; break;
      }
      case "remove_object": {
        const index = objectAt(doc, op.id); if (doc.objects[index]?.locked) fail(`Object is locked: ${String(op.id)}`);
        doc.objects.splice(index, 1); break;
      }
      case "reorder_objects": {
        const ids = op.ids;
        if (!Array.isArray(ids) || ids.length !== doc.objects.length || new Set(ids).size !== ids.length) fail("Reorder must include every object exactly once");
        const ordered = ids.map((value) => doc.objects[objectAt(doc, value)] as SceneObject);
        for (let index = 0; index < doc.objects.length; index++) {
          const object = doc.objects[index];
          if (object?.locked && ordered[index]?.id !== object.id) fail("Cannot reorder a locked object");
        }
        doc.objects = ordered; break;
      }
      case "set_canvas": doc.canvas = validateCanvas(structuredClone(op.canvas)); break;
      case "revert_to": {
        number(op.revision, "revert revision", 1, current.document.revision - 1, true);
        const previous = (await readProject(root, { revision: op.revision })).document;
        for (const [index, locked] of current.document.objects.entries()) {
          if (!locked.locked) continue;
          const earlier = previous.objects.find((object) => object.id === locked.id);
          if (!earlier || JSON.stringify({ ...earlier, locked: true }) !== JSON.stringify(locked)) fail(`Revert would change locked object: ${locked.id}`);
          if (previous.objects[index]?.id !== locked.id) fail(`Revert would reorder locked object: ${locked.id}`);
        }
        doc.canvas = structuredClone(previous.canvas); doc.assets = structuredClone(previous.assets); doc.objects = structuredClone(previous.objects);
        // Fonts bound later stay bound (their bytes are already in the project); objects revert to their own font choice.
        if (previous.fonts) doc.fonts = [...structuredClone(previous.fonts), ...(doc.fonts ?? []).filter((font) => !previous.fonts?.some((item) => item.id === font.id))];
        // Lock state is an explicit current policy, not an undo side effect.
        for (const object of doc.objects) {
          const now = current.document.objects.find((value) => value.id === object.id);
          object.locked = now?.locked ?? false;
        }
        break;
      }
      default: fail(`Unsupported operation: ${type}`);
    }
  }
  if (doc.fonts && !doc.fonts.length) delete doc.fonts;
  doc.schema = documentSchema(doc);
  doc.revision++; doc.parent_sha256 = current.sha256;
  doc.change = { author: batch.author, summary: batch.summary, operations: batch.operations.map((op) => opType(op) ?? "") };
  if (candidateChange) doc.change.candidate = candidateChange;
  doc = validateDocument(doc);
  const fonts = new Map(current.fonts);
  for (const imported of fontImports) {
    await probeUserFont(current.root, doc, current.font, imported);
    fonts.set(imported.font.id, imported.bytes);
  }
  const used = await loadUserFonts(current.root, doc, fonts);
  checkTextGlyphs(current.font, textObjects(doc.objects), used);
  // Unlocking changes no pixels and must remain possible to repair a locked
  // legacy layout. Isolation and patch validation above prohibit other changes.
  const only = batch.operations.length === 1 ? batch.operations[0] : undefined;
  const unlockOnly = opType(only) === "update_object" && isRecord(only?.patch) && only.patch.locked === false;
  if (!unlockOnly) await checkTextLayout(current.root, doc, current.font, used);
  if (dryRun) return { root: current.root, dry_run: true, document: doc, sha256: sha256(encode(doc)) };
  await regularPath(path.join(root, "assets"), { directory: true });
  for (const imported of imports) await saveAsset(root, imported);
  for (const imported of fontImports) await writeOnce(path.join(current.root, imported.font.file), { bytes: imported.bytes }, { expected: imported.font.sha256 });
  const bytes = encode(doc);
  // Immutable exclusive publication makes concurrent edits on the same base
  // have one winner. No mutable HEAD pointer or user-file replacement.
  await writeOnce(path.join(current.root, revisionName(doc.revision)), { bytes }, { expected: sha256(bytes), conflict: "Revision conflict: another edit was published" });
  return { root: current.root, document: doc, sha256: sha256(bytes) };
}
