# Image generation: cache and Batch (P5 step 5)

Status: active, 2026-10-11 — the user chose A (reuse on a hit, `fresh` for a new variation) and
deferred B until there is a real bulk-generation need.

## Today

- Every generation goes through Pi's `modelRegistry.generateImages()` (ADR 0010 decision 9);
  New Money's own Pi providers do one synchronous HTTP call each (`openai-images`,
  `ark-images`), with a 180 s timeout and no automatic retry.
- Each call writes a job folder (`job.json`, `prompt-pack.md`, `request.json`, inputs) and, on
  success, a receipt (model, parameters, `request_or_prompt_sha256`, output digest) and a
  candidate. Nothing is cached: the same request asked twice is paid twice.
- Cost is not recorded (`billing: UNVERIFIED`); the product model asks for a cache keyed by
  brief, parameters and reference digests, and "离线跑批可选 Batch API（后续）".

## Provider facts (checked 2026-10-11)

- OpenAI's Batch API accepts `/v1/images/generations` and `/v1/images/edits` for GPT Image
  models: a JSONL upload, results within 24 h, 50% of the online price, separate rate limits.
- Volcengine Ark's batch inference is documented for chat models; no source shows Seedream
  image generation in it. Seedream stays online-only here.
- Pi exposes only the synchronous `generateImages`; it has no batch interface.

## Proposal A — generation cache (recommended now)

- Key: SHA-256 over the canonical request — provider source and model, mode, the prompt pack
  text, size/quality/background, and the digests of the base image, references and masks. The
  key is computed from what is actually sent, so any change in input misses.
- Store: per creative library, `.newmoney/image-work/generation-cache/<key>.json` pointing at
  the receipt and output digest of the job that produced it (no prompt text in the index; the
  job folder already holds it). Entries whose job folder is gone are dropped on read.
- Hit: `image_generate` stages the cached output as a new candidate without a network call;
  its receipt says `cache_hit` with the original job id, and the card reads `复用了之前的结果`.
  The Agent passes `fresh: true` to ask for a new variation of the same request (generation is
  not deterministic, so "again" often means "another one").
- Never cached: failed or cancelled jobs, and outputs that failed normalization.
- Evidence: engine tests (key stability, every input changes the key, a missing job folder
  misses), a Host/tool test for hit and `fresh`, a packaged check of the card wording.

## Proposal B — OpenAI Batch (needs an ADR 0010 amendment)

- A batch can only be OpenAI GPT Image; it would bypass `generateImages()` with a separate
  async path in New Money's own provider package (keys still from Pi), so ADR 0010 decision 9
  must be amended first.
- Shape: the Agent (or a "批量生成" action on a batch of projects) submits N jobs as one Batch;
  the Host records it under the library, polls at a bounded interval while the app runs, and
  stages each result as a candidate when it lands (up to 24 h later); cancelling cancels the
  Batch. Restart resumes polling from the record.
- Value appears only with many generations at once; today's batches (P5 checkpoint 1) change
  text, not pixels, so there is no bulk-generation flow yet to feed it.
- Recommendation: defer until there is a real bulk-generation need; build A now.

## Out of scope

Cost accounting (prices per model and size, usage totals) — a separate plan if wanted.

## Rollback

A: delete the cache folder and the lookup; candidates already staged stay valid.

## Progress log

- 2026-10-11: proposed; the user chose A as proposed and deferred B.
- 2026-10-11: A built. No index file: each receipt records `cache_key`, and a lookup reads the
  project's `jobs/*/receipt.json` (a project holds few jobs). A hit is a new job like any other
  (job, request, inputs written) whose `output.png` is the earlier job's verified output and
  whose receipt says `client_post_attempts: 0` and `cache: {hit, source_job_id,
  source_receipt_sha256}`, so every candidate still binds to its own job and receipt. Found
  while testing: a result already accepted would stage "no raster change", and asking again
  after accepting means another one — so once any result of a key is accepted, nothing is
  reused. `image_generate` takes `fresh` and returns `reused_from_job`; the 候选 receipt line
  says `复用了之前的结果 · 未再次请求`.
- 2026-10-11: `/code-review high`, accepted: a discarded result was handed back (any decision on
  a key now stops reuse, read at lookup, not when the request was prepared); a hit on a
  transparent job failed staging (the hit carries the source's alpha, resampling and returned-
  image evidence); an output that failed to stage was replayed (only staged results are
  sources); two image sources serving one model id shared results (the source is in the key,
  the raw requested model id no longer is); a recovered job's acceptance was missed (every
  receipt of the key counts); a cancel during the lookup still staged, and a failed write left
  a claimed job (both now stop and release); receipts are read in parallel. Deferred: two
  identical requests in flight at once both pay (no in-flight claim); an index file if
  projects grow to hundreds of jobs.
