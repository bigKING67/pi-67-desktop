# ADR 0001: Native Windows stack

- Status: Accepted
- Date: 2026-07-22

## Decision

Pi-67 Desktop v0.1 uses C# 14, .NET 10 LTS, WinUI 3, and Windows App SDK for a
Windows x64-only client. It does not use Electron, a browser renderer,
WebView2 application surfaces, React, Monaco, xterm, or a cross-platform UI
framework.

The real installed `pi --mode rpc` process remains the only agent runtime.
Desktop does not embed or reimplement Pi.

## Rationale

C# and WinUI provide the strongest combined Windows accessibility, windowing,
installer, diagnostics, process, and maintenance story for this product. The
dominant workloads are RPC, process supervision, SQLite projection, and native
UI rendering; raw language throughput is not the limiting factor.

## Consequences

- Windows XAML compilation and native behavior require Windows evidence.
- Core policy and protocol projects remain testable without WinUI.
- Cross-platform UI parity is intentionally not an architectural requirement.
