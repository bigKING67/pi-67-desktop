# Image workbench: VLM review and golden eval

Status: proposed (split from P4 checkpoint 8 on 2026-10-11; nothing runs or spends until confirmed)
Owner: Claude
Started: 2026-10-11
Last updated: 2026-10-11

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

## Needs confirmation

- Which model and Provider to judge with.
- A spend cap. Estimate: 40 posters × 2 orders × ~1.5k input tokens + one image each, about
  80 calls per run; at most three runs while the rubric settles.
- Whether a passing eval should lead to a product surface (a note on candidate cards) or stay
  a development report only.

## Rollback

Nothing ships into the product from this plan without a further decision; the golden set and
eval script live under `eng/` and `docs/testing/` and can be removed.

## Progress log

- 2026-10-11: proposed after the user chose to split the VLM review from P4 checkpoint 8.
