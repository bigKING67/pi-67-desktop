# Image workbench P4: engine extensions

Status: active (confirmed 2026-10-10; schema changes still need confirmation at checkpoint 2)
Owner: Claude
Started: 2026-10-10
Last updated: 2026-10-10

## Goal

Product model §8 L3 and §17 (P4 row): layer groups, per-layer masks, blend modes,
non-destructive rotation and flip, gradients and more shapes, basic adjustments
(brightness, contrast, saturation, blur), plus the OCR gate for key text and the VLM
debias / golden eval. Every new object type or field is defined in the engine schema
with shared samples first, then protocol, then UI (product model §8).

## Non-goals

- Pixel brushes, clone stamp, pen vectors, RAW development, filter marketplace (§8 non-goals).
- Batch, templates, Work Card handoff (P5).

## Constraints that shape the plan

- Rendering is satori → SVG → resvg, with Sharp for rasters. Satori renders a CSS
  subset; what it cannot express (some blend modes, masks, filters) must either be
  emitted as SVG after composition or applied per layer with Sharp before it. That
  choice decides each feature's cost, so checkpoint 1 measures it before any schema.
- Projects stay readable by earlier releases unless they use a new feature: a document
  is written with a newer schema only while it uses one (the v2 user-font rule).
- Text stays layout, never pixels; protected regions stay byte-exact on accept.

## Checkpoints

- [ ] 1. Spike: a capability matrix for rotation/flip, each blend mode, opacity and
  alpha masks, linear/radial gradients, ellipse/line, and the four adjustments through
  satori, resvg and Sharp, with render-regression fixtures; pick a path per feature and
  record it here. Nothing user-visible.
- [ ] 2. Schema proposal (needs confirmation): per-object `rotation`/`flip`, `blend`,
  `mask` (asset ref), rect `fill` gradients, `ellipse`/`line` kinds, image `adjust`,
  and `group` objects; limits, validation, shared samples, protocol mirror; the
  newer-schema-only-when-used rule.
- [ ] 3. Rotation and flip: engine, canvas handles (rotate grip, Shift for 15° steps),
  属性 fields, snapping on the rotated bounds, derive/relayout behaviour.
- [ ] 4. Shapes and gradients: ellipse and line, gradient fills in 属性.
- [ ] 5. Blend modes and opacity masks, including how candidates' protected regions
  interact with masked layers.
- [ ] 6. Adjustments on image layers (non-destructive, rendered per layer).
- [ ] 7. Layer groups: 图层 tree, move/lock/hide a group, selection and alignment.
- [ ] 8. OCR gate for key text in generated candidates, and the VLM debias / golden
  eval with a report (separate design; may move to its own plan).
- [ ] 9. Authority docs, packaged macOS verification, Windows CI evidence, Agent tool
  schema and descriptions for each new operation.

## Rollback

Each feature is additive and written only when used, so hiding its UI returns the P3
page and earlier releases still open projects that do not use it.

## Progress log

- 2026-10-10: proposal drafted after P3 checkpoints 1–6 and the macOS part of 7.
