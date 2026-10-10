# Image workbench P3: professional panels

Status: active
Owner: Claude
Started: 2026-10-09
Last updated: 2026-10-10

## Goal

Give designers direct control on top of P2: the image Inspector with five tabs
(图层 / 属性 / 候选 / 历史 / 导出), transform handles and snapping, inline text
editing, multi-select alignment, mark-and-rework, reference slots, multi-size
export presets and user fonts. Product model §6–§8 and §17 (P3 row).

## Non-goals

- Engine extensions (groups, per-layer masks, blend modes, rotation, gradients) — P4.
- Batch, templates, Work Card handoff — P5.

## Acceptance criteria

| Criterion | Target |
| --- | --- |
| Inspector | five equal-width tabs in one row; contents follow the selected object and project |
| 图层 | top-down list, visibility and lock toggles, reorder, selection synced with the canvas |
| 属性 | position, size, opacity, lock, visibility; text: words, size, colour, alignment, line height; rect: colour, radius; canvas: size and background |
| 历史 | revisions with author (人 / Agent), summary and time; `回到此修订` publishes `revert_to` |
| 导出 | original-size PNG plus presets (1:1, 3:4, 4:5, 9:16, 16:9) as derived revisions, never scaling the finished image |
| Transform | resize handles with Shift for aspect; snapping to canvas edges, centre and other objects |
| Inline text | double-click edits on the canvas; overflow refused before submit |
| Marks | N rectangles each with an instruction, sent as structured context in one message |
| References | 保留主体 / 保留风格 / 取构图 slots carried in the context and receipts |
| Fonts | a user font file added explicitly to the project and selectable for text |
| Evidence | flows B / D / E / F, keyboard access, three responsive widths, both themes, packaged screenshots |

## Checkpoints

- [x] 1. Image Inspector shell with 图层, 属性 and 历史; TitleBar shows `创作库` / project.
- [x] 2. Transform handles, snapping and multi-select alignment.
- [x] 3. Inline text editing on the canvas.
- [x] 4. Marks (mark-and-rework) and reference slots in the structured context.
- [x] 5a. 候选: candidate receipts and the compare divider.
- [x] 5b. 导出: multi-size presets as derived projects (decided 2026-10-10 over same-project
  derived revisions), multi-file export into a new directory with receipts.
- [x] 6. User fonts (engine and Host support, Inspector picker).
- [ ] 7. Authority docs, packaged verification, Windows packaged smoke (macOS done; Windows waits for a
  real Windows run).

## Rollback

Each checkpoint is renderer-additive except fonts (engine and protocol). Hiding
the image Inspector returns the P2 page; no project content is rewritten.

## Progress log

- 2026-10-09: plan created after P2 checkpoints 1–6; P2 checkpoint 7 and P1
  checkpoint 8 wait for the user's real end-to-end run.
