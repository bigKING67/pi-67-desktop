# Pi-67 Support Ingest

This Cloudflare Worker is the only remote write boundary for user-initiated Pi-67
support diagnostics. It accepts the fixed `pi67-support-submission.v1` body at
`https://support.52671314.xyz/v1/diagnostics`, validates redacted v5 and v6 documents,
and writes to the private `pi67-support-diagnostics` R2 binding.

The Desktop never receives R2 credentials, never chooses an object key, and never
uploads automatically. The update origin and `pi67-desktop-updates` bucket remain
separate. Worker errors must not log request bodies or diagnostics.

## Free-tier guardrails

- Use R2 Standard storage only. Do not enable Infrequent Access, Data Catalog, SQL,
  event notifications, Queues, Analytics Engine, or another metered service.
- The shared contract rejects a complete submission larger than 64 KiB.
- One global SQLite-backed Durable Object stores only the last admitted UTC minute.
  Its transaction is the exact new-report admission boundary; at most one new report
  per minute reaches R2. Workers Free exhausts Durable Object requests, rows, or
  duration by failing further operations instead of converting them into paid usage.
- Diagnostic object writes use an actual `If-None-Match: *` conditional header. Do
  not replace it with `R2Conditional.etagDoesNotMatch: "*"`: the latter compares a
  literal ETag and does not express object absence.
- At a continuously saturated rate this is at most 43,200 accepted diagnostic
  objects and 2.64 GiB of raw retained bytes across 30 days.
- That envelope is intentionally below the current R2 free allowances of 10 GB-month
  Standard storage, one million Class A operations, and ten million Class B
  operations. At saturation, one diagnostic write per accepted report is at most
  43,200 Class A operations per 30 days. The Durable Object retains one tiny row;
  the margin is deliberate.
- Keep the account on Workers Free. Do not enable Workers Paid or any automatic
  paid upgrade for this service. Workers Free exhaustion must fail closed.
- Budget alerts are informational only and are not a spend cap. Check the R2 and
  Workers usage dashboards after deployment and before increasing either bound.

## Deployment and operation boundary

The initial production deployment was completed and read back on 2026-08-29 under an
explicit Workers/R2 free-tier-only authorization. Its accepted baseline is:

- the account and zone remain on their Free plans;
- `pi67-support-ingest` exposes only the custom Support domain and keeps `workers.dev`,
  Workers Logs, and Workers Traces disabled;
- `pi67-support-diagnostics` is private Standard R2 with no `r2.dev` URL or bucket
  custom domain;
- `diagnostics/` expires after 30 days;
- one SQLite-backed Durable Object owns exact per-minute admission;
- production returned `201` for the first synthetic report, `429` for a different
  report in the same minute, and `200` for an exact duplicate; private readback passed,
  and every synthetic object was deleted afterward.

Every future deployment is still an external write and needs current authorization.
Before deploying, confirm the account remains on Workers Free, the bucket remains
private Standard, the lifecycle is unchanged, and current account-wide R2 usage leaves
room under the free allowance. After deploying, repeat the fixed error, admission,
duplicate, private-readback, and cleanup checks with one small synthetic document. Keep
operator/API credentials outside the repository.

Routine reads use a separate bucket-scoped R2 `Object Read only` token at
`~/.config/pi67/support-r2-read.env` (mode `0600`) and the local exact-key command:

```text
corepack pnpm run support:diagnostics:read -- --object-key diagnostics/YYYY/MM/DD/PI67-XXXXXXXXXXXX.json
```

The command issues one `GetObject`, enforces the 64 KiB limit, validates the shared
submission contract and SHA-256, and prints bounded classified evidence rather than
the full document. It has no list, write, delete, or lifecycle operation. Creating or
revoking its token and reading a user-supplied report still require current operator
authorization; do not reuse update-bucket write credentials.

Before a distributed Candidate enables the Desktop path, recheck the live deployment;
do not treat this historical receipt as permanent production or billing truth.
