# HEIC/HEIF attachment normalization

## Contract

Pi-67 content-identifies HEIC/HEIF before the ordinary Prompt attachment MIME
fallback. A valid input is normalized to JPEG inside the existing Desktop-owned,
private staging directory. The manifest and Agent Host continue to see one opaque
staged JPEG attachment; the source path, HEIC bytes, decoder state, and source
metadata never cross the Preload bridge.

The Renderer receives a one-shot normalization receipt only to bind the selected
`File` identity to the changed output name and size. It validates the exact source
name, declared MIME, and selected byte length, then discards that receipt before
persisting the draft. Normalized HEIC does not create a Renderer object URL.

## Process and resource boundary

1. Electron Main makes the existing no-follow, physical-identity-checked private
   copy at `draft/<opaque-id>/payload.bin`.
2. Main parses the ISO BMFF `ftyp -> meta -> iprp -> ipco -> ispe` path within the
   first 1 MiB. HEIC/HEIF claims whose content does not match fail closed.
3. A dedicated `node:worker_threads` worker reads only that private payload with
   `O_NOFOLLOW`. `heic-decode` first exposes the main-image descriptor; dimensions
   are rechecked before allocating RGBA pixels.
4. `@napi-rs/canvas` encodes the decoded RGBA pixels at JPEG quality 90. Main
   removes APP1, APP2, APP13, and COM metadata segments, reparses the JPEG and
   verifies dimensions before atomically replacing the private payload.
5. The unchanged version-1 opaque manifest binds the normalized name, MIME,
   byte length, kind, and SHA-256. Agent Host claim/hash validation and Pi image
   projection remain unchanged.

| Boundary | Limit |
| --- | ---: |
| HEIC/HEIF source | 32 MiB |
| pre-decode metadata read | 1 MiB |
| decoded pixels | 50,000,000 |
| single dimension | 16,384 pixels |
| JPEG output / inline-image draft aggregate | 32 MiB |
| worker old-generation heap | 384 MiB |
| worker stack | 8 MiB |
| conversion timeout | 45 seconds |

Application shutdown aborts active normalization and terminates its worker. A
decode, timeout, budget, validation, or source-drift failure removes only the new
private staging directory. Existing Composer text and attachments remain visible,
retryable, and individually removable.

## Dependency and CSP decision

The selected exact dependencies are `heic-decode@2.1.0` and the already frozen,
packaged `@napi-rs/canvas@1.0.3`; `heic-decode` resolves
`libheif-js@1.19.8`. The frozen integrity values are:

```text
heic-decode@2.1.0
sha512-0fB3O3WMk38+PScbHLVp66jcNhsZ/ErtQ6u2lMYu/YxXgbBtl+oKOhGQHa4RpvE68k8IzbWkABzHnyAIjR758A==

libheif-js@1.19.8
sha512-vQJWusIxO7wavpON1dusciL8Go9jsIQ+EUrckauFYAiSTjcmLAsuJh3SszLpvkwPci3JcL41ek2n+LUZGFpPIQ==

@napi-rs/canvas@1.0.3
sha512-OlI657a5XXvKGFX7kNeIzJ8rO7IXt87Mqu2H8rXE46viAuOfum/JA7ysX7+eBhxNKznT+RCZh418mndlcFX3+w==
```

The reviewed t3code mechanism uses `heic-to/csp` in its web client. Pi-67 does
not copy that implementation: its distribution uses a Blob worker and would
require widening `worker-src` for the Renderer. Pi-67 instead keeps the existing
Renderer CSP unchanged and reimplements normalization in a Desktop-owned Node
worker.

License evidence is recorded in `THIRD_PARTY_NOTICES.md`; full `libheif-js` /
`libheif` LGPL texts remain inside their packaged npm directories. The
`heic-decode@2.1.0` tarball declares ISC in `package.json` but contains no separate
LICENSE file, so an external release still requires the normal generated SBOM and
license-inventory review. Local unsigned packaging is not external publication.

## Evidence boundary

Unit tests cover structured content identification, malformed boxes, 48 MP input,
pixel/dimension bombs, worker timeout/cancellation, JPEG metadata removal, manifest
integrity, Preload source binding, and Composer draft preservation. Production-
Renderer E2E covers retry and remove behavior. Exact packaged Electron validation
on macOS Apple Silicon passed for the worker entry, `libheif-js` bundle, native
canvas binary, metadata-free staged payload, failure copy, release, and relaunch. A
real 15,703-byte HEIC normalized to a validated 27,948-byte, 1,024 x 1,024 JPEG in
the exact repository artifact whose `app.asar` SHA-256 is
`d8c1a525628c787eaffac6c7bfd7c60bdc63a7ea947052930290405bce70d3c5`.
Windows support remains unverified until a real Windows x64 packaged run passes the
same lifecycle.
