# Pi-67 Desktop

Pi-67 Desktop is a native Windows x64 GUI for the real upstream Pi runtime and
the pi-67 distribution. It is implemented with C#/.NET 10 and WinUI 3 and uses
`pi --mode rpc` as its only agent execution path.

## Status

Early implementation. No public installer has been released and Windows native
runtime validation is not yet complete.

## Product contract

- Windows 10 22H2 and Windows 11 x64.
- Reuses the user's real `~/.pi/agent` and Pi sessions.
- No Electron, WebView2, embedded Pi runtime, analytics, or cross-platform UI.
- Peak Code is a pinned product/interaction reference, not a source merge base.
- C# owns the first release; Rust requires the measured adoption gate in
  `docs/adr/0006-rust-adoption-gate.md`.

See `PRODUCT.md`, `DESIGN.md`, and `openspec/changes/add-windows-native-pi-desktop/`.

## Planned developer prerequisites

- Windows 10 22H2 or Windows 11 x64
- Visual Studio 2026 WinUI application development workload, or .NET SDK
  `10.0.302` plus the Windows App SDK build prerequisites
- Node.js 24 LTS for the real Pi runtime and the Pi bridge
- WiX Toolset 5.0.2 for installer work

The repository pins dependencies and restores them in locked mode. On Windows,
the main gates are:

```powershell
npm ci
npm run version:verify
npm run check
npm test
npm run build:node
dotnet restore Pi67.Desktop.slnx --locked-mode
dotnet build src/Pi67.Desktop.App/Pi67.Desktop.App.csproj -c Release --no-restore
./eng/packaging/build.ps1 -Configuration Release
npm run verify:no-embedded-pi -- --root artifacts/app/win-x64
```

`eng/packaging/build.ps1` creates an x64 MSI and Burn setup executable. The
bundle carries hash-verified .NET Desktop and Microsoft Windows App Runtime
prerequisites but never carries Node, Pi, pi-67, credentials, sessions, or user
configuration. Install, signing, repair, upgrade, and uninstall claims still
require the controlled Windows evidence described in `docs/testing/`.

Desktop release identity is owned by `eng/version.json`; see
`docs/release/versioning.md` for the synchronized projection and exact release
artifact contract.
