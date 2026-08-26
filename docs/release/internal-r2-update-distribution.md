# Internal unsigned R2 updates

This is the Pi-67 Desktop small-team update channel. It intentionally remains unsigned and does
not require Authenticode, Apple Developer, Developer ID, or notarization. It is not the signed
stable release channel described in [`signing.md`](./signing.md).

## Runtime contract

- Fixed origin: `https://updates.52671314.xyz`
- Bucket: `pi67-desktop-updates`
- Mutable metadata: `/unsigned-preview-manifest.json`
- Channel: `unsigned-preview`
- Windows target: versioned x64 NSIS EXE
- macOS target: versioned arm64 ZIP; the DMG remains available for manual recovery
- Automatic checks are check-only. Download and installation require one explicit in-app click.
- The client accepts only the exact generated names, byte counts, SHA-256 values, platform targets,
  and a newer canonical SemVer version. The manifest cannot supply an arbitrary URL.

The channel provides transport integrity through HTTPS plus exact size/SHA-256 verification. It
does not provide an independent publisher identity if the Cloudflare account or build authority is
compromised. This is an accepted boundary for the internal team channel.

## Product files

For version `<version>`, R2 contains:

```text
Pi-67-Desktop-<version>-win-x64-unsigned-preview.exe
Pi-67-Desktop-<version>-mac-arm64-unsigned-preview.dmg
Pi-67-Desktop-<version>-mac-arm64-unsigned-preview.zip
unsigned-preview-manifest.json
```

Artifact names are immutable. Never overwrite an existing versioned artifact with different
bytes. `unsigned-preview-manifest.json` is the only mutable publication pointer.

## Prepare locally

The normal candidate gates still apply. After the exact Windows and macOS artifacts for one source
SHA have been built and tested, bind the operator's Windows x64 acceptance to the exact successful
candidate run and bytes. Fetch the bounded workflow metadata into ignored release output, then
record the receipt without creating or claiming a GitHub promotion run:

```bash
gh api repos/bigKING67/pi-67-desktop/actions/runs/<candidate-run-id> \
  > artifacts/release/windows-candidate-run.json

corepack pnpm run release:r2:windows-test:record -- \
  --actor <attesting-operator> \
  --candidate-identity artifacts/release/windows-preview-candidate-identity.json \
  --candidate-run-id <candidate-run-id> \
  --candidate-run-attempt <candidate-run-attempt> \
  --candidate-run-metadata artifacts/release/windows-candidate-run.json \
  --installer artifacts/release/Pi-67-Desktop-<version>-win-x64.exe \
  --packaged-executable 'artifacts/release/win-unpacked/Pi-67 Desktop.exe' \
  --repository bigKING67/pi-67-desktop \
  --source-commit <40-char-source-sha> \
  --output artifacts/release/windows-preview-manual-test.json
```

The command verifies the candidate identity, workflow name/status/repository/run, source SHA,
installer SHA-256, and packaged executable SHA-256 before writing the credential-free receipt. It
does not treat a hosted workflow as the manual test, publish anything, create a Tag/Release, or
invent a promotion run. The current operator must run it only after receiving the exact Windows
test confirmation.

Then prepare the existing unsigned-preview manifest and R2 allowlist bundle:

```bash
corepack pnpm run release:preview:prepare
corepack pnpm run release:preview:verify
corepack pnpm run release:preview:bundle:prepare
corepack pnpm run release:r2:bundle:prepare
```

The R2 bundle is written to ignored build output:

```text
artifacts/r2-update-bundle/
```

The command consumes `artifacts/verified-unsigned-preview/`, not raw packaging output. It verifies
the manifest and every artifact again, then copies six local files:

- the three versioned product artifacts;
- `unsigned-preview-manifest.json`;
- `windows-preview-candidate-identity.json`; and
- `windows-preview-manual-test.json`.

