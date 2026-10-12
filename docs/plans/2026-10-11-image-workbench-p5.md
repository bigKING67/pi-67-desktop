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

## Checkpoint 4 design (Work Card handoff; taken before 3)

Confirmed by the user 2026-10-11: a card followed by one message with the pictures (no New
Money Server change; cards keep no attachments).

- 导出 → `发到团队…` opens the shared hand-off dialog (`交给同事或频道`) with the project title,
  goal, acceptance and summary, a teammate or joined channel, an optional https link and the
  list of pictures that go with it: the revision on screen and its current sizes (at most 10).
  The privacy line says only these fields and pictures are sent — never the project, prompts or
  the conversation.
- 发送 runs the keyed-text check over the pictures first (its own dialog may stop it), renders
  each at full size, uploads them as Team Chat attachments, creates the Work Card (assigned to
  the teammate for a direct message) and then sends one message with the pictures in the same
  conversation. A failure before the card leaves nothing behind (uploaded files are discarded).
- Team Chat's composer upload is split so the per-file upload (begin, chunks, finish, discard on
  failure) is one function both callers use.
- Evidence: renderer tests for the image source and the upload function, an e2e through the
  mock Team Chat service, packaged screenshots.

## Checkpoint 3 design (brand kit and specs)

Confirmed by the user 2026-10-11: one brand kit per creative library; platform specs are the
person's own (name, size, file-size cap, background rule), none built in.

- Storage (engine `brand-kit.ts`): the library's `.newmoney/images/brand/` holds immutable
  versions `versions/000001.json`… (`newmoney.image-brand.v1`: `colors` [{id, name, value}],
  `fonts` [{id, family, file, sha256, bytes, format}], `logos` [{id, name, file, render_file,
  sha256, render_sha256, width, height}], `specs` [{id, name, width, height, max_bytes?,
  background?: "white"}]) and content-addressed `fonts/` and `assets/` files; each edit names
  the version it read, so two writers never overwrite each other. Limits: 32 colours, 8 fonts,
  16 logos, 16 specs.
