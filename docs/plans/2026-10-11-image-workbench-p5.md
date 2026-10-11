# Image workbench P5: scale

Status: active (order and checkpoint 1 shape confirmed 2026-10-11)
Owner: Claude
Started: 2026-10-11
Last updated: 2026-10-11

## Goal

Product model §17 P5 row: batches and table-driven variants, templates, brand assets and a
spec library, Work Card handoff, and generation caching / Batch. Acceptance named there: a
measured run changing the price on 50 SKUs and rolling it back, and a handoff e2e.

## What exists

- Engine `copyVariants` (from creative-craft): copies of up to 12 source revisions with the same
  text updates, each a new project with a manifest. Not exposed to the Agent or the page.
- Derived sizes (P3): sibling projects that record their source revision in revision 1.
- The keyed-text check (P4): OCR and contrast on any render, used before export.
- Team Chat Work Cards (ADR 0003) carry a title, goal, acceptance and attachments.

## Proposed checkpoints

1. **Table-driven batch** (the acceptance case first). In a project, `批量` takes a CSV table —
   one row per variant, columns named after text layers (and optionally an image column naming
   a file per row) — and writes one sibling project per row into a batch, from the revision on
   screen, using the derive machinery (fresh history, source recorded). Each row is laid out,
   checked (overflow, keyed text, contrast) and previewed in a grid with its failures; failed
   rows write nothing. `导出批次` exports the passing rows into one folder with a receipt.
   Rollback: `撤销批次` removes the batch's projects (they are new; the source is untouched),
   and re-running the batch from a corrected table replaces it. Limits: 200 rows, 20 columns.
   The Agent gets the same operation as a tool. Evidence: a timed 50-SKU price change and
   rollback, packaged.
2. **Templates.** `存为模板` marks which layers are replaceable slots (text and image) and stores
   the template in the library; `从模板新建` and a batch can start from a template. Templates
   are projects with a slot list (schema addition, written only for templates).
3. **Brand assets and specs.** A library-level brand kit — fonts, colours, logos — offered in
   属性 and to the Agent; platform specs (size, file-size cap, background rule) that the export
   check enforces and names in its dialog.
4. **Work Card handoff.** From 导出, `发到团队` creates a Work Card in a chosen Team Chat channel
   with the export set attached (never the project, prompts or conversation).
5. **Generation cache and Batch.** Generation results keyed by brief, parameters and reference
   hashes are reused instead of re-requested; an optional offline Batch path where the Provider
   offers one.

## Checkpoint 1 design (table-driven batch)

Confirmed by the user: batch first, CSV only, a batch is a group of projects in the library.

- Engine `batchVariant`: like `deriveProject` (fresh one-revision sibling, files copied, source
  untouched) but with the canvas kept and text layers replaced by the row's values. Text that
  no longer fits shrinks in 5% steps to 70% (the derive rule, shared); past that, or with a
  glyph the fonts lack, the row is refused naming the text and nothing is written. Revision 1's
  summary records `Batch <id> row <n> from <project> revision <r>`, which the library reads
  back (as it does for derived sizes).
- Host `image.batch.create { projectId, revision, rows: [{ texts: { layerId: text } }] }` →
  `{ batchId, results: [{ row, status, projectId | reason }] }`, rows written in order under the
  project's queue; `image.batch.remove { batchId }` deletes that batch's projects (the page asks
  first and says how many were edited since). Limits: 200 rows, 20 text layers per row, 2000
  characters per cell. Image columns come later.
- The page: 导出 gains `批量`: choose a CSV (parsed in the renderer: RFC 4180 quoting, UTF-8 with
  or without BOM, comma or tab), columns matched to text layers by layer id or by the layer's
  current words, unmatched columns shown and ignored, then `生成 N 个变体`; results list each
  row (passed, shrunk, refused with the reason) with thumbnails; `导出批次` exports passing rows
  into one folder after the keyed-text check; `撤销批次` removes the batch.
- Library: a batch shows as one card (`批次 · <title> · N 个`) that opens to its projects.
- Agent: `image_batch` with rows inline (same limits), returning the per-row results.
- Evidence: a 50-row price change and its removal timed in the packaged app; engine, Host,
  protocol, Agent, renderer (CSV parsing and matching) tests and e2e.

## Checkpoint 2 design (templates)

Confirmed by the user 2026-10-11: a template is a copied project with marked slots, a project
made from it locks every layer that is not a slot, and image slots come in this checkpoint.

