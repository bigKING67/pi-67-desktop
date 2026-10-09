# Image workbench P3: professional panels

Status: active
Owner: Claude
Started: 2026-10-09
Last updated: 2026-10-09

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
- [ ] 3. Inline text editing on the canvas.
- [ ] 4. Marks (mark-and-rework) and reference slots in the structured context.
- [ ] 5. 候选 and 导出 tabs: candidate receipts, comparison, multi-size export presets.
- [ ] 6. User fonts (engine and Host support, Inspector picker).
- [ ] 7. Authority docs, packaged verification, Windows packaged smoke.

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