- 3a: Host `image.brand.read` / `image.brand.edit` (colours, specs, removals) and
  `image.brand.addFont` / `addLogo` (staged files, like a project's fonts and masks); the
  library's `品牌库` dialog lists and edits all four.
- 3b: in a project — colour fields offer the brand swatches; the font picker offers brand fonts
  (bound into the project on use, as a user font); 图层 → `Logo` adds a brand logo as an
  image layer (top right, its longer side 20% of the short edge). The Agent reads the kit (`image_brand_read`)
  and may use its colours, fonts and logos the same way.
- 3c: 导出 lists the specs; `按规格导出` derives the size when the canvas differs (the derive rule,
  any size), then checks the PNG against the spec (exact size, file size, white background =
  every edge pixel white) along with the keyed-text check, listing what fails before saving.

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
- 2026-10-11: checkpoint 2b (the page): 导出 → 模板 (`存为模板`, `从模板新建…` dialog with text slot
  fields and image slot pickers), 属性 `可替换`, the header's `模板` mark, the library's `模板` section
  and `来自模板` meta; renderer tests and e2e (save, make a project with a new picture, slot
  unlocked and the rest locked); packaged screenshot of the dialog.
- 2026-10-11: `/code-review high` on checkpoint 2, all fixed: a misspelt slot was pruned into a
  silent success (`set_template` now refuses unknown layers; pruning is only for layers removed
  later); a slot in a locked group stayed locked in the new project (its group is unlocked);
  a staging failure in 从模板新建 had no notice; the template id could pass 64 characters on the
  second template; the id-exhausted message spoke of sizes; a replaced picture was still carried
  and copied (dropped when nothing uses it; the asset limit is a refusal); pictures were decoded
  before the slots were checked (checked first); emptied words were silently kept (refused with
  the layer named); 可替换 stayed on at 20 slots; the Agent tool resolved paths its own way.
- 2026-10-11: checkpoint 4 (Work Card handoff) done before 3, as proposed. The Team Chat hand-off
  dialog takes an optional `images` source (labels, and files made on 发送); its send path is
  `deliverHandoff` (pictures uploaded, card, then one message; uploads discarded if the card
  fails), tested against a scripted port; the composer's per-file upload is
  `uploadTeamChatFile`, shared. The image page's `handOffImages` lists the revision and its sizes
  and, on 发送, runs the keyed-text check and renders each, reading the verified PNG back as the
  page's own `app://` resource. No New Money Server change. An end-to-end run needs a signed-in
  Team Chat service, which the Electron e2e does not have; it is covered by the renderer tests,
  the packaged dialog and the user's own signed-in check.
- 2026-10-11: `/code-review high` on checkpoint 4: a failed picture message read as success (the
  controller's `send` now reports delivery; the message stays to retry and the dialog says so);
  the hand-off's text check could run beside an export and lose a decision (one at a time,
  sharing the export guard); pictures over 25 MB or with names Team Chat refuses failed late
  (names made safe, size checked before sending); pictures went without their size (sent, so
  recipients see their proportions); an empty references group showed for images (hidden); the
  text check spoke of 导出 during a send (发送 wording); the set and render steps were written
  twice (`currentSet`, `renderFull`); the target was parsed twice (`handoffTarget`); the dialog's
  stop path had no test (`handOff`, tested). Deferred: pictures are held in the renderer until
  all are rendered (up to 10); a Host-side "attach the cached PNG" command would avoid holding
  and re-sending them, and belongs with a later Team Chat change.
- 2026-10-11: checkpoint 3a: engine `brand-kit.ts` (versions under `.newmoney/brand`, fonts and
  logos by digest, conflicts on a stale version), Host `image.brand.*` (`image-brand-commands.ts`),
  protocol, the library's 品牌库 dialog. The packaged check found the add forms indented and the
  checkbox stretched by the shared modal's form and input rules (outranked in the dialog).
- 2026-10-11: checkpoint 3b: Host `image.project.useBrandFont` (binds by digest once, then sets)
  and `image.project.addBrandLogo` (top right, longer side 20% of the short edge, 4% margin —
  the plan's "15%" read small on wide logos); swatches under colour fields, brand fonts in the
  font picker, 图层 `Logo` menu; Agent `image_brand_read` (binding brand fonts and logos stays
  the person's, as with fonts).
  The packaged check found the 添加 row wrapping its labels once `Logo` joined it in the narrow
  inspector (the caption now takes only its text, labels stay on one line, the row may wrap).
  The full `check` exposed a real watcher race: a Host write's file events could be read before
  the Host recorded its revision, announcing the person's edit twice; the watcher now waits for
  the project's Host write queue to settle before reading.
- 2026-10-11: `/code-review high` on checkpoint 3b, all accepted: brand font and logo were not
  undo steps (now one each, through the controller's shared `mutateImageProject`); their
  failures read raw (the font and asset wording, conflicts included); unbound brand fonts were
  offered at the project's font limit (hidden then); the kit was read once per page and could
  belong to another library (now read when a project opens, once at a time, and offered only
  for the library it came from); inserting a logo again added another asset (reused by
  digest); id allocation was written twice (`freeId`). The first watcher fix (waiting on the
  project's queue) missed derive/batch/template writes, which hold the source's key, and held
  external changes behind renders; it is replaced by recording first: whichever of the Host and
  the watcher records a revision or candidate status first announces it, the other stays quiet,
  and a removed batch announces its source again on purpose.
- 2026-10-11: checkpoint 3c: engine `deriveProject` takes an exact `size` as well as a preset
  (first summary `… at WxH`); Host `image.project.deriveSize` (`<source>-WxH`, titled with the
  spec); the library lists such sizes with `derivedFrom` lacking a preset (the protocol field is
  now optional, its consumers sort presets first and group sizes by canvas). The renderer checks
  the spec itself from the verified PNG it already fetches for hand-offs (bytes, and edges read
  through an `OffscreenCanvas` without colour conversion), so no new check command was needed;
  failures join the keyed-text dialog. The Agent has no spec export (it does not export).
- 2026-10-11: `/code-review high` on checkpoint 3c. Accepted: a PNG that could not be read for
  the spec failed the export (now said and skipped, like the text check); the spec export and
  导出全部尺寸 could pick different projects for one size (both use `derivedSizes`); every
  refusal suggested shortening text (only a text that does not fit does); sizes under the
  64px canvas minimum passed the boundary; text shrunk for a spec size went unsaid (a notice);
  the size label leaned on the title (`规格尺寸`); the edge read drew the whole image (four
  strips), and the PNG was read with no rule needing it; the PNG fetch was written twice
  (`renderedBlob`). Deferred: a 白底 spec derived from a coloured canvas keeps that colour (the
  check lists it); making the derive turn the background white changes the design for the
  person, so it waits for a product decision.
- 2026-10-12: the deferred 白底 item, decided by the user: no automatic change on derive; the
  export check offers `改为白底后重新导出` (the canvas background white as one revision of that
  size's project — through the open project's edit path when it is open, so it is one undo
  step — then the spec exports again).
  `/code-review high`, all accepted: the fix was offered again on a canvas already white
  (empty revisions on every press; now offered once per export and only on a canvas not
  white); a conflict on the open project went unsaid (the usual notices); the fix and retry ran
  outside the export lock and could re-resolve another project (now one locked loop over the
  same member); the dialog answered through a side effect (it now answers export, cancel or
  fix); sizes derived from the open project's previous revision silently became older (said);
  raw protocol text on the other path (product wording) and a stale library (reloaded).