- Schema (v3, written only on templates): document `template: { slots: [layer ids] }`, up to 20
  text or image layers. `set_template { slots | null }` edits the slots (null makes it a plain
  project again); slots whose layer is removed drop out by themselves.
- `存为模板` copies the revision on screen into a sibling template project
  (`Template from <project> revision <r>`), slots preset to every text and image layer.
- `从模板新建` asks for a title, each text slot's words (prefilled) and, per image slot, an
  optional new picture (staged through Main like a photo, laid in with the slot's box and fit);
  the new project (`From template <template> revision <r>`) carries no template field, its slots
  unlocked and every other layer locked. Text fits and is refused like a batch row.
- A batch run on a template makes instances the same way (no template field, non-slots locked).
- One engine core writes every variant (batch row or instance): texts, images, the lock rule,
  fitting and the sibling write.
- Host `image.template.create`, `image.template.instantiate`; the library lists templates in
  their own row (`模板`) and marks projects made from one (`来自模板 …`). Agent: `set_template`
  in `image_project_edit` and `image_from_template` (image slots from local files).
- Evidence: engine (slots, locks, image slot replacement, schema), Host, protocol, Agent,
  renderer and e2e; packaged screenshots of the template row, the 属性 slot toggle and the
  新建 dialog.

## Rollback

Each checkpoint is additive; the batch writes only new sibling projects and export folders, so
removing the feature leaves every existing project as it was.

## Progress log

- 2026-10-11: proposed after P4 and the follow-up contrast check.
- 2026-10-11: user confirmed batch first, CSV only, a batch as a group of library projects.
- 2026-10-11: checkpoint 1a (engine, Host, protocol, Agent). The derive machinery's text fitting
  and sibling writing are shared (`sibling-project.ts`); `batchVariant` writes one row and
  `createBatch` a whole table (shared by the Host and the Agent's `image_batch`); rows are sent as
  `{ layer, text }` pairs (the protocol's schema helper has no records); `image.batch.remove`
  deletes the batch's projects and their work folders; the library reads `batch` from revision
  1's summary. Measured in the Host test: 50 SKUs (title and price) created in 3.1 s and removed
  in 0.9 s on an Apple Silicon Mac. The page (1b) is next.
- 2026-10-11: checkpoint 1b (the page). CSV parsing and column matching in the renderer
  (`image-batch-table.ts`), batch state and actions (`image-project-batch.ts`), 导出 → 批量, the
  library's batch card and batch view, removal through the shared destructive dialog; export
  sets share one `exportProjectSet` (sizes and batches); library reloads after Host events are
  debounced (a batch announces every project) and only one cover per batch is drawn. Packaged
  macOS (1080×1670 poster with a photo, so each row copies the photo): 50 SKUs created in
  11.4 s from the click, removed in 7.9 s from the confirmation, timed through CDP. The packaged
  check found a crash when the open batch view lost its last project (fixed: the library falls
  back to all projects).
- 2026-10-11: `/code-review high` on checkpoint 1, all fixed: exporting a batch of more than 6
  failed in Main (the export-set limit was sizes + 1; now the larger of that and the batch row
  limit, tested at 200 and 201); the panel lost its table and refusals on every tab switch and
  could show another project's run (state now kept per project); refusals named filtered row
  positions instead of table rows (rows carry their table number; rows with nothing to change
  are listed as skipped); removal was announced nowhere (the source is announced, so other
  windows reload); an open batch view kept stale thumbnails (redrawn when a row's revision
  moves); engine and file-system messages reached the page in English with paths (product
  words; empty texts refused as such and by the schemas); a tab-separated header holding
  commas split on commas (a tab now always wins); each row re-read and re-validated the source
  (read once per batch); removal scanned the whole library (only `<source>-<batch>-<row>` names,
  each checked against its first revision); batch grouping was written five times (one
  `batchGroups` helper).
- 2026-10-11: checkpoint 2a (engine, Host, protocol, Agent). `template` (v3) with `set_template`,
  slots pruned with their layers and restored by revert; one variant core (`variant.ts`) writes
  batch rows and template instances (texts, imported pictures, the lock rule, fitting; new
  pictures saved beside the copied files); `createTemplate` / `instantiateTemplate`; Host
  `image.template.create` / `.instantiate` (staged pictures through one work folder, removed
  afterwards) and `template` / `fromTemplate` in the listing; Agent `set_template`,
  `template_slots` in reads and `image_from_template`. The Host file passed the 460-line limit,
  so the listing and lineage (`image-project-list.ts`), batch and template commands
  (`image-variant-commands.ts`) and shared helpers (`image-host-support.ts`) moved out.
