# Architecture layers

Dependency direction is enforced by architecture tests:

```text
Domain <- Application <- PiRpc
                     <- Infrastructure.Windows
                     <- Presentation
App composes all adapters and presentation objects.
```

- `Domain`: SemVer, compatibility, canonical session identity, trust, and
  approval policy. No infrastructure dependency.
- `Application`: use-case ports and redacted boundary contracts.
- `PiRpc`: bounded JSONL framing, correlation, process lifecycle, and session
  orchestration.
- `Infrastructure.Windows`: Windows runtime discovery, Job Objects, SQLite,
  bootstrap commands, and the installed-Pi control bridge.
- `Presentation`: native-agnostic shell state, coalesced streaming, and UI
  request routing.
- `App`: WinUI composition, pickers, dialogs, accessibility, and window
  lifecycle. No domain policy.
- `installer`: WiX MSI/Burn and the narrowly scoped Windows App Runtime
  bootstrap executable.

The Node bridge and Desktop safety extension are bounded protocol adapters.
Neither is an alternate Pi runtime.
