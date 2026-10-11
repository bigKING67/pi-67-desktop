import * as fs from "node:fs/promises";
import path from "node:path";
import { IMAGE_BRAND_LIMITS, type ImageBrandColor, type ImageBrandFont, type ImageBrandKit, type ImageBrandLogo, type ImageBrandSpec } from "@pi67/domain";
import { errorCode, fail, sha256, writeOnce } from "./content-store.js";
import { color, id, isRecord, LIMITS, number, record, string } from "./document.js";
import { inspectUserFont } from "./font.js";
import { importRaster, readBytes, regularPath, saveAsset } from "./raster.js";

// P5 checkpoint 3: the creative library's one brand kit — colours, fonts, logos and the person's
// own export specs — kept beside the projects as immutable versions, like a project's revisions.

export const BRAND_SCHEMA = "newmoney.image-brand.v1";
export type BrandKit = ImageBrandKit;
const FONT_BYTES = 20_000_000;

/** The kit's folder in a Workspace: `.newmoney/brand`, beside the projects and never one of them. */
export const brandRoot = (cwd: string): string => path.join(cwd, ".newmoney", "brand");
const versionName = (revision: number): string => path.join("versions", `${String(revision).padStart(6, "0")}.json`);
const empty = (): BrandKit => ({ schema: BRAND_SCHEMA, revision: 0, colors: [], fonts: [], logos: [], specs: [] });

/** The latest version, or an empty kit (revision 0) before the first edit. */
export async function readBrand(cwd: string): Promise<BrandKit> {
  const root = brandRoot(cwd);
  let names: string[];
  try { names = (await fs.readdir(path.join(root, "versions"))).filter((name) => /^\d{6}\.json$/u.test(name)).sort(); }
  catch (error) { if (errorCode(error) === "ENOENT") return empty(); throw error; }
  const latest = names.at(-1);
  if (!latest) return empty();
  const kit = validateBrand(JSON.parse((await readBytes(path.join(root, "versions", latest), 1_000_000)).toString("utf8")));
  if (kit.revision !== Number(latest.slice(0, 6))) fail("Brand version does not match its file");
  return kit;
}

/** A file the kit binds (a font or a logo's render), verified against its digest. */
export async function brandFile(cwd: string, file: string, expected: string): Promise<string> {
  const target = path.join(brandRoot(cwd), file);
  const bytes = await readBytes(await regularPath(target), LIMITS.renderBytes);
  if (sha256(bytes) !== expected) fail("Brand file digest mismatch");
  return target;
}


/**
 * Applies edits on the version the caller read and publishes the next one; a writer who read an
 * older version gets a conflict instead of overwriting. Fonts and logos come from local paths
 * (the Host's staged copies or the Agent's Workspace files), stored by digest.
 */
export async function editBrand(cwd: string, input: unknown): Promise<BrandKit> {
  record(input, ["base_revision", "operations"], "brand edit");
  number(input.base_revision, "base revision", 0, 1_000_000, true);
  const current = await readBrand(cwd);
  if (input.base_revision !== current.revision) fail(`Brand conflict: expected ${current.revision}, received ${input.base_revision}`);
  if (!Array.isArray(input.operations) || !input.operations.length || input.operations.length > 32) fail("Invalid brand operations");
  const root = brandRoot(cwd), kit: BrandKit = structuredClone(current);
  const writes: (() => Promise<void>)[] = [];
  for (const op of input.operations) {
    if (!isRecord(op)) fail("Invalid brand operation");
    switch (op.type) {
      case "set_color": { record(op, ["type", "color"], "brand operation"); kit.colors = upsert(kit.colors, validateColor(op.color)); break; }
      case "set_spec": { record(op, ["type", "spec"], "brand operation"); kit.specs = upsert(kit.specs, validateSpec(op.spec)); break; }
      case "remove_color": case "remove_spec": case "remove_font": case "remove_logo": {
        record(op, ["type", "id"], "brand operation"); id(op.id, "brand item id");
        const key = ({ remove_color: "colors", remove_spec: "specs", remove_font: "fonts", remove_logo: "logos" } as const)[op.type];
        const list = kit[key] as { id: string }[];
        if (!list.some((item) => item.id === op.id)) fail(`Unknown brand item: ${op.id}`);
        (kit[key] as { id: string }[]) = list.filter((item) => item.id !== op.id);
        break;
      }
      case "add_font": {
        record(op, ["type", "source"], "brand operation"); string(op.source, "font source", 4096);
        const bytes = await readBytes(await regularPath(op.source), FONT_BYTES);
        const { format, family } = inspectUserFont(bytes), digest = sha256(bytes);
        if (kit.fonts.some((font) => font.sha256 === digest)) fail("This font is already in the brand kit");
        const font: ImageBrandFont = { id: nextId(kit.fonts, "font"), family, file: `fonts/${digest}.${format}`, sha256: digest, bytes: bytes.length, format };
        kit.fonts.push(font);
        writes.push(async () => { await fs.mkdir(path.join(root, "fonts"), { recursive: true }); await writeOnce(path.join(root, font.file), { bytes }, { expected: digest }); });
        break;
      }
      case "add_logo": {
        record(op, ["type", "name", "source"], "brand operation"); string(op.source, "logo source", 4096);
        const name = brandName(op.name);
        const imported = await importRaster({ id: nextId(kit.logos, "logo"), source: op.source });
        if (kit.logos.some((logo) => logo.sha256 === imported.asset.sha256)) fail("This logo is already in the brand kit");
        const { asset } = imported;
        kit.logos.push({ id: asset.id, name, file: asset.file, render_file: asset.render_file, sha256: asset.sha256, render_sha256: asset.render_sha256, width: asset.width, height: asset.height });
        writes.push(async () => { await fs.mkdir(path.join(root, "assets"), { recursive: true }); await saveAsset(root, imported); });
        break;
      }
      default: fail(`Unsupported brand operation: ${String(op.type)}`);
    }
  }
  kit.revision = current.revision + 1;
  const next = validateBrand(kit);
  for (const write of writes) await write();
  const bytes = Buffer.from(`${JSON.stringify(next, null, 2)}\n`);
  await fs.mkdir(path.join(root, "versions"), { recursive: true });
  await writeOnce(path.join(root, versionName(next.revision)), { bytes }, { expected: sha256(bytes), conflict: "Brand conflict: another edit was published" });
  return next;
}