Only the first four files are uploaded. The two Windows provenance files remain local release
evidence and bind the R2 Windows EXE to the exact manually tested candidate, workflow run/attempt,
source SHA, packaged executable hash, and Pi runtime version. The command prints the four-file
upload order with `unsigned-preview-manifest.json` last.

## Read-only publication plan

Before any write, configure least-privilege R2 S3 credentials outside the repository and run:

```bash
PI67_R2_ACCOUNT_ID=... \
PI67_R2_ACCESS_KEY_ID=... \
PI67_R2_SECRET_ACCESS_KEY=... \
corepack pnpm run release:r2:plan
```

`PI67_R2_BUCKET_NAME` defaults to `pi67-desktop-updates`. The plan validates the local bundle,
lists the live bucket without modifying it, reads the public manifest, and reports:

- missing target-version artifacts;
- same-name/same-size artifacts that still need public hash verification;
- immutable same-name/different-size conflicts that block publication;
- recognized older Pi-67 artifacts eligible for later cleanup; and
- unknown objects that the tool will preserve.

The plan never uploads, overwrites, deletes, purges, or writes a release receipt.

## Publish with separate authorization

R2 upload is an external write and requires current authorization for the exact version. Resolve a
least-privilege R2 credential from repository-external operator configuration; never put account
IDs, access keys, API tokens, cookies, or dashboard state in Git, workflow logs, or committed
`.env` files.

Publication order is mandatory:

1. Re-verify source SHA, version, platform test receipts, local size, and SHA-256.
2. Upload all three immutable versioned artifacts.
3. Read each artifact back through `updates.52671314.xyz`; verify HTTP 200, byte count, Range 206,
   and downloaded SHA-256.
4. Upload `unsigned-preview-manifest.json` **last**.
5. Fetch the public manifest without credentials and confirm the exact version and hashes.
6. Test `检查更新 -> 下载并安装 -> restart -> version` on Windows x64 and an installed macOS
   arm64 copy. Bind the result to exact bytes and source SHA.

After current authorization for the exact package version, publication is invoked with:

```bash
PI67_R2_ACCOUNT_ID=... \
PI67_R2_ACCESS_KEY_ID=... \
PI67_R2_SECRET_ACCESS_KEY=... \
corepack pnpm run release:r2:publish -- \
  --confirm-version <version> \
  --source-commit <40-char-source-sha>
```

Publish refuses a dirty release-tooling checkout, a release-tooling `HEAD` that is not exactly
`origin/main`, an artifact source SHA that is not an ancestor of that tooling commit, or a source SHA
that differs from the candidate identity retained in the local R2 bundle. The candidate identity,
manual-test receipt, installer bytes, package version, and manifest remain bound to the artifact
source SHA; the publication receipt separately records the later release-tooling commit. This
allows a release-only tooling fix without rebuilding different application bytes under the same
version. `--bundle` can select another verified local bundle; unknown or duplicate flags fail closed.

The release tool uses Cloudflare R2's S3-compatible API for object listing, uploads, and deletion.
Uploads stream from disk; the AWS high-level uploader automatically uses multipart transfer for
large DMG/ZIP artifacts, aborts incomplete parts on failure, and never buffers a complete installer
in memory. The Cloudflare REST API is used only for the separately authorized exact cache purge.
Successful publish writes a credential-free receipt under ignored
`artifacts/r2-release-receipts/`.

Uploading metadata first is forbidden because clients could retain a reference to a missing
artifact. The JSON/YML/SIG cache rule bypasses edge caching for the mutable manifest, and the R2
manifest object must also carry `Cache-Control: no-store` so Electron's local HTTP cache cannot
reuse a previously fetched mutable manifest. Immutable EXE/DMG/ZIP files use the one-year cache
rule.

## Platform behavior

### Windows x64

After exact download verification, Desktop starts the existing per-user NSIS installer with the
electron-builder update, force-run, and silent flags. The final `/D=` argument pins replacement to
the running executable's directory instead of allowing missing or stale installer registry state to
move the application. If a Desktop shortcut existed before the update, the installer rewrites that
shortcut against the replaced executable; it does not recreate a shortcut the user had removed.
Desktop then performs the normal Pi-67 shutdown checkpoint. The installer replaces the installed
application and starts the updated version. A real Windows x64 upgrade test remains required for
every candidate identity.

