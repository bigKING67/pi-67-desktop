# Project Context

## Purpose

Build a native Windows x64 GUI for the real upstream Pi runtime and pi-67
without introducing a second runtime, a web renderer, or a parallel session
format.

## Technology

- C# 14 / .NET 10 LTS
- WinUI 3 / Windows App SDK
- SQLite disposable projections
- Pi JSONL RPC over redirected stdin/stdout
- Node ESM bridge that dynamically imports the installed Pi package
- WiX Burn/MSI

## Conventions

- Public requirements use SHALL/MUST.
- The layer dependency direction in `AGENTS.md` is enforced by tests.
- All package versions are centrally locked.
- Windows runtime evidence is required for Windows behavior claims.
- Rust is deferred behind a measured adoption gate.