const upsert = <T extends { id: string }>(list: T[], item: T): T[] => list.some((entry) => entry.id === item.id) ? list.map((entry) => entry.id === item.id ? item : entry) : [...list, item];
function nextId(list: readonly { id: string }[], prefix: string): string {
  let next = `${prefix}-1`;
  for (let index = 2; list.some((item) => item.id === next); index++) next = `${prefix}-${index}`;
  return next;
}
function brandName(value: unknown): string {
  string(value, "brand item name", IMAGE_BRAND_LIMITS.name);
  if (!value.trim()) fail("A brand item needs a name");
  return value.trim();
}
function validateColor(value: unknown): ImageBrandColor {
  record(value, ["id", "name", "value"], "brand colour"); id(value.id, "colour id"); color(value.value);
  return { id: value.id, name: brandName(value.name), value: value.value };
}
function validateSpec(value: unknown): ImageBrandSpec {
  record(value, ["id", "name", "width", "height", "max_bytes", "background"], "brand spec"); id(value.id, "spec id");
  number(value.width, "spec width", 64, 8192, true); number(value.height, "spec height", 64, 8192, true);
  if (value.width * value.height > LIMITS.pixels) fail("Spec size is past the canvas limit");
  if (value.max_bytes !== undefined) number(value.max_bytes, "spec file size", 1024, 100_000_000, true);
  if (value.background !== undefined && value.background !== "white") fail("Invalid spec background");
  return { id: value.id, name: brandName(value.name), width: value.width, height: value.height,
    ...(value.max_bytes === undefined ? {} : { max_bytes: value.max_bytes }), ...(value.background === undefined ? {} : { background: "white" as const }) };
}

function validateBrand(value: unknown): BrandKit {
  record(value, ["schema", "revision", "colors", "fonts", "logos", "specs"], "brand kit");
  if (value.schema !== BRAND_SCHEMA) fail("Unsupported brand kit schema");
  number(value.revision, "brand revision", 0, 1_000_000, true);
  const list = <T>(items: unknown, limit: number, label: string, check: (item: unknown) => T): T[] => {
    if (!Array.isArray(items) || items.length > limit) fail(`At most ${limit} brand ${label}`);
    const seen = new Set<string>();
    return items.map((item) => { const valid = check(item) as T & { id: string }; if (seen.has(valid.id)) fail(`Duplicate brand ${label} id`); seen.add(valid.id); return valid; });
  };
  const colors = list(value.colors, IMAGE_BRAND_LIMITS.colors, "colours", validateColor);
  const specs = list(value.specs, IMAGE_BRAND_LIMITS.specs, "specs", validateSpec);
  const fonts = list(value.fonts, IMAGE_BRAND_LIMITS.fonts, "fonts", (item): ImageBrandFont => {
    record(item, ["id", "family", "file", "sha256", "bytes", "format"], "brand font"); id(item.id, "font id"); string(item.family, "font family", 64);
    if (item.format !== "ttf" && item.format !== "otf") fail("Invalid brand font format");
    if (typeof item.sha256 !== "string" || item.file !== `fonts/${item.sha256}.${item.format}`) fail("Invalid brand font path");
    number(item.bytes, "font bytes", 1, FONT_BYTES, true);
    return item as unknown as ImageBrandFont;
  });
  const logos = list(value.logos, IMAGE_BRAND_LIMITS.logos, "logos", (item): ImageBrandLogo => {
    record(item, ["id", "name", "file", "render_file", "sha256", "render_sha256", "width", "height"], "brand logo"); id(item.id, "logo id"); brandName(item.name);
    if (typeof item.render_sha256 !== "string" || item.render_file !== `assets/${item.render_sha256}.png` || typeof item.file !== "string" || !item.file.startsWith(`assets/${String(item.sha256)}.`)) fail("Invalid brand logo path");
    number(item.width, "logo width", 1, 16_384, true); number(item.height, "logo height", 1, 16_384, true);
    return item as unknown as ImageBrandLogo;
  });
  return { schema: BRAND_SCHEMA, revision: value.revision, colors, fonts, logos, specs };
}
