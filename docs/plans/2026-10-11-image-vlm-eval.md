# Image workbench: VLM review and golden eval

Status: first run done 2026-10-12 (report only; no product surface without a further decision)
Owner: Claude
Started: 2026-10-11
Last updated: 2026-10-12

## Goal

ADR 0010 decision 7 keeps VLM output an observation marked `UNVERIFIED`, never an approval,
because judges are biased on artifacts, text, layout and position. Before any VLM review is
shown in the product, measure how often a judge is right on posters whose problems are known,
and how its answers move with order and position, so the product can say how far to trust it.

## Non-goals

- A VLM gate that blocks or approves anything (decision 7).
- Replacing the deterministic gates: protected pixels, size and alpha checks, the keyed-text OCR.
- Fine-tuning, or sending a person's projects to a model for the eval.

## Proposal

1. Golden set (engine-generated, no personal data): about 40 posters rendered from engine
   documents, each with one known defect or none — key text covered, clipped or misspelled
   (the price differs from the brief), low contrast, an object off its alignment, a generated
   layer with a visible seam or extra fingers, a cropped product — and labels written beside
   each in JSON. Low contrast doubles as the case OCR cannot catch.
2. Judge: one image-capable model reached through a configured Pi Provider (no new provider
   path), asked a fixed rubric per poster and answering in JSON with the region it means.
3. Debias: each poster judged twice with the rubric items in opposite orders, and pairwise
   questions asked in both orders; an answer that flips is reported as unstable, not as either.
4. Report: per defect kind — hit rate, false alarms on clean posters, instability — written to
   `docs/testing/` with the model, date, prompt hash and cost; results feed a decision on
   whether 候选 may show a VLM note (always labelled `未经核实`).

## Decisions (user, 2026-10-11)

- Judges: Volcengine Ark `doubao-seed-2-1-lite-260915` as the main judge, with the same set run
  on local Codex `gpt-6.1-sol` for comparison (the user named "GPT-5.6 sol"; GPT-6.1 Sol is the
  only Sol model configured). Both through Pi's `ModelRuntime.completeSimple`, from Pi's own
  configuration; no new provider path.
- Spend cap: ¥30 in total across runs. The runner estimates spend per call from token usage at
  conservative list prices and stops before a call that could pass the cap.
- Product surface: a development report only. Whether 候选 shows a VLM note is a later decision.

## Implementation

- `eng/evals/image-vlm-review/`: `golden.mjs` builds the posters with the image engine into a
  temporary folder (never committed) with their labels; `rubric.mjs` the fixed rubric in two
  orders and the JSON answer parser; `metrics.mjs` hit rate, false alarms and order
  instability; `report.mjs` the Markdown report; `run.mjs` the live runner (`--dry-run` builds
  and prints the plan without calls). Pure parts are unit-tested.
- The pairwise questions of step 3 are left out of the first run; rubric order flips measure
  position bias first.

## Rollback

Nothing ships into the product from this plan without a further decision; the golden set and
eval script live under `eng/` and `docs/testing/` and can be removed.

## Progress log

- 2026-10-11: proposed after the user chose to split the VLM review from P4 checkpoint 8.
- 2026-10-11: user confirmed Doubao Seed 2.1 lite plus GPT-6.1 Sol, ¥30, report only.
- 2026-10-12: built `eng/evals/image-vlm-review/` (`corepack pnpm run eval:image-vlm` for the unit
  tests, `eval:image-vlm:live` for a run, `--limit N` for a smoke run that stays in its run folder,
  `--rescore <run>` to score saved answers again without calls). The spend ledger lives outside
  the checkout (`~/.cache/pi67-image-vlm-eval/`), fails closed, and one run holds a lock.
- 2026-10-12: three full runs, estimated ¥12.36 in all (cap ¥30). The first two were discarded:
  a smoke run found the clipped headline also broke alignment (it now keeps its left edge and
  overflows a wider canvas cropped back); `/code-review high` found the covering band invisible
  (the background colour; now a visible sticker), failed calls read as empty replies (Pi
  reports them as a stop reason), a lenient parser, unparsed answers counted as clean passes,
  and a ledger that failed open — all fixed; the second run showed Doubao answering by question
  number, which means different questions in the two orders, so the rubric is now unnumbered.
  Report of record: `docs/testing/image-vlm-review-2026-10-11T17-02-53-733Z.md` (rubric
  `b6e63b7c0f97c747`).
  - GPT-6.1 Sol: every defect found on all 35 defect posters, no false alarm on the 10 clean
    ones, no answer flipped with order, every reply parsed.
  - Doubao Seed 2.1 lite: every defect but alignment found on every scored poster; alignment
    0 of 5 (and 9% flips on it); one call timed out; no false alarms. Across runs it also left
    3 of 90 replies empty (reasoning only), so it needs a strict parser and a silent fallback.
  - Caveats: flat synthetic posters with obvious defects, 5 per defect and 10 clean, so these
    are upper bounds with wide uncertainty; regions are not scored; real photographs, subtle
    offsets and generated-layer artefacts are untested.
  - Next, if wanted: a harder set (photo backgrounds, subtle offsets, artefacts inside a photo,
    more clean posters) and region scoring, before any decision on a 候选 note.
