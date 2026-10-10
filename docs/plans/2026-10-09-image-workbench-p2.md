# Image workbench P2: basic workbench

Status: active
Owner: Claude
Started: 2026-10-09
Last updated: 2026-10-09

## Goal

Give users a visible image product: the `图像` rail entry, the creative library,
and a project page with a read-only canvas, a bottom dock (candidates and the
project conversation), direct text and position edits, candidate accept or
discard, and original-size export. Product model §5–§7 and §17 (P2 row);
decisions in ADR 0010.

## Non-goals

- Transform handles, snapping, inline text editing, multi-select, reference
  slots, mark-and-rework, user fonts, multi-size export (P3).
- The five-tab image Inspector (P3); P2 keeps the existing Inspector shell.
- Image processing without a project (flow G), Work Card handoff (P5).

## Acceptance criteria

| Criterion | Target |
| --- | --- |
| Entry | `图像` sits above `搜索对话` in Work mode only; selecting it opens the creative library |
| Library location | chosen once on first open; Windows prefills a non-system drive; the library is a trusted Workspace hidden from the folder tree |
| Flow A | from `从图片开始` to an accepted candidate and an exported PNG in ≤ 5 minutes on the local gateway |
| Direct edit | a title text change and a drag move each commit one revision; ⌘Z is `revert_to` |
| Conflict | a stale `baseRevision` refreshes the canvas and keeps the user's change as a resubmittable draft |
| Protected pixels | 0 bytes changed in protected regions across accepted candidates (engine QA) |
| States | empty, loading, error and long-data states for library, canvas and candidates |
| Evidence | packaged preview screenshots (path / size / sha256) light and dark; Windows packaged smoke |

## Checkpoints

- [x] 1. Creative library location: Main persists the library path, first-open
      picker with a non-system-drive prefill on Windows, library registered as a
      trusted Workspace that the folder tree never lists.
- [x] 2. Protocol and Host: `image.project.createFromPhoto` from a staged image
      attachment (the renderer never sends a path); export is a full-size
      `image.project.render` plus Main's digest-verified `pi67:image-save`, so no
      second render command; protocol revision.
- [x] 3. Renderer `图像` entry and library view: card grid (thumbnail, title,
      size, revisions, pending candidates, updated), sort by recent, empty state
      with `新建图像项目` and `从图片开始`.
- [x] 4. Project page: read-only canvas from content-addressed previews, fit and
      zoom, selection highlight; bottom dock with the candidate strip and the
      project conversation carrying the structured image context.
- [x] 5. Direct edits: text and position edits as revision batches (300 ms
      coalescing), undo/redo as `revert_to`, conflict draft handling.
- [x] 6. Candidates and export: preview, accept, discard, stale handling;
      export original size with the receipt listed.
- [ ] 7. Authority docs (PRODUCT, DESIGN), packaged visual verification, flow A
      end to end with a real request, Windows packaged smoke. Flow A done 2026-10-10;
      Windows packaged smoke waits for CI after push.

## Rollback

Each checkpoint is additive. The `图像` entry is a renderer surface over existing
commands; removing it leaves conversations, Workspaces and image tools intact.
The library Workspace is an ordinary Workspace marked hidden; unmarking it shows
it in the tree, and no project content is ever deleted by Desktop.

## Risks and unknowns

- Hiding a Workspace from the tree touches Workbench persistence and the folder
  tree; it must not change behaviour for existing Workspaces.
- Canvas preview latency on 2K canvases (target ≤ 300 ms edit to refresh).
- The project conversation needs the library Workspace's Pi session; session
  identity across project switches must stay stable.

## Progress log

- 2026-10-09: plan created after P1 checkpoints 1–7 and the image sources plan;
  P1 checkpoint 8 (real request) is waiting on the user's local gateway source.
- 2026-10-09: checkpoints 1-2 complete. No hidden-Workspace precedent existed
  (chat mode is layout only), so the library is an ordinary registered Workspace
  named by the optional Main-owned `imageLibraryWorkspaceId` (the
  `conversationDefaults` pattern, no state version bump); layout updates cannot
  set it and removing the Workspace clears it. Registering never makes the
  library the current or an expanded Workspace. Windows prefills the first
  non-system drive. Next: checkpoint 3 (renderer entry, tree filtering, library).
- 2026-10-09: checkpoints 3 and 5 complete; 4 and 6 partly (canvas, candidate strip,
  accept/discard and export done; the dock conversation is not). Verified in the packaged
  app through an isolated preview seeded with a library and two projects: library cards,
  project page, a text edit (revision 3, author `human`), stale candidate handling and
  undo (revision 4 restores the headline). Found while verifying: create-photo refused
  most real photos (fixed by fitting the canvas), uneven card widths, an overflowing
  canvas. Open decision: the app renders one live conversation (the selected task), so a
  dock conversation means making the project's library conversation the selected task
  while the image page is open; proposed to the user before implementing.
- 2026-10-09: checkpoints 4 and 6 complete after the user chose the embedded
  conversation. Opening a project selects its library conversation (a draft until the
  first message; the Host then remembers it in the work folder), and the dock renders
  the ordinary transcript and composer; prompts carry `<image-context>`, hidden again in
  the transcript. Verified in the packaged app: the draft conversation and composer
  appear in the dock and `图像` stays open. Not verified: a real message from the dock
  (offline preview has no model); the TitleBar still shows the conversation title, not
  the project (product model §5.4, left for P3). Next: checkpoint 7 with the user's
  real models (flow A end to end, also P1 checkpoint 8) and Windows packaged smoke.
- 2026-10-10: real end-to-end run in the packaged macOS preview (isolated profile reusing the
  user's local gateway Provider through an `!command` key; no key copied). Settings → 图像生成
  added `newmoney-images-codex/gpt-image-2.5-sunburst`; the project-page conversation (GPT-5.5)
  read the project, listed the source, unlocked the photo as its own revision, generated an
  edit candidate in 28 s (one approval), the person previewed and accepted it (revision 22,
  `accept_candidate`) and exported a verified 1080×1670 PNG. The run found and fixed, in order:
  `image_models` treating a guessed Provider as "nothing configured"; `image_generate` needing a
  hand-authored Image Job v2 (now an intent, ADR 0010 decision 15); photos off the model's 16px
  grid being unusable (exact-ratio request + resample); a 0.04% gateway size drift failing the
  run (0.5% tolerance); an opaque failure message; the creative library leaking into the
  TitleBar after restart (recovery fallback); the preview badge outliving an accepted candidate.
  Deferred: `image_project_edit` has no operation schema, so the Agent guessed six shapes before
  the `TARGET_LOCKED` hint showed the right one; Provider model discovery reads keys only from
  auth.json, so a Provider whose key lives in models.json cannot list models.
