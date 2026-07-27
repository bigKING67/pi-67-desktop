# `@pi67/extension-compat`

Pure TypeScript contracts for declarative Pi Extension desktop adapters.

The package owns manifest v1 validation, SemVer matching, and an immutable
registry. It does not load files, execute extension code, import the Pi SDK, or
render UI. A registry match contains only bounded presentation metadata for
commands and tools that are actually present in the loaded extension.

Built-in adapters require a package name, exact installed version, npm sha512
integrity, license, canonical HTTPS source repository, full Git object id,
one or more repository-relative source paths, and the observed command/tool inventory.
`createExtensionAdapterConformanceInventory()` enforces that evidence before a
manifest can enter the built-in registry; declared surfaces must be a subset of
the source-pinned observed surfaces. Evidence records remain declarative JSON
metadata and cannot contain renderer code or executable fields.

Run `corepack pnpm run verify:extension-adapters` to independently fetch each
exact npm package and pinned Git commit, compare package/source bytes, and
re-enumerate command/tool surfaces. The verifier writes only a bounded report to
the ignored `artifacts/quality/` directory; it does not retain third-party source.
