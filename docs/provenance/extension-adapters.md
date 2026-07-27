# Extension Adapter provenance

Built-in Extension Adapter metadata is declarative and contains no copied
Extension implementation code. Each record must still pin the published
package and the source revision used to verify its executable surfaces.

The executable gate is:

```bash
corepack pnpm run verify:extension-adapters
```

It validates exact npm identity, license, repository, `gitHead`, sha512
integrity, tar safety, package/source byte equality, and the complete statically
declared command/tool set. A weekly and manually dispatchable CI workflow stores
the bounded result as `extension-adapter-provenance`; normal pull requests do not
depend on npm or GitHub availability. Reports and temporary source checkouts are
not committed or retained in the repository.

## `pi-rewind@0.5.0`

```text
sourceRepository: https://github.com/arpagon/pi-rewind
sourceCommit: 91611ad87992fb7b635a41ba68f67916ff6e6ae3
sourcePaths: src/index.ts, src/commands.ts
package: pi-rewind@0.5.0
packageIntegrity: sha512-nW6HVg3II7+DhMZAsUX7EJPT2/IgPGXWGDntppS1cyYLfNaVgeBU5bRW7e1acHk1LW18EWdMh6475CRh0PAnGQ==
license: MIT
targetPath: packages/extension-compat/src/builtin-manifests.ts
observedCommands: rewind
observedTools: none
modifications: declarative label and description metadata only; no source code copied
```

Verification notes:

- npm package contents for `package.json` and `src/` were byte-compared with
  Git tag `v0.5.0` at the pinned commit;
- `src/commands.ts` registers exactly the `rewind` command and no tools;
- the Extension also registers `escape escape`, so Desktop compatibility stays
  `partial` even when the command Adapter matches;
- shared `ctx.ui` calls remain unattributed because Pi SDK does not expose a
  reliable realtime calling Extension identity.

## `@feniix/pi-sequential-thinking@5.0.3`

```text
sourceRepository: https://github.com/feniix/pi-extensions
sourceCommit: 36cf6ac5497b8cb75c7c7a34afe78c14b3584a61
sourcePaths: packages/pi-sequential-thinking/extensions/index.ts,
  packages/pi-sequential-thinking/extensions/tools.ts
package: @feniix/pi-sequential-thinking@5.0.3
packageIntegrity: sha512-ADyAMziivVPLBthAZoUiMHiFk31m4MkAx3bj5kZS6YGg4D4QBxrzg9t6Kr4lCp2vVTNoHLJx+z0QN7jJzjK+cQ==
license: MIT
targetPath: packages/extension-compat/src/builtin-manifests.ts
observedCommands: none
observedTools: process_thought, generate_summary, clear_history, export_session,
  import_session, get_thinking_history, get_thinking_status, sequential_think
modifications: declarative labels and presentation metadata only; no source code copied
```

Verification notes:

- npm metadata pins `gitHead` to the source commit above;
- npm package contents for `package.json`, `README.md`, and `extensions/` were
  byte-compared with `packages/pi-sequential-thinking/` at that commit;
- `extensions/index.ts` registers the portable tools returned by
  `extensions/tools.ts`; the observed source contains exactly the eight tools
  listed above and no command, shortcut, message renderer, or entry renderer;
- `generate_summary`, `get_thinking_history`, and `get_thinking_status` are
  source-declared read-only surfaces and use the `read` presenter;
- tools that append, clear, import, export, or scaffold local thought storage
  stay `generic`. The Adapter does not claim Shell execution, workspace Diff,
  Pi shared UI attribution, or complete Extension UI compatibility.
