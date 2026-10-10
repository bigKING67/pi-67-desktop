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

- [x] 1. Spike: a capability matrix for rotation/flip, each blend mode, opacity and
  alpha masks, linear/radial gradients, ellipse/line, and the four adjustments through
  satori, resvg and Sharp, with render-regression fixtures; pick a path per feature and
  record it here. Nothing user-visible.
- [x] 2. Schema proposal (needs confirmation): per-object `rotation`/`flip`, `blend`,
  `mask` (asset ref), rect `fill` gradients, `ellipse`/`line` kinds, image `adjust`,
  and `group` objects; limits, validation, shared samples, protocol mirror; the
  newer-schema-only-when-used rule.
- [x] 3. Rotation and flip: engine, canvas handles (rotate grip, Shift for 15° steps),
  属性 fields, snapping on the rotated bounds, derive/relayout behaviour.
- [x] 4. Shapes and gradients: ellipse and line, gradient fills in 属性.
- [ ] 5. Blend modes and opacity masks, including how candidates' protected regions
  interact with masked layers.
- [ ] 6. Adjustments on image layers (non-destructive, rendered per layer).
- [ ] 7. Layer groups: 图层 tree, move/lock/hide a group, selection and alignment.
- [ ] 8. OCR gate for key text in generated candidates, and the VLM debias / golden
  eval with a report (separate design; may move to its own plan).
- [ ] 9. Authority docs, packaged macOS verification, Windows CI evidence, Agent tool
  schema and descriptions for each new operation.

## Spike results (checkpoint 1, 2026-10-10)

Measured by rendering each case through satori 0.35 → resvg and sampling pixels.

| Feature | satori | resvg (hand SVG) | Sharp (per layer) | Path |
| --- | --- | --- | --- | --- |
| Rotation (any angle), flip | `transform` works, text and images | — | works | satori style |
| Linear / radial gradients | `backgroundImage` works | — | — | satori style |
| Ellipse | `borderRadius: 50%` works | — | — | satori style |
| Brightness, contrast, saturation, grayscale, blur | `filter` emitted as SVG filters, rendered | — | works | satori style |
| Gradient opacity mask | `maskImage: linear-gradient` works | — | — | satori style |
| Blend modes | **ignored** (top layer only) | `mix-blend-mode` correct (multiply, screen, overlay, difference, color, luminosity) | composite blends | assembly |
| Image (bitmap) mask | **`maskImage: url()` blanks the layer** | `<mask><image>` correct | `dest-in` | assembly |

Decision: keep satori for each object's layout and pixels (text stays vector, measurement
unchanged) but render objects as separate layers and **assemble one SVG**, wrapping a layer in
`<g style="mix-blend-mode:…" mask="url(#…)">` where it uses those. Verified: a multiply-blended,
bitmap-masked layer over a base composites correctly and text stays paths. Assembly must
namespace each layer's ids — satori reuses the same ids in every render (7 ids, 3 distinct in
the probe), which would cross-wire gradients, clips and masks. Objects without blend or mask
can share one satori pass, so the common case keeps today's cost.

## Rollback

Each feature is additive and written only when used, so hiding its UI returns the P3
page and earlier releases still open projects that do not use it.

## Progress log

- 2026-10-10: proposal drafted after P3 checkpoints 1–6 and the macOS part of 7.
- 2026-10-10: checkpoint 1 done (spike in a scratch directory, nothing in the product). See
  "Spike results": everything but blend modes and bitmap masks works in satori; those two go
  through per-layer SVG assembly, which resvg composites correctly.
- 2026-10-10: checkpoint 2 design confirmed by the user: all fields optional and written only
  when used (v3 once any is used); `rotation` (−180…180) and `flip_x`/`flip_y`, `blend`
  (16 modes), `mask: {asset_id, invert}` on every object; rect/ellipse `gradient` (linear or
  radial, 2–5 stops); new `ellipse` kind (a line is a thin rotated rect); image `adjust`
  (brightness, contrast, saturation, blur); flat groups (`groups` list with name, lock,
  visibility, opacity; objects carry `group_id`; no nesting); rotation constrains only the
  unrotated box, corners past the canvas are clipped. Each checkpoint opens only its own
  fields; the engine refuses a field until its rendering exists.
- 2026-10-10: checkpoints 2 (framework) and 3 done. Engine: `SCHEMA_V3` written only while a P4
  field is used; `OPTIONAL_COMMON` fields can be added by patch and dropped with null / 0 /
  false so documents stay canonical; rotation and flips render as a satori transform about the
  box centre. Domain/protocol mirror it (parity test), the Agent's edit schema and read output
  carry it. UI: rotated outlines, a rotate grip (Shift 15°), `[` / `]`, `旋转 °` and flip toggles;
  the eight resize handles hide on a turned object. Snapping still uses the unrotated box.
- 2026-10-10: `/code-review high` on checkpoint 3, all fixed: text turned about its natural
  height instead of its declared box (explicit transform origin, regression test with a tall
  box); Shift+`[` / `]` never matched (keys by position now); `add_object` with `rotation: 0`
  failed (optional no-op fields dropped on add too); an optional-only patch that changed
  nothing published an empty revision (refused, and fields skip equal numbers); the grip
  clipped near the top of the well (hangs below there) and the angle readout turned with the
  box (upright now); the grip's centre comes from the fit, not a DOM query; protocol and Agent
  tests for rotation/flip; shared `rotateStyle`, a field `fallback`, a flip label map.
- 2026-10-10: checkpoint 4 done. Engine `ellipse` kind and rect/ellipse `gradient` (linear with
  angle or radial, 2–5 ordered stops; validated), rendered by satori as `borderRadius: 50%` and
  `backgroundImage`; both make a document v3; relayout keeps ellipses. Domain/protocol/Agent
  schemas and read output carry them. UI: 图层 adds text, rectangles and ellipses centred and
  selected (there was no way to add an object before); 属性 has a 填充 control with two-stop
  gradient editing. Lines stay thin rotated rects (decided at checkpoint 2).
- 2026-10-10: `/code-review high` on checkpoint 4, all fixed: 添加 was hidden on a project with
  no layers; re-choosing a gradient type kept an Agent's many stops (now first and last, so
  it becomes editable, as the hint says); 颜色 stayed editable under a gradient although not
  drawn (hidden then); a radial gradient ended at the box corners (satori ignores
  `farthest-side`, so the radii are explicit: `ellipse 50% 50% at 50% 50%`, edge test); 添加
  ignored conflicts (now the shared notice); the linear-only angle is a schema union in
  protocol and the Agent schema; one `OPTIONAL_FIELDS` table (with v3 fields and kinds) drives
  validation, patching and the schema version, guarded against prototype names; one kind
  label map, so the canvas no longer calls rectangles and ellipses 形状.