- 2026-10-09: checkpoint 1 done. Inspector with 图层 / 属性 / 候选 / 历史 / 导出
  committed; packaged-preview screenshots of 图层, 属性 and 历史 (dark) and 属性
  (light) reviewed. Fixes from review: system revisions read `系统 · 创建项目` instead
  of the engine's English summary; canvas selection uses a two-tone outline (the
  monochrome accent vanished on white pixels in dark theme). Canvas size/background
  editing in 属性 moves to checkpoint 2 with the transform work. The packaged recheck
  found a crash (React #185) when the project opened with the Inspector already
  visible: the 图层 selector returned a fresh `[]` before the document loaded. Fixed
  with a stable empty list and a regression test; the reopen path is verified in the
  packaged preview.
- 2026-10-09: checkpoint 2 done. Pure geometry (`image-canvas-geometry.ts`: clamp,
  snap, resize with aspect, align, distribute) with unit tests; multi-select state
  (`selectedObjectIds`), resize handles, snap guides, align/distribute in 属性 and
  canvas size/background fields. Fixed on the way: drags could leave objects partly
  off-canvas (the engine refuses those, silently before); object boxes stacked in
  reverse paint order so the photo took clicks meant for text; property ranges now
  match the engine (字号 8–500, 行高 1–2); refusals read as product copy. Packaged
  preview, driven over CDP: centre snap (guide at x=540, lands at 410), Shift resize
  260×120 → 303×140, three-object 左对齐 as one revision, ⌘Z, canvas background
  change and a refused canvas width that keeps the field with the reason.
- 2026-10-10: checkpoint 3 done. `ImageInlineTextEditor` on double-click / Enter;
  `checkImageEdit` dry-runs each draft (glyphs and text layout, no revision). Packaged
  preview over CDP: a 20-character headline shows `文字放不下…`, ⌘↵ is refused and the
  draft stays; a shorter one shows `放得下`, saves as revision 23 and returns focus to the
  object; Enter then Escape restores the words with no revision. The first draft of the
  editor scrolled overflowing lines out of sight; it now grows with a dashed box outline.
  Before this, `image_project_edit` got an operation schema (malformed batches refused
  before approval, `add_asset` checked by path) and the watcher test stopped racing disk I/O.
- 2026-10-10: checkpoint 4 done. `标记` mode draws canvas-pixel regions (or frames the
  selection) with one instruction each; 属性 gives an image layer a reference role; `已附带`
  above the Composer lists what the next message carries. Marks retire only when the Host
  accepts the message that carried them (by identity, so a reworded mark stays).
  `image_generate` takes `references` with roles (at most two after the edited image,
  the engine's three-input cap) and records them in the job and receipt. Packaged preview
  over CDP: two marks and a `保留风格` reference reached the Agent as one `<image-context>`
  block (transcript shows only the words) and the marks cleared after acceptance. Fixes
  from the run: the marks list grew with each row and rescaled the canvas mid-drawing (now
  a fixed two-row scrolling list); resize handles showed but were inert in mark mode (now
  hidden). `/code-review high` then found and fixed: framed marks bleeding off the canvas
  were silently left out of the block (now clipped); the page allowed three references
  where the tool takes two (one limit, two); references keyed by asset went stale after an
  accepted candidate (now keyed by layer); leaving the page mid-send lost the retirement;
  objects still moved by keyboard in mark mode; removing the marks chip deleted the marks
  (now detaches them); the tool wrote job.json before refusing duplicate or source-less
  references.
- 2026-10-10: checkpoint 5 split; 5a done. The engine's candidate inspection now carries
  its verified execution receipt; the Host reduces it to model, quality, size and duration
  (malformed fields dropped) as an optional `receipt` on `ImageCandidateSummary`. 候选 reads
  it in words with `费用未估计 · 画面质量未核验` (no price table exists yet). `对比`, from
  the candidate row or the preview badge, splits the canvas: 当前 left, 候选 right, divider
  dragged anywhere or moved with arrow keys. Packaged check found the candidate side (and
  plain 在画布预览 before it) drawn from the 233px tile render; an inspected candidate now
  renders at the canvas edge. Labels moved below the badge; the divider is white so it
  reads in dark theme. `/code-review high` then found and fixed: compare set the latest
  revision against a stale candidate (now its base revision, labelled `修订 N`, sized from
  that render); `comparing` outlived accept/discard/project switch; renders were not
  de-duplicated; the tile stood in for the candidate while loading (now `正在准备对比…`,
  and a failed render says so); the invisible range thumb offset the divider from the
  pointer (the frame takes the pointer, the range only the keyboard); the fit math was
  duplicated (`useCanvasFit`); the receipt showed the request size, not the candidate's.
  Deferred: Host and protocol each spell the receipt limits.
- 2026-10-10: 5b done. Rules confirmed with the user: short edge kept; bands (≥90% width)
  span the new width with `cover` (`contain` when portrait and landscape swap, decided
  after the packaged 16:9 cut the product); other objects scale by the smaller axis around a
  proportional centre; overflowing text shrinks to 70% then the preset is refused. Engine
  `deriveProject` writes one revision beside the source (nothing on refusal); Host
  `image.project.derive` numbers repeats (`-2`); presets live in domain; Main
  `saveImageSet` writes a new folder with `receipt.json`. Deferred: listing a source's
  derived projects across sessions (the session list only), and Settings' check glyph,
  which uses the undefined `--accent-contrast` token (pre-existing).
- 2026-10-10: checkpoint 6 done. Decisions with the user: characters a user font lacks fall
  back to the built-in Noto Sans CJK SC (satori falls back across loaded fonts, verified);
  only the person adds fonts, the Agent may only set `font_id`. A bounds-checked parser
  (`font-parse.ts`: table directory, cmap 4/12, hmtx, name) replaces the digest-only one and
  refuses TTC/WOFF/WOFF2 and lying tables; glyph and width checks resolve per object with the
  fallback. Documents are written as `newmoney.image-project.v2` only while fonts are bound or
  used (rollback keeps other projects readable). Host `image.project.addFont` reads a staged
  `file` attachment; the Agent tool refuses `add_font` even past schema validation. Fixture:
  KaTeX_SansSerif (OFL, 19 KB). Known risk: satori still parses user fonts in the Host process
  after our parser screens them. `/security-review` found nothing reportable; `/code-review high`
  found and fixed: a font the parser accepts but satori cannot load was bound for good (now a
  sample is composed before binding); a failed "use it here" after a successful add read as a
  failed add without a refresh; staging errors went unnoticed and a .woff2 was staged before
  being refused; two weights shared one label (now `Brand Bold`); non-Roman Mac name records
  became mojibake (Windows records win, Mac only as ASCII); every read hashed every bound font
  (now only fonts text uses are loaded, the rest checked for size); the Host read the project
  only to name the font (the engine names it); duplicated staged-read code.
- 2026-10-10: checkpoint 7, macOS part. `tests/e2e/electron-image-workbench.spec.ts` drives the
  real Electron app, Agent Host and image engine with stubbed folder pickers: creative library,
  a photo project, flow B (a property, the words, an arrow-key move, ⌘Z as a new revision), D (a
  drawn and worded mark attached to the next message), E (保留风格 on the photo), a user font, F
  (a derived 4:5 and an export set whose receipt lists 800×1320 and 800×1000), then the page at
  1440 / 1180 / 960 in light and dark with no horizontal overflow (screenshots attached to the
  test). Authority docs were updated in each checkpoint's commit. Still open: the Windows x64
  packaged smoke, which needs a real Windows run.
- 2026-10-10: derived sizes listed across sessions (user-approved plan). The Host recognises a
  derived project from revision 1's summary and adds an optional `derivedFrom` to
  `ImageProjectSummary` (protocol revision regenerated); 导出 lists sizes from the library,
  older revisions marked `较旧` and kept out of the set; library cards read `派生自 <source>`.
- 2026-10-10: pushed (260f88fb..072324b2). CI run 38043710774: Build / Windows x64, Native
  smoke / Windows x64 and Windows installer lifecycle passed, which is the Windows packaged
  evidence checkpoint 7 asked for. macOS native smoke failed only in the new image e2e: CI's
  smaller screen kept the window under 1440, the Inspector became a drawer over the page and
  covered `应用`. The spec now opens the Inspector for its tabs and closes it before canvas
  work, and starts at 1180 so the drawer case runs everywhere. Also annotated
  `generateArkImages` so its declaration emits (5 non-fatal TS2883 messages in every build).

