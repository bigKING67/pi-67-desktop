# Image workbench: first run-through after P5

Status: active (2026-10-12) — fixes 1–4 in this change; 5–7 wait for the user's decisions
Owner: Claude

## Why

The user chose to try the finished workbench on a real campaign before planning P6. Before that,
Claude walked the same flow in the isolated packaged preview (library → 从图片开始 → price, brand
colour → 50-row batch → library), without generation (offline) or a real Team Chat send.

## Timings (packaged, Apple Silicon, isolated preview)

- 从图片开始 → editor ready: 1.9 s after 创建项目.
- 50-row CSV batch: 6.2 s from 生成 50 个变体 to the notice.

## Findings

1. Library card meta broke inside a date (`10月10` / `日`). Fixed: parts break only between ` · `.
2. A size derived twice gave two cards with one title. Fixed: the repeat is titled `…（2）`.
3. 图层 and the batch matches named layers by internal ids (`photo`, `→ text`). Fixed: product
   words for default ids; 属性 keeps the id the Agent uses.
4. The batch notice said where the batch is but did not go there. Fixed: `查看批次`.
5. A CSV headed in plain words (`价格,标题`) matched nothing: headers must be a layer id (never
   shown) or the layer's current words. Proposed: when a column does not match, let the person
   pick its layer in the panel (a select per column), remembered for the project.
6. 导出 holds export, sizes, 发到团队, 批量 and 模板 in one long scroll; 批量 and 模板 are not
   exports and sit last. Proposed: a separate `批量` tab (batch and template), or keep 导出 and
   add a short jump list at its top.
7. 从图片开始 fills 标题文字 with the file name (`coffee-launch`), which then prints on the poster.
   Proposed: start it empty with the placeholder `标题文字（可留空）` and add no headline when empty.

## Progress log

- 2026-10-12: run-through, findings 1–4 fixed with tests; 5–7 proposed.
- 2026-10-12: `/code-review high` on fixes 1–4, all accepted: a long title lost its size label
  when numbered (room is left for `（n）`); two specs of one size were numbered as repeats (now
  numbered by projects already under the same title); default names applied to any kind (now
  per kind) and missed the canvas labels and reference chips (now all three); the separator
  started the wrapped line (it now ends the line); a batch table matched to a layer since
  deleted still ran (refused until chosen again); `查看批次` did nothing from Chat or Settings
  (it turns to Work first); dead name entries; the card meta had no test.
- 2026-10-12: the user chose all three proposals. 5: every column of a chosen table has a select
  of text layers (`不使用` first); a choice wins over the automatic match and is remembered per
  project in local storage (headers and layer ids only). 6: a sixth Inspector tab `批量` holds
  batches and templates; 导出 keeps exports, specs, sizes and 发到团队. 7: 从图片开始 starts the
  headline empty (`标题文字（可留空）`); empty makes no headline layer (protocol `headline`
  optional; the engine requires one only for a template layout).
- 2026-10-12: `/code-review high` on 5–7, all accepted: six tabs overflowed a grid of five (the
  tab bar now gives every tab an equal share); the e2e still expected the old summary; a choice
  could be taken by an earlier column's automatic match (choices now apply first, and a layer in
  use is not offered); a header used twice shared one choice (keyed `header#2`); a table read
  while switching projects could land on the other one (read together after the file); the
  notice pointed below though the selects are above, and a blank header row had no fix; the
  product model's five-tab contract, PRODUCT and DESIGN lagged (updated); choices were keyed by
  project id alone and never pruned (now per library and project, the 100 most recent); dead
  summary code; the Agent's create tool still required a headline (optional, except with a
  template).
