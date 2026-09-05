# Support diagnostics operator read

This is the operator contract for reading private Pi-67 support reports.
Read it before credential setup, report access, or changes
to the reader in `eng/support/read-support-diagnostics.mjs`. The command below
builds the local support-contract package before reading the remote object; it is
not a zero-write local configuration probe.

## Support diagnostics operation

- Routine private-report diagnosis uses the local exact-key reader before any
  Cloudflare dashboard or browser workflow:
  `corepack pnpm run support:diagnostics:read -- --object-key <receipt-object-key>`.
  For an older receipt without an object key, use
  `--report PI67-XXXXXXXXXXXX --date YYYY-MM-DD` with the known UTC object date.
- The reader is fixed to the private `pi67-support-diagnostics` bucket, performs
  exactly one `GetObject`, downloads at most 64 KiB, validates the shared schema,
  object locator, and diagnostics SHA-256, and prints only a bounded analysis.
  It must not grow a default list, search, dump-all, write, delete, or lifecycle
  mode. Browser/dashboard access is a separately justified fallback, not the
  routine read path.
- Store the bucket-scoped Cloudflare R2 `Object Read only` credential outside Git
  at `~/.config/pi67/support-r2-read.env` with mode `0600`. The only accepted keys
  are `PI67_SUPPORT_R2_ACCOUNT_ID`, `PI67_SUPPORT_R2_ACCESS_KEY_ID`, and
  `PI67_SUPPORT_R2_SECRET_ACCESS_KEY`. Never put their values in `AGENTS.md`, repo
  files, shell history, logs, diagnostics, plans, or output.
- Creating/revoking the read-only token and exact reads of user-supplied reports
  require current operator authorization. Listing, writes, deletes, retention,
  Worker deployment, and update-bucket operations remain distinct external
  actions and are never implied by read authorization.
