# Windows release evidence

CI proves Windows compilation, XAML compilation, core tests, installed Pi
offline RPC, Node bridge compatibility, installer construction, artifact
isolation, the exact release manifest, SBOM, provenance, and checksums. It does
not prove interactive UI or installer lifecycle quality.

Before a signed beta, record artifacts for all of these controlled tests:

1. Windows 10 22H2 x64 clean VM: install, first launch, prerequisite inventory,
   repair, upgrade, uninstall, and Pi data preservation.
2. Windows 11 x64 clean VM: the same lifecycle plus Mica/system theme behavior.
3. Existing pi-67 user: dirty agent checkout is blocked and sessions work in
   GUI -> TUI -> GUI sequence without translation.
4. Keyboard-only and Narrator flow: project picker, session open, composer,
   tool approval, auth, model selection, diagnostics, and focus return.
5. High Contrast, Reduced Motion, 125%, 150%, and 200% scaling.
6. Narrow window: compact project/session flyout replaces the hidden rail.
7. API key and OAuth: no secret in argv, process listings, logs, diagnostics,
   SQLite, screenshots, or support artifacts.
8. Performance runs against the budgets in `performance.md`.
9. MSI and Burn logs for install, repair, same-version reinstall, upgrade,
   downgrade block, cancellation, rollback, and uninstall.
10. Authenticode and timestamp verification for every executable payload.

Each record includes OS build, architecture, source commit, package hashes,
test steps, result, and artifact path. Missing evidence remains explicitly
unverified.