### macOS arm64

Official electron-updater requires code signing on macOS, so this unsigned internal channel uses a
bounded replacement helper instead:

1. Download and verify the exact ZIP.
2. Extract it with `/usr/bin/ditto --noqtn` into the user update directory.
3. Require exactly one `Pi-67 Desktop.app` with bundle ID `com.pi67.desktop`, the manifest version,
   and the expected executable.
4. Require staging and installation to be on the same volume and the installed bundle parent to be
   writable.
5. After the normal app shutdown completes, rename the current bundle to a unique adjacent backup,
   activate the staged bundle, and restart it with `--updated`.
6. Restore and reopen the previous bundle if replacement or the `open` request fails; delete the
   backup only after macOS accepts the replacement launch request.

If the parent directory is not writable, Desktop fails visibly without changing the installed
bundle. The operator can then use the DMG as the manual recovery path.

An accepted `open` request is not proof that the replacement remains healthy after startup. A real
installed-app upgrade check must still verify the new runtime version and normal application health.

## Rollback or withdrawal

To stop a bad version from reaching additional clients:

1. Remove or replace `unsigned-preview-manifest.json` first so no new check selects the version.
2. Confirm the public manifest no longer advertises the version.
3. Only with deletion authorization, delete the versioned artifacts.
4. Purge each deleted artifact's exact Cloudflare URL. Deleting an R2 object alone does not evict an
   existing edge HIT.
5. Do not reuse the withdrawn filenames; publish a higher SemVer with new immutable names.

Rollback of already installed clients is a separate, explicit operation. The normal updater does
not accept a lower or equal version.

## Latest-only steady-state cleanup

R2 steady state keeps only the three artifacts named by the current public manifest plus
`unsigned-preview-manifest.json`. During a release cutover, old and new artifacts coexist. Cleanup
is forbidden until the new manifest has been published and the exact Windows x64 and installed
macOS arm64 application upgrades have both been accepted.

With separate deletion/cache-purge authorization, run:

```bash
PI67_R2_ACCOUNT_ID=... \
PI67_R2_ACCESS_KEY_ID=... \
PI67_R2_SECRET_ACCESS_KEY=... \
PI67_CLOUDFLARE_API_TOKEN=... \
PI67_CLOUDFLARE_ZONE_ID=... \
corepack pnpm run release:r2:cleanup -- \
  --confirm-version <version> \
  --confirm-target-upgrades
```

The cleanup command re-reads the public manifest, rejects a version mismatch, deletes only exact
recognized Pi-67 update artifact names from older SemVer versions, preserves unknown objects and
the manifest, purges only the deleted public URLs, and re-lists the bucket to verify that no
recognized old version remains.

## First updater bootstrap

The installed Alpha.29 application does not contain this R2 updater and cannot discover an
equal-version replacement. Never publish different bytes under the same version. The intended
rollout is:

1. `0.1.0-alpha.30`: one final manual Feishu install that introduces the R2 updater.
2. `0.1.0-alpha.31`: the first R2 in-app update, tested from installed Alpha.30 on both target OSes.
3. Only after that target-OS evidence, remove Alpha.30 from R2 with the bounded cleanup command.

This document does not authorize either version bump, candidate build, Feishu upload, R2 write, or
remote deletion.

## Evidence boundary

- Source/unit tests prove validation and orchestration only.
- macOS repository preview proves only the exact Apple Silicon preview artifact that was rebuilt.
- Hosted Windows checks do not replace an installed Windows x64 upgrade.
- R2 HTTP checks do not prove China Telecom, Unicom, or Mobile throughput.
- No upload, deletion, cache purge, Tag, Release, or promotion is implied by preparing the local
  bundle.
